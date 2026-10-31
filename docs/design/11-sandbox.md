# 远程沙箱执行设计（草案）

> 所属：[AutoSDD 设计文档](README.md)
> 版本：v0.1 · 2026-10-31
> 状态：**设计草案，待评审；本文不包含实现**
> 相关：[执行引擎](04-execution.md) · [安全与边界](07-security.md) · [功能清单](../FEATURES.md)
> 范围：让 Agent 在远程 Linux 沙箱中执行，提供沙箱创建、调度、隔离、回收与可观测能力
> 沙箱运行时：Bubblewrap（`bwrap`）

---

## 1. 背景与目标

### 1.1 现状

当前 AutoSDD 的所有执行都发生在 **Fastify 服务进程内**：

- 编排器按步骤解析 `AgentExecutor`，直接调用 Mock / Anthropic / OpenAI 兼容接口；
- Agent 的本质是「一次 LLM 流式调用」：系统提示词 + 用户提示词 → 文本产物；
- Agent 没有文件系统、命令执行、代码检索等工具能力，也不会修改代码；
- 任务、步骤、上下文、事件都持久化在本地 SQLite，服务只监听 `127.0.0.1`。

因此，「执行」只是**生成文本**，天然没有沙箱需求；一旦 Agent 要真正读代码、改代码、跑测试，就需要一个受控的执行环境。

### 1.2 目标

1. **远程执行**：Agent 的工作负载运行在独立的 Linux 主机上，而不是控制面进程内。
2. **Agent 运行在沙箱中**：Agent Runtime、工具调用、代码读写、命令执行都发生在 Bubblewrap 沙箱内。
3. **沙箱管理**：主机注册、能力标签、容量调度、生命周期、配额、回收、审计与 UI。
4. **安全默认**：沙箱内没有 API Key、没有宿主机敏感挂载、默认无 IP 网络、资源受限、可随时终止。
5. **与现有系统兼容**：没有配置沙箱的工作流继续走现有进程内执行器，行为不变。
6. **可演进**：Bubblewrap 是第一个 provider，接口上允许后续接入 Docker / gVisor / Firecracker。

### 1.3 非目标（本期不做）

- 多租户、登录、SSO、RBAC（沿用当前「本地单工作空间、无鉴权」的定位）；
- 跨地域调度、Kubernetes / Nomad 集成；
- Windows / macOS 沙箱（Bubblewrap 只支持 Linux）；
- GPU、超大镜像、任意 OCI Registry 分发；
- 工作流并行执行（当前仍是单 run 单步串行）；
- Agent 版本管理、记忆审核等既有非目标。

