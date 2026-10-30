# AutoSDD

一个 **AutoWonder 风格 SDLC 系统的最小可运行实现**：把「谁来干、按什么顺序干、干得怎么样」三件事收敛成三个可操作的对象——

1. **Agent 管理**：角色化智能体，可挂载 **Skill**（可复用指令包）与 **Knowledge**（项目规则、业务术语、API 规范等）。
2. **Workflow 管理**：编排一个任务由哪些 Agent 按什么顺序执行；步骤间用显式 `depends_on` 表达依赖，数据模型与引擎天然支持 DAG，当前 UI 只创建线性链。
3. **任务管理**：按场景/关键词自动匹配工作流，启动执行，实时观察流式输出、步骤状态与人工审批卡点。

默认使用 **Mock 执行器**，不需要任何 API Key 就能完整体验；配置 `ANTHROPIC_API_KEY` 后切换为真实 Claude 模型。

> 参考：阿里云 [alibabacloud-landing-zone / ai-sdlc / auto-wonder](https://github.com/aliyun/alibabacloud-landing-zone/tree/master/ai-sdlc)。详细设计见 [`docs/DESIGN.md`](docs/DESIGN.md)。

---

## 快速开始

要求 **Node ≥ 22.13**（使用内置 `node:sqlite`）与 **pnpm 11**。

```bash
pnpm install

# 开发模式：server(4000) + web(5173，Vite 代理 /api 与 SSE)
pnpm dev
# 打开 http://127.0.0.1:5173
```

生产形态（单端口托管前端构建产物）：

```bash
pnpm build
pnpm start        # http://127.0.0.1:4000
```

首次启动会自动建表并写入演示数据（6 个 Agent、8 个 Skill、8 条知识、3 个工作流、1 个已完成任务 + 1 个待运行任务）。手动管理种子数据：

```bash
pnpm seed               # 空库时写入，已有数据则跳过
pnpm --filter @autosdd/server seed -- --force   # 清空并重建
```

### 配置

所有变量可选，复制 `apps/server/.env.example` 为 `apps/server/.env` 即可被 `dev/start` 自动加载：

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 仅本机访问 |
| `PORT` | `4000` | 服务端口 |
| `DATABASE_PATH` | `./data/autosdd.db` | SQLite 文件（相对 `apps/server`） |
| `LLM_PROVIDER` | `auto` | `auto` / `mock` / `anthropic` |
| `ANTHROPIC_API_KEY` | — | 仅服务端；`auto` 模式下有它就用真实模型 |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Agent 可用自身 `model` 覆盖 |
| `MOCK_DELAY_MS` | `250` | Mock 每片输出的延迟 |
| `MOCK_FAIL_STEP` | — | 步骤名或任务标题命中即失败，演示失败态 |
| `STEP_TIMEOUT_SECONDS` | `300` | 单步超时 |

---

## 一次完整演示

1. `/agents`：查看/新建 Agent，挂载若干 Skill 与知识；进入详情页的「上下文预览」可查看最终拼装的 system/user prompt 与截断情况。
2. `/workflows`：打开「新功能开发」，看到 5 步管线（需求分析 → 架构设计 → 编码实现 → 质量验证 → 代码评审），其中「编码实现」「代码评审」为人工卡点；可修改 Agent、指令、依赖与超时。
3. `/tasks` → 「新建任务」：填写标题与描述，系统按场景/关键词/标签打分给出推荐工作流（含命中原因），确认后「创建并运行」。
4. 任务详情页：SSE 实时显示步骤流转与流式输出；到卡点暂停并弹出审批横幅，可填写意见后「通过 / 驳回」。
5. 最终状态与产物、事件日志持久化；刷新或重启服务后历史仍在。终端任务可一键重跑（生成新的 `run_number`，旧 run 只读）。

失败演示：在描述或步骤指令中加入 `[fail]`，或设置 `MOCK_FAIL_STEP=编码实现`。

---

## 架构

```
React SPA (Vite, TanStack Query)
        │ REST /api/*        │ SSE /api/runs/:runId/stream
        ▼                    ▼
Fastify Server ── 路由 / zod 校验 / 统一 envelope
  ├─ Domain：agents · skills · knowledge · workflows · tasks
  ├─ Execution：context-builder · orchestrator · executors(mock|anthropic) · run-events
  └─ Overview：聚合指标
        │
   SQLite (node:sqlite)
```

```
autosdd/
├── apps/server/        # Fastify + 编排器 + SQLite 仓储
├── apps/web/           # React 控制台
├── packages/shared/    # 领域类型、zod schema、状态常量（前后端共享）
├── e2e/                # Playwright 冒烟测试
└── docs/DESIGN.md      # 详细设计文档
```

### 关键设计

- **平台驱动的编排**：任务启动时冻结 workflow/agent/skill/knowledge 快照，创建 run 与全部 step_run；引擎按「依赖全部成功」计算就绪集合，当前并发为 1。审批通过的步骤才算成功，失败/驳回终止整条 run。
- **人工卡点**：`gate_mode=HUMAN_APPROVAL` 的步骤执行完进入 `WAITING_APPROVAL`，产物可审阅；通过后继续，驳回则 run 失败。
- **实时观察**：所有状态变化写入 `run_events` 并广播；SSE 支持 `Last-Event-ID` / `?after=` 回放与 15s 心跳，断线重连带游标。
- **确定性场景匹配**：场景精确 +10，关键词命中每个 +3，标签命中每个 +1；仅启用的工作流参与，返回 top 3 与命中原因，不依赖 LLM。
- **上下文预算**：system ≤ 24k、skills ≤ 8k、knowledge ≤ 12k、依赖产物 ≤ 12k 字符；超限按条目截断并提示。
- **可插拔执行器**：`AgentExecutor` 统一流式事件、取消与超时语义；Mock 与 Anthropic 实现可互换。

### API 一览

`GET/POST/PUT/DELETE` 覆盖 `/api/agents`、`/api/agents/:id/mounts`、`/api/agents/:id/context-preview`、`/api/skills`、`/api/knowledge`、`/api/workflows`、`/api/workflows/:id/validate`、`/api/workflows/match`、`/api/tasks`、`/api/tasks/:id/run|cancel|runs`、`/api/runs/:runId`、`/api/runs/:runId/events`、`/api/runs/:runId/stream`、`/api/runs/:runId/steps/:stepRunId/approval`、`/api/overview`。

响应统一为 `{ ok: true, data }` 或 `{ ok: false, error: { code, message, details? } }`。

---

## 测试

```bash
pnpm typecheck      # 四个包全量类型检查
pnpm test           # server 87 个（单元 + 集成） + web 12 个组件测试
pnpm test:coverage  # server：lines 75 / funcs 75 / branches 70 / statements 75 门禁
pnpm e2e            # 先构建 web，再以 4100 端口起真实服务跑 Playwright
```

首次运行 E2E 前安装浏览器：

```bash
pnpm --filter @autosdd/e2e exec playwright install chromium
```

E2E 使用独立库 `apps/server/data/e2e.db`（启动前清理），覆盖「新建任务 → 自动匹配 → 运行 → 两次审批 → 成功 → 刷新后历史仍在」。

---

## 安全边界（请勿直接用于生产）

- **无鉴权、单工作空间**；默认只绑定 `127.0.0.1`，不要改为公网地址暴露。
- Markdown 渲染不启用原始 HTML，API Key 只存在于服务端环境变量。
- 进程内编排、单并发；服务重启时进行中的 run 会被标记失败（`SERVER_RESTARTED`），等待审批的 run 保留。
- 与参考实现相比的取舍：Agent 版本评审/回滚、记忆审核、向量检索、多租户、IM、对象存储均未实现；详见设计文档「已知限制与后续路线」。

## 技术偏差说明

数据层使用 Node 内置 `node:sqlite` 的 `DatabaseSync`，而非 better-sqlite3：避免原生 addon 编译，代价是 Node ≥ 22.13 且启动会出现一次 `ExperimentalWarning`。`db/database.ts` 用门面保持仓储调用形态不变，未来可平滑替换。