> Bubblewrap 提供的是**进程级内核隔离**，不是虚拟机。它可以隔离「会犯错或不受信任的构建/测试代码」，但面对**恶意多租户**时仍需更强的边界（见 [隔离强度说明](#隔离强度说明)）。本设计按「单团队内部使用、代码来源基本可信」定位。

---

## 2. 现状差距

| 维度 | 现在 | 目标 |
|---|---|---|
| 执行位置 | Fastify 进程内 | 远程 Linux 主机上的 bwrap 沙箱 |
| Agent 能力 | 纯文本生成 | 工具循环：读写文件、检索、执行命令 |
| 文件系统 | 无 | 每次 run 一个独立 workspace |
| 隔离 | 无 | user/pid/mount/net/uts/ipc 命名空间 + 只读 rootfs + 资源限制 |
| 密钥 | 控制面持有 | 仍然只在控制面；沙箱内只拿短期能力令牌 |
| 执行记录 | LLM 流式文本 | 文本 + 工具调用 + 命令退出码 + 产物 |
| 调度 | 进程内 | 多主机注册、容量、标签、排空、回收 |
| 失败语义 | 步骤失败 | 区分「Agent 失败」与「沙箱基础设施失败」 |

**关键认知**：当前所谓「Agent」只是一次模型调用。要让 Agent 真正运行在沙箱里，必须补上三件事：

1. 一个**沙箱内 Agent Runtime**（工具循环的执行者）；
2. 一套**工具协议**（读写文件、执行命令、检索）；
3. 一条**不泄露密钥的模型访问通道**（沙箱 → 控制面 LLM Gateway）。

---

## 3. 设计原则

1. **隔离优先**：默认无网络、只读 rootfs、仅 workspace 可写、drop 全部 capability。
2. **密钥不落地**：模型 API Key、主机凭据、数据库凭据永远不进入沙箱。
3. **不做静默降级**：沙箱不可用时步骤失败并给出明确错误码，不能偷偷回退到宿主机执行。
4. **控制面/数据面分离**：控制面负责调度与审计；runner 负责真正创建和销毁沙箱。
5. **配置不可变**：run 启动时冻结沙箱 profile；运行中改配置只影响新 run。
6. **失败可区分**：Agent 错误、工具错误、沙箱基础设施错误使用不同的错误码与重试策略。
7. **一个 run 一个沙箱**：workspace 在步骤间延续，避免每一步重复拷贝与环境漂移（见上文「沙箱粒度」）。

---

## 4. 总体架构

```
┌─────────────────────────────── 控制面（Fastify + SQLite）───────────────────────────────┐
│  Orchestrator   Sandbox Manager   LLM Gateway   Sandbox API/UI   Run Events/SSE          │
└───────────┬───────────────────────────────┬───────────────────────────────┬─────────────┘
            │ 调度/生命周期                  │ 模型请求（注入 Key）           │ 审计/指标
            ▼                               ▲                               │
┌──────────────────────── Runner（Linux 主机，出站 mTLS）────────────────────────────────┐
│  Agent Supervisor   Workspace Manager   LLM Socket Proxy   Artifact Uploader   Reaper   │
└───────────┬─────────────────────────────────────────────────────────────────────────────┘
            │ bwrap
            ▼
┌──────────────────────────── Sandbox（每次 run 一个）───────────────────────────────────┐
│  Agent Runtime（工具循环）                                                             │
│   /workspace (rw)   / (ro rootfs)   /tmp (tmpfs)   /run/autosdd/llm.sock (llm proxy)   │
│   user/pid/mount/net/uts/ipc namespaces, cap-drop ALL, no IP network                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 组件职责

| 组件 | 职责 |
|---|---|
| **Sandbox Manager** | 主机选择、profile 校验、沙箱状态机、配额、TTL、回收、与 runner 通信 |
| **Runner** | 部署在 Linux 主机上的常驻进程；创建/销毁 bwrap、挂载 workspace、代理 LLM 请求、上传产物、上报心跳 |
| **Agent Supervisor** | 在 runner 内管理沙箱进程：启动、超时、SIGTERM→SIGKILL、日志截断 |
| **Agent Runtime** | 沙箱内的可执行程序；执行工具循环，调用 LLM Gateway，产出事件与最终文本 |
| **LLM Gateway** | 控制面内部接口；校验沙箱令牌，解析模型与 Key，代理流式响应，不向沙箱暴露凭据 |
| **Workspace Manager** | 创建目录、初始化输入、打包产物、清理；限制磁盘配额 |
| **Reaper** | 处理 TTL、失联 runner、孤儿沙箱、控制面重启后的对账 |

### 4.2 为什么是「runner 主动出站」而不是控制面 SSH 进主机

- 远程主机通常位于 NAT/防火墙后，出站连接最容易打通；
- 不需要在控制面保存主机 SSH 私钥；
- runner 可自主执行 TTL 与自愈，控制面短暂不可用不影响已运行沙箱；
- 控制面只暴露一个**内部 runner 监听端口**（与 UI 端口分离），使用 mTLS。

---

## 5. 关键决策

### 5.1 为什么选 Bubblewrap

| 维度 | Bubblewrap | Docker | gVisor | Firecracker |
|---|---|---|---|---|
| 隔离边界 | Linux namespaces + cap drop（共享内核） | namespaces + cgroups（共享内核） | 用户态内核（强） | 轻量 VM（最强） |
| 依赖 | 一个 setuid/用户命名空间可用的 `bwrap` | Docker daemon | 运行时 + 内核支持 | KVM + 镜像 |
| 启动速度 | 毫秒级 | 百毫秒~秒级 | 秒级 | 百毫秒级 |
| 远程管理 | 无，需要自建 runner | 有 API | 有 API | 有 API |
| 适合场景 | 内部构建/测试隔离 | 通用容器 | 不可信多租户 | 强隔离多租户 |

选择 Bubblewrap 的原因：轻量、无守护进程、可直接组合成「只读 rootfs + workspace」的强约束环境，适合当前「内部单团队」定位。

需要正视的限制：

- **只支持 Linux**；当前开发机是 macOS，本地无法运行 bwrap，必须连接远程 Linux runner（或使用 mock provider 跑测试）。
- **没有远程控制面**：必须由我们自己的 runner 包一层。
- **不提供资源限制**：CPU/内存/pid/磁盘需要 cgroups v2、RLIMIT、磁盘配额配合。
- **共享内核**：不是虚拟化边界，恶意内核攻击面仍存在（[隔离强度说明](#隔离强度说明)）。

### 5.2 沙箱粒度：一个 run 一个沙箱

| 方案 | 优点 | 缺点 |
|---|---|---|
| 每步一个沙箱 | 隔离最强、步骤互不污染 | 每步重建环境，workspace 需要快照传递，慢 |
| **每个 run 一个沙箱（推荐）** | 环境只准备一次；下游步骤直接看到上游文件；审批期间可保留 | 同 run 步骤共享文件系统，需要约定工具权限 |

推荐 run 级沙箱：run 启动时创建，所有步骤作为 `sandbox_job` 在其中执行，run 结束（成功/失败/取消）后收集产物并销毁。审批卡点期间沙箱保留，超时后快照并销毁。

### 5.3 Agent 运行形态：两种方案

**方案 A：宿主侧工具循环，沙箱只执行工具**

- 控制面调用模型，模型返回工具调用，控制面把命令/文件操作发给沙箱执行。
- 优点：改动小；密钥天然不进入沙箱；复用现有执行器与流式逻辑。
- 缺点：Agent 进程不在沙箱内；长工具链的往返延迟高；与「Agent 运行在沙箱中」的目标不完全一致。

**方案 B：沙箱内 Agent Runtime（推荐目标形态）**

- 控制面把「本步骤的上下文 + 工具策略 + 模型标识」作为 job 下发；
- 沙箱内的 Runtime 自己完成「调模型 → 解析工具调用 → 执行工具 → 再调模型」的循环；
- Runtime 通过绑定进沙箱的 Unix Socket 访问控制面 LLM Gateway，**看不到 Key**；
- 流式事件由 Runtime 经 runner 回传控制面，UI 体验与现在一致。

| 维度 | A | B |
|---|---|---|
| 隔离完整性 | 中 | 高 |
| 实现复杂度 | 低 | 高 |
| 密钥暴露 | 无 | 无（短期令牌 + 网关注入） |
| 长任务/多轮工具 | 往返多 | 沙箱内闭环 |
| 调试难度 | 低 | 中 |

**建议**：目标架构采用 B。若希望尽快验证沙箱基础设施，可先用 A 打通「远程执行 + 管理 + 回收」，但对外仍描述为「沙箱执行」；B 作为下一阶段替换 Runtime 的位置，接口不变。本文按 B 展开，A 作为兼容路径保留。

### 5.4 远程传输

- MVP：HTTPS + 长轮询 + SSE（全部由 runner 出站发起），复用现有 Node 技术栈；
- runner 与控制面使用 **mTLS**，每个 runner 有独立证书与 ID；
- 任务下发采用「租约」：runner 拉取 job，控制面记录 lease 与超时，runner 需带 lease 令牌回传事件/结果，防止重放与重复执行；
- 后续如需更高吞吐再评估 gRPC。

### 5.5 网络与模型访问

- 沙箱默认 `--unshare-all`（含 network namespace），**没有 IP 网络**；
- 模型访问通过 runner 绑定进沙箱的 Unix Socket：`/run/autosdd/llm.sock`；
- runner 侧的 Socket Proxy 把请求转成控制面 LLM Gateway 调用，Gateway 根据沙箱令牌解析 run/step/model，注入真实 Key；
- 需要 `npm install` 等外网能力时，profile 可选择 `network.mode: proxy`：只允许通过 runner 的 HTTP(S) 代理访问白名单域名，仍不给沙箱直接网络；
- 默认策略：`none`（仅 LLM socket）。

### 5.6 产物与 workspace

- run 级 workspace：runner 本地目录，bind 到沙箱 `/workspace`，可写；
- 输入：任务启动时由控制面上传输入包（tar.gz）或 git 元数据，runner 解压/克隆；
- 输出：run 结束时按 profile 的 `artifacts` 规则打包（路径 glob + 大小上限），上传控制面；
- 控制面存储：`data/artifacts/<runId>/<artifactId>`，SQLite 记录哈希、大小、创建时间；
- 不把 workspace 直接暴露给浏览器；只提供下载与文本预览。

---

## 6. 沙箱领域模型

### 6.1 数据表（建议迁移 `003_sandboxes.sql`）

```sql
-- 已注册的远程/Linux 主机
CREATE TABLE sandbox_hosts (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  mode           TEXT NOT NULL CHECK (mode IN ('local', 'remote')),
  endpoint       TEXT NOT NULL,                 -- runner 标识/地址（仅展示，真实连接由 runner 出站）
  status         TEXT NOT NULL DEFAULT 'OFFLINE'
                 CHECK (status IN ('ONLINE','OFFLINE','DRAINING','REVOKED')),
  labels_json    TEXT NOT NULL DEFAULT '{}',    -- arch / bwrapVersion / capabilities
  capacity       INTEGER NOT NULL DEFAULT 1,    -- 最大并发沙箱数
  cert_fingerprint TEXT,                        -- mTLS 证书指纹
  version        TEXT,                          -- runner 版本
  last_heartbeat_at TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- 沙箱模板
CREATE TABLE sandbox_profiles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT NOT NULL DEFAULT '',
  rootfs_ref     TEXT NOT NULL,                  -- 预置 rootfs 名或 OCI digest
  resources_json TEXT NOT NULL,                  -- cpu/memory/pids/disk
  network_json   TEXT NOT NULL,                  -- mode / allowlist
  tools_json     TEXT NOT NULL,                  -- 命令白名单、文件权限、超时
  mounts_json    TEXT NOT NULL DEFAULT '[]',
  env_json       TEXT NOT NULL DEFAULT '[]',
  ttl_seconds    INTEGER NOT NULL DEFAULT 7200,
  idle_timeout_seconds INTEGER NOT NULL DEFAULT 600,
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE','DISABLED')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- run 级沙箱实例
CREATE TABLE sandboxes (
  id             TEXT PRIMARY KEY,
  host_id        TEXT NOT NULL REFERENCES sandbox_hosts(id),
  profile_id     TEXT NOT NULL REFERENCES sandbox_profiles(id),
  task_id        TEXT NOT NULL,
  run_id         TEXT NOT NULL UNIQUE REFERENCES task_runs(id),
  status         TEXT NOT NULL
                 CHECK (status IN ('ALLOCATING','PREPARING','READY','RUNNING',
                                   'WAITING_APPROVAL','STOPPING','STOPPED','FAILED')),
  workspace_ref  TEXT,                           -- runner 侧目录/卷标识
  rootfs_digest  TEXT,
  resources_json TEXT,
  network_json   TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL,
  ready_at       TEXT,
  last_heartbeat_at TEXT,
  expires_at     TEXT,
  stopped_at     TEXT
);

-- 步骤在沙箱内的一次执行（审计与排障）
CREATE TABLE sandbox_jobs (
  id             TEXT PRIMARY KEY,
  sandbox_id     TEXT NOT NULL REFERENCES sandboxes(id),
  run_id         TEXT NOT NULL,
  step_run_id    TEXT NOT NULL REFERENCES step_runs(id),
  kind           TEXT NOT NULL CHECK (kind IN ('AGENT_STEP','TOOL_EXEC','COMMAND')),
  status         TEXT NOT NULL
                 CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED')),
  payload_json   TEXT NOT NULL,
  exit_code      INTEGER,
  stdout_ref     TEXT,
  stderr_ref     TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT
);
```

### 6.2 状态机

```
ALLOCATING ─► PREPARING ─► READY ─► RUNNING ─► WAITING_APPROVAL ─► RUNNING
     │             │          │         │                │
     └─────────────┴──────────┴─────────┴────────────────┴──► STOPPING ─► STOPPED
                                     │
                                     └──────────────────────────────► FAILED
```

- `ALLOCATING`：Manager 选择主机并下发创建请求；
- `PREPARING`：runner 准备 rootfs/workspace、启动 bwrap、执行健康检查；
- `READY`：沙箱可用，等待步骤；
- `RUNNING`：Runtime 正在执行步骤或工具；
- `WAITING_APPROVAL`：步骤产物待人工审批，沙箱保留；
- `STOPPING/STOPPED/FAILED`：收尾、回收、失败。

**不变式**

- 同一 run 同时最多一个 `RUNNING` job（当前编排并发为 1）；
- 每个 `sandboxes.run_id` 唯一；
- `expires_at` 到期后由 runner 强制 SIGTERM → SIGKILL 并销毁；
- 控制面不可达时，runner 仍按 TTL 自行回收，避免资源泄漏。

### 6.3 调度

- 过滤：`ONLINE`、容量未满、labels 匹配（arch、bwrap 版本、rootfs 缓存）；
- 排序：负载最低 → 最近创建（缓存局部性）；
- 无可用主机：沙箱保持 `ALLOCATING` 进入队列，超过 `queueTimeout` 后失败 `SANDBOX_NO_CAPACITY`；
- 排空（DRAINING）：不再分配新沙箱，存量自然结束；
- 同一 run 重试尽量调度到同一主机（workspace 复用），失败则从输入重新准备。

---

## 7. Sandbox Profile

Profile 是**可版本化、不可在 run 中修改**的配置；run 启动时快照进 `workflow_snapshot`。

```yaml
name: node-22-docs
description: 文档与轻量代码任务
rootfs: node22-base@sha256:...        # 预置镜像摘要；v1 只允许白名单
resources:
  cpu: 2                              # cgroup CPUQuota
  memoryMb: 2048                      # MemoryMax
  pids: 256                           # TasksMax
  diskMb: 4096                        # workspace 配额
  tmpfsMb: 256
ttlSeconds: 7200
idleTimeoutSeconds: 600
approvalTtlSeconds: 1800              # 卡点等待上限
network:
  mode: llm-proxy                     # none | llm-proxy | proxy
  allowlist: []                       # mode=proxy 时的域名白名单
tools:
  exec:
    allow: [node, npm, npx, git, rg, ls, cat, sed, diff]
    deny:  [docker, kubectl, ssh, curl, wget]
    timeoutSeconds: 120
    maxOutputBytes: 1048576
  fs:
    read:  ["/workspace"]
    write: ["/workspace"]
  maxToolCalls: 200
mounts:
  - source: workspace
    target: /workspace
    mode: rw
env:
  - NODE_ENV=test
  - CI=1
artifacts:
  include: ["**/*.md", "**/*.json", "changes.patch"]
  exclude: ["node_modules/**", ".git/**"]
  maxBytes: 52428800
```

校验规则（控制面 + runner 双重校验）：

- `rootfs` 必须命中白名单或已缓存摘要；
- `exec.allow` 不得包含解释器逃逸之外的任意 shell（默认禁止 `sh -c` / `bash -c`，Runtime 使用 argv）；
- `fs.read/write` 只能位于 `/workspace` 或只读 `/usr`、`/etc` 的显式路径；
- 资源上限：CPU ≤ 8、内存 ≤ 16GB、磁盘 ≤ 20GB（可配置）；
- `network.mode=proxy` 才允许非空 allowlist。

---

## 8. Runner 协议（控制面 ↔ runner）

所有接口由 runner **出站**调用控制面，使用 mTLS；控制面为 runner 提供独立监听端口（默认 `127.0.0.1:4101`，远程部署时绑定私网地址），**绝不复用 UI 的 4000 端口对外暴露**。

### 8.1 注册与心跳

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/internal/runners/enroll` | 一次性注册令牌换取 runner 证书（或由运维预置证书） |
| POST | `/internal/runners/:id/heartbeat` | 上报状态、容量、bwrap 版本、活跃沙箱列表 |
| POST | `/internal/runners/:id/drain` | 控制面通知排空（也可由 UI 触发） |

心跳返回控制面下发的 TTL/回收指令；连续 N 次心跳失败标记 `OFFLINE`，其沙箱标记为孤儿。

### 8.2 任务租约

```http
POST /internal/runners/:id/lease
{ "capacity": 2, "labels": { "arch": "amd64", "bwrap": "0.8.0" } }

200 OK
{
  "job": {
    "jobId": "...",
    "leaseToken": "short-lived-jwt",
    "kind": "CREATE_SANDBOX",
    "sandboxId": "...",
    "profile": { ... },
    "input": { "type": "archive", "url": "...", "sha256": "..." },
    "expiresAt": "..."
  }
}
```

### 8.3 事件与结果

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/internal/jobs/:jobId/events` | 批量上报事件（delta/tool_call/tool_result/log），带 leaseToken |
| POST | `/internal/jobs/:jobId/result` | 上报最终产物、退出码、usage、错误 |
| POST | `/internal/jobs/:jobId/artifacts` | 分片上传产物 |
| POST | `/internal/sandboxes/:id/stop` | 通知 runner 终止（幂等） |

事件使用递增序号与幂等键；控制面按 `jobId + seq` 去重，乱序丢弃。事件写入现有 `run_events` 体系，SSE 无需改动。

### 8.4 错误码

`SANDBOX_NO_CAPACITY`、`SANDBOX_HOST_OFFLINE`、`SANDBOX_START_FAILED`、`SANDBOX_ROOTFS_MISSING`、`SANDBOX_WORKSPACE_QUOTA`、`SANDBOX_TIMEOUT`、`SANDBOX_CANCELED`、`SANDBOX_RUNTIME_CRASHED`、`SANDBOX_PROTOCOL_ERROR`。

其中基础设施错误可重试（最多 1 次、换主机）；Agent/工具错误不自动重试。

---

## 9. Bubblewrap 执行细节

> 以下命令按 bwrap ≥ 0.8 设计，具体参数需在目标发行版验证。

### 9.1 主机前置条件

- Linux 5.11+（推荐），cgroup v2；
- 允许非特权 user namespace（或安装 setuid bwrap）；
- `bwrap` 已安装并加入 runner 的白名单路径；
- 专用系统用户运行 runner（非 root）；root 只用于一次性准备 rootfs 与 cgroup 委派；
- 磁盘配额（xfs project quota 或 loop 文件）+ overlayfs（可选，用于可写 rootfs）。

macOS 不支持 bwrap；本地开发使用 `mode: mock` 的假 runner，真实执行连接远程 Linux。

### 9.2 rootfs

- v1：**预置 rootfs 目录**（Node 22、git、ripgrep、常用构建工具），由运维分发并计算摘要；
- 每个 run 的 rootfs 默认**只读**；可写位置仅有 `/workspace` 与 `/tmp`；
- 若任务需要安装依赖：使用 per-run overlay（lower=rootfs，upper=临时层），或显式放开 `proxy` 网络；默认不放开；
- 后续可接 OCI 镜像：runner 缓存并解包，profile 用 digest 引用。

### 9.3 启动命令（示意）

```
bwrap \
  --unshare-all \
  --die-with-parent \
  --new-session \
  --hostname sandbox \
  --ro-bind /var/lib/autosdd/rootfs/node22 / \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --dir /run/autosdd \
  --bind /var/lib/autosdd/workspaces/<runId> /workspace \
  --bind /var/lib/autosdd/sockets/<sandboxId>/llm.sock /run/autosdd/llm.sock \
  --clearenv \
  --setenv PATH /usr/local/bin:/usr/bin:/bin \
  --setenv HOME /workspace \
  --setenv AUTOSDD_LLM_SOCKET /run/autosdd/llm.sock \
  --chdir /workspace \
  --cap-drop ALL \
  --disable-userns \
  -- /usr/local/bin/autosdd-agent
```

补充：

- 需要限制 syscall 时，由 runner 生成 seccomp 过滤器并通过 `--seccomp FD` 注入；
- `--disable-userns` 阻止沙箱内再创建 user namespace（需确认目标版本支持）；
- 不暴露 `/var/run/docker.sock`、`~/.ssh`、云实例元数据地址；
- `/proc` 只读视图，必要时 mask 敏感路径；
- 输出被 runner 截断（`maxOutputBytes`），防止日志爆量。

### 9.4 资源限制

- 通过 `systemd-run --scope`（或 cgroup v2 直接写入）设置 `MemoryMax`、`CPUQuota`、`TasksMax`、`IOWeight`；
- 磁盘：workspace 目录配额 + `du` 巡检；
- wall-clock：run TTL、步骤超时、单工具超时三层；
- `tmpfs` 大小由 profile 指定。

### 9.5 进程与回收

- runner 作为父进程监督 bwrap；`--die-with-parent` 保证 runner 退出时沙箱被杀；
- 终止顺序：`SIGTERM` → 宽限期（默认 10s）→ `SIGKILL` → 清理挂载与目录；
- 每个 sandbox 有独立目录，回收失败进入 quarantine，由 Reaper 定期重试；
- 控制面重启：run 标记失败（沿用现有语义），runner 按 TTL 继续回收；启动时执行一次对账。

---

## 10. 沙箱内 Agent Runtime

### 10.1 Job 输入

控制面组装并冻结：

```json
{
  "runId": "...",
  "stepRunId": "...",
  "agent": { "id": "...", "name": "文档专家", "role": "技术文档专家" },
  "context": {
    "systemPrompt": "...",
    "userPrompt": "...",
    "stats": { "systemChars": 0, "userChars": 0 }
  },
  "model": { "provider": "anthropic", "modelId": "deepseek-v4-flash" },
  "tools": { "...": "profile.tools" },
  "limits": { "maxToolCalls": 200, "wallClockSeconds": 600 },
  "approvalGate": false
}
```

**注意**：`context` 仍由控制面 `buildContext()` 生成，保持现有「技能/知识/依赖产物」注入逻辑不变；Runtime 只负责工具循环。

### 10.2 循环

```
收到 job
  └─► 调 LLM（经 /run/autosdd/llm.sock）→ 流式文本事件
        └─► 若返回工具调用：校验工具与参数 → 执行 → 记录结果
              └─► 把工具结果作为下一条消息继续调 LLM
                    └─► 直到无工具调用或达到 maxToolCalls
  └─► 输出最终 Markdown + usage + 工具审计
```

### 10.3 工具集（v1）

| 工具 | 能力 | 约束 |
|---|---|---|
| `fs.list` | 列目录 | 仅 `/workspace`，深度/条数上限 |
| `fs.read` | 读文本文件 | 大小上限、二进制拒绝、路径逃逸防护 |
| `fs.write` | 写文件 | 仅 `/workspace`，原子写 |
| `fs.search` | 文本检索（rg） | 结果条数上限 |
| `fs.apply_patch` | 应用 unified diff | 仅 workspace，失败不改文件 |
| `exec` | 执行白名单命令 | argv 调用、cwd=workspace、超时、输出截断 |
| `artifact.publish` | 标记产物路径 | 只记录，由 runner 统一打包 |

不提供：任意 shell、网络客户端、包管理器（除非 profile 显式允许）、宿主机路径访问、环境变量读取。

### 10.4 事件协议

```json
{ "seq": 1, "type": "message_delta", "text": "..." }
{ "seq": 2, "type": "tool_call", "tool": "fs.read", "args": { "path": "README.md" } }
{ "seq": 3, "type": "tool_result", "tool": "fs.read", "ok": true, "bytes": 1234 }
{ "seq": 4, "type": "usage", "inputTokens": 1200, "outputTokens": 800 }
{ "seq": 5, "type": "final", "outputMd": "...", "toolCalls": 3 }
```

- 事件经 runner 批量回传并落 `run_events`；
- UI 可新增「工具调用」时间线，但首期先复用现有流式输出；
- 工具输入输出中不包含 Key。

### 10.5 LLM Gateway

- 沙箱拿到的是**短期令牌**（绑定 sandboxId + runId，TTL ≤ 沙箱 TTL），通过 Unix Socket 请求；
- Gateway 只接受两类路径：`/v1/messages`（Anthropic 兼容）与 `/v1/chat/completions`（OpenAI 兼容）；
- Gateway 根据 run/step 找到模型记录，注入真实 Key 并转发；响应流式回传；
- 令牌权限：只能请求本 run 绑定的模型，不能列模型、不能改配置；
- 对上游错误做脱敏（沿用现有 `LLM_ERROR` 规则）。

---

## 11. 编排器集成

### 11.1 配置位置

- `workflows.sandbox_profile_id`（可空）：工作流级绑定，run 启动时快照；
- 首期不支持步骤级覆盖；后续可加 `workflow_steps.sandbox_overrides_json`；
- 未绑定 profile 的工作流保持现有进程内执行器路径，零影响。

### 11.2 run 流程

```
启动 run
  ├─ 冻结 workflow/agent/skill/knowledge 快照（现有逻辑）
  ├─ 若绑定 profile：
  │    ├─ Sandbox Manager 创建沙箱（ALLOCATING → PREPARING → READY）
  │    ├─ 失败 → run FAILED（SANDBOX_* 错误），不执行任何步骤
  │    └─ 成功 → 写入 run_events：SANDBOX_READY
  ├─ 逐步执行：
  │    ├─ 组装上下文（现有 buildContext）
  │    ├─ 下发 AGENT_STEP job（含上下文与工具策略）
  │    ├─ Runtime 流式回传 → STEP_DELTA/TOOL_* 事件
  │    ├─ 产物 → STEP_OUTPUT；等待审批时沙箱进入 WAITING_APPROVAL
  │    └─ 人工通过 → 下一步；驳回 → run FAILED
  └─ 收尾：收集产物 → STOPPING → STOPPED → run 终态
```

### 11.3 审批与沙箱

- 审批卡点：产物已生成，但 run 暂停；沙箱保留，`approvalTtlSeconds` 内可继续；
- 超时未处理：workspace 快照后销毁沙箱；审批通过时从快照恢复新沙箱（或要求重跑，取决于配置）；
- 驳回：直接销毁沙箱，run 失败。

### 11.4 取消、超时与重试

| 场景 | 行为 |
|---|---|
| 用户取消 | 标记 run 取消 → 下发 stop → SIGTERM/SIGKILL → 清理；事件 `RUN_CANCELED` |
| 步骤超时 | 终止当前 job，沙箱保留（可继续下一步或重跑） |
| 沙箱启动失败 | 换主机重试 1 次；仍失败则 run 失败 |
| Runtime 崩溃 | job 失败；同类基础设施错误可重试 1 次 |
| 工具失败 | 由 Agent 决定是否重试（工具结果回传模型），不自动重试 run |
| 控制面重启 | 沿用现有「进行中 run 标记失败」，runner 回收沙箱 |

### 11.5 事件与 UI

新增事件类型（沿用 `run_events`）：

`SANDBOX_ALLOCATING`、`SANDBOX_READY`、`SANDBOX_TOOL_CALL`、`SANDBOX_TOOL_RESULT`、`SANDBOX_STOPPING`、`SANDBOX_STOPPED`、`SANDBOX_FAILED`。

任务详情页增加「沙箱」面板：主机、profile、状态、TTL、工具调用列表、日志下载。

---

## 12. 安全设计

### 12.1 威胁模型

| 威胁 | 缓解 |
|---|---|
| Agent 生成恶意命令 | 命令白名单、argv 调用、无 shell、超时与输出上限 |
| 读取宿主机文件 | 只读 rootfs、仅 workspace 挂载、路径规范化 + symlink 检查 |
| 窃取模型 Key | Key 不进入沙箱；Unix Socket + 短期令牌；Gateway 注入 |
| 数据外传 | 默认无 IP 网络；proxy 模式域名白名单；审计所有 exec |
| 跨沙箱干扰 | 独立 namespace/pid/mount/net + 独立 workspace |
| 资源耗尽 | cgroup CPU/内存/pids、磁盘配额、TTL、工具超时 |
| 提权/逃逸 | 非特权 user namespace、cap-drop ALL、`--disable-userns`、可选 seccomp |
| 供应链污染 | rootfs 摘要白名单、runner 版本签名、禁止运行时安装依赖 |
| 协议重放 | mTLS + leaseToken + 事件幂等键 + 短 TTL |

### 12.2 密钥处理

- 控制面：数据库中的模型 Key 继续只用于 Gateway；接口只返回 `keySource`；
- runner：只持有自己的 mTLS 证书与注册令牌；不接触模型 Key；
- 沙箱：只有 `AUTOSDD_LLM_SOCKET` 与短期令牌（放在 tmpfs，run 结束即失效）；
- 日志与事件：不记录请求头、令牌、模型 Key；错误信息脱敏。

### 12.3 隔离强度说明

Bubblewrap **共享宿主内核**。它能有效阻止普通代码误操作与常见越权，但无法防御内核漏洞利用。因此：

- 内部团队、代码来源基本可信：bwrap 足够；
- 面向外部用户、不可信多租户：每个租户独立物理机/VM，或改用 gVisor / Firecracker；
- 该限制应写入 UI 与文档，避免把 bwrap 当成强多租户边界。

### 12.4 审计

- 每次 `exec` 记录：命令 argv、cwd、退出码、耗时、stdout/stderr 摘要、截断标记；
- 审计记录随 run 保留，可在任务详情查看；
- 沙箱创建/销毁、主机注册/排空、profile 变更均写入事件或审计表。

---

## 13. 沙箱管理界面与 API

### 13.1 页面

| 路径 | 内容 |
|---|---|
| `/sandboxes` | 概览：在线主机、活跃/排队/失败沙箱、资源占用趋势（首期数字即可） |
| `/sandboxes/hosts` | 主机列表：状态、容量、版本、标签、心跳、排空/撤销 |
| `/sandboxes/profiles` | Profile 列表与编辑：rootfs、资源、网络、工具白名单、TTL |
| `/sandboxes/:id` | 实例详情：绑定 run、状态机、事件、工具调用、日志、停止/销毁 |
| 任务详情页 | 内嵌沙箱状态与工具时间线 |

### 13.2 控制面 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/sandbox-hosts` | 列表 / 注册（生成一次性注册令牌） |
| POST | `/api/sandbox-hosts/:id/drain` | 排空 |
| DELETE | `/api/sandbox-hosts/:id` | 撤销（需无活跃沙箱） |
| GET/POST | `/api/sandbox-profiles` | 列表 / 创建 |
| GET/PUT/DELETE | `/api/sandbox-profiles/:id` | 详情 / 更新 / 删除（被引用时 409） |
| GET | `/api/sandboxes` | 按状态/host/run 过滤 |
| GET | `/api/sandboxes/:id` | 详情 |
| POST | `/api/sandboxes/:id/stop` | 停止（幂等） |
| DELETE | `/api/sandboxes/:id` | 销毁并清理 workspace |
| GET | `/api/sandboxes/:id/logs` | 日志（SSE 或文本下载） |

全部遵循现有 `{ ok, data }` / `{ ok: false, error }` 信封与 zod 校验。

### 13.3 权限

- 当前应用无登录；管理页面仅本地可访问；
- runner 接口与 UI 接口使用**不同监听端口/路由前缀**；
- 未来接入鉴权时，runner 使用机器身份，用户使用工作空间角色。

---

## 14. 配置与迁移

### 14.1 控制面配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `SANDBOX_ENABLED` | `false` | 总开关；关闭时现有执行路径不变 |
| `SANDBOX_RUNNER_BIND` | `127.0.0.1:4101` | runner 内部 API 监听地址（远程时绑私网） |
| `SANDBOX_RUNNER_TOKEN_TTL_SECONDS` | `3600` | 注册令牌有效期 |
| `SANDBOX_QUEUE_TIMEOUT_SECONDS` | `120` | 无主机可用的排队上限 |
| `SANDBOX_ARTIFACT_DIR` | `./data/artifacts` | 产物存储 |
| `SANDBOX_MAX_ARTIFACT_BYTES` | `52428800` | 单次上传上限 |
| `SANDBOX_APPROVAL_TTL_SECONDS` | `1800` | 审批等待上限 |
| `SANDBOX_HEARTBEAT_TIMEOUT_SECONDS` | `60` | 主机失联判定 |

### 14.2 runner 配置

| 变量 | 说明 |
|---|---|
| `AUTOSDD_CONTROL_URL` | 控制面 runner API 地址（HTTPS，mTLS） |
| `AUTOSDD_RUNNER_ID` / `AUTOSDD_RUNNER_TOKEN` | 注册身份 |
| `AUTOSDD_ROOTFS_DIR` | 预置 rootfs 根目录 |
| `AUTOSDD_WORKSPACE_ROOT` | workspace 根目录 |
| `AUTOSDD_MAX_SANDBOXES` | 本机并发上限 |
| `AUTOSDD_BWRAP_PATH` | bwrap 可执行文件路径 |
| `AUTOSDD_LOG_LEVEL` | 日志级别 |

### 14.3 迁移与兼容

- `003_sandboxes.sql` 只新增表与 `workflows.sandbox_profile_id` 可空列；
- 老 run 的快照没有沙箱信息，按原有执行路径展示；
- `SANDBOX_ENABLED=false` 时管理页面可只读或隐藏，行为与现在完全一致；
- 数据库升级前建议备份 `data/*.db`。

---

## 15. 可观测性与运维

- **指标**：在线主机数、活跃/排队沙箱、创建耗时 P50/P95、启动失败率、工具调用数/失败率、平均 TTL、产物大小；
- **日志**：控制面记录调度决策；runner 记录沙箱生命周期与 bwrap 退出码；均脱敏；
- **对账**：控制面启动、runner 重连、定时任务比较 DB 与主机实际沙箱列表；孤儿标记并回收；
- **回收**：TTL、失联、取消、审批超时四类触发；清理失败进 quarantine 并告警；
- **主机维护**：先 DRAINING，等待存量结束，再升级 runner；升级过程不动存量沙箱；
- **容量规划**：每主机最大并发、最小内存余量；超卖时排队而不是 OOM；
- **灾难恢复**：控制面丢失时 runner 仍能按 TTL 清理；已上传产物与控制面 DB 之间存在引用关系，需校验哈希。

---

## 16. 分阶段落地

### Phase 1：沙箱基础设施（MVP）

- 领域模型 + 迁移 + profile 校验；
- 本地 Linux runner（`mode: local`）与远程 runner 注册、心跳、租约；
- Bubblewrap 启动/停止、rootfs 只读、workspace、TTL 回收；
- 沙箱管理 API + 最小 UI（实例列表、停止、日志）；
- 工作流绑定 profile；orchestrator 走沙箱路径；
- Runtime 先支持**单次 LLM 调用**（无工具），验证端到端链路与回退语义。

**退出标准**：一个绑定 profile 的任务可在远程 Linux 沙箱中完成，事件与现有 UI 一致；取消/超时/重启均可回收。

### Phase 2：工具与完整 Agent

- 沙箱内工具循环、工具协议、审计；
- LLM Gateway over Unix Socket + 短期令牌；
- 产物收集与 workspace 延续、审批期间保留；
- 主机调度、排空、容量、对账；
- 管理 UI 完整化（hosts/profiles/instances）；
- 安全加固：seccomp、cgroups、配额、网络 proxy。

**退出标准**：Agent 能读写 workspace、执行白名单命令并产出代码/文档；恶意路径、网络与资源测试通过。

### Phase 3：生产化

- OCI rootfs 分发与签名；
- 多主机调度与亲和性、指标看板；
- 快照/恢复、per-step 隔离、并行 run；
- 更强隔离 provider（gVisor / Firecracker）可插拔；
- 鉴权与多租户（如需要）。

---

## 17. 验收标准

### 功能

- 绑定 profile 的 run 在远程沙箱完成，产物与事件可在 UI 查看；
- 未绑定 profile 的 run 行为与现在完全一致；
- 创建/停止/销毁幂等；取消与超时能回收进程与目录；
- run 结束后 workspace 与沙箱自动清理（或按保留策略）；
- 主机失联后，控制面标记孤儿并在主机恢复后对账。

### 安全

- 沙箱内无法读取宿主机文件、无法访问其它 run 的 workspace；
- 默认无 IP 网络；LLM 只能通过 Unix Socket；
- 沙箱内环境变量与文件中不存在模型 Key、数据库路径、runner 证书；
- 命令白名单外执行被拒绝并记录；
- 资源超限被 cgroup/配额拦截，不拖垮宿主机；
- 路径逃逸（`..`、symlink）测试被拒绝。

### 可靠性

- 控制面重启后无残留 run 状态与孤儿沙箱（或可自动回收）；
- runner 重启后能重新注册并接管/清理存量；
- 事件乱序、重复上报不会造成状态错乱。

### 性能（参考目标）

- 沙箱从创建到 READY ≤ 3s（已缓存 rootfs）；
- 工具调用往返（不含模型时间）≤ 50ms（本机）/ ≤ 300ms（同区域内网）；
- 单主机并发 4 个 2C4G 沙箱时，控制面与宿主负载稳定。

---

## 18. 需要确认的问题

1. **Agent Runtime 形态**：是否接受方案 B（沙箱内 Runtime + Unix Socket LLM Gateway）作为目标？还是先用方案 A 快速验证？
2. **网络策略**：是否允许 `npm install` 等操作？若允许，使用代理白名单还是按 profile 放开？
3. **rootfs 来源**：v1 用运维预置目录，还是直接接 OCI 镜像（需要镜像仓库与拉取凭据）？
4. **远程连通性**：控制面当前只监听 `127.0.0.1`。远程 runner 如何访问控制面——私网直连、VPN、SSH 反向隧道，还是引入中继？
5. **产物保存**：只保存最终产物，还是保存整个 workspace 快照？保留多久？
6. **隔离强度**：是否只服务内部团队（bwrap 足够），还是未来要接外部不可信代码（需要 VM/gVisor）？
7. **runner 实现语言**：Node（与仓库一致、开发快）还是 Go/Rust（静态二进制、进程与 cgroup 控制更稳）？
8. **沙箱粒度**：确认「一个 run 一个沙箱」；是否需要步骤级强制隔离？

---

## 19. 备选方案对比（摘要）

| 方案 | 结论 |
|---|---|
| 继续进程内执行 | 无法安全执行代码，不满足目标 |
| 控制面 SSH 到远程主机执行 | 凭据管理复杂、无法细粒度回收与审计；不推荐 |
| Docker / Podman | 生态成熟，但需要 daemon 与镜像分发；可作为第二 provider |
| gVisor | 隔离更强，适合不可信代码；依赖与运维成本更高，列入 Phase 3 |
| Firecracker | 强隔离、启动快，但需要 KVM 与镜像管理；列入 Phase 3 |
| **Bubblewrap + 自建 runner（本设计）** | 轻量、无 daemon、约束明确，适合当前内部单团队场景；通过 provider 接口保留升级路径 |
