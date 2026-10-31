# AutoSDD

一个 **可本地运行的 SDLC 系统最小实现**：把「谁来干、按什么顺序干、干得怎么样」三件事收敛成三个可操作的对象——

1. **Agent 管理**：角色化智能体，可挂载 **Skill**（可复用指令包）与 **Knowledge**（项目规则、业务术语、API 规范等）。
2. **Workflow 管理**：编排一个任务由哪些 Agent 按什么顺序执行；步骤间用显式 `depends_on` 表达依赖，数据模型与引擎天然支持 DAG，当前 UI 只创建线性链。
3. **任务管理**：按场景/关键词自动匹配工作流，启动执行，实时观察流式输出、步骤状态与人工审批卡点。
4. **模型管理**：把 Mock / Anthropic / OpenAI 兼容端点注册为一等资产，可测试连通性、设置默认模型，并由每个 Agent 显式选择。

默认使用 **Mock 模型**，不需要任何 API Key 就能完整体验；在「模型管理」中注册 Anthropic 或 OpenAI 兼容模型并填入 Key 后，即可让 Agent 调用真实模型。

> 文档：[使用指南](docs/guide/README.md) · [设计文档](docs/design/README.md) · [功能清单](docs/FEATURES.md)。

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

首次启动会自动建表并写入演示数据（7 个 Agent、9 个 Skill、8 条知识、4 个工作流、2 个内置模型、1 个已完成任务 + 2 个待运行任务）。手动管理种子数据：

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
| `ANTHROPIC_API_KEY` | — | 未在界面保存 Key 时的兜底，仅服务端使用 |
| `OPENAI_API_KEY` | — | OpenAI 兼容模型的兜底 Key，仅服务端使用 |
| `MOCK_DELAY_MS` | `250` | Mock 每片输出的延迟 |
| `MOCK_FAIL_STEP` | — | 步骤名或任务标题命中即失败，演示失败态 |
| `STEP_TIMEOUT_SECONDS` | `300` | 单步超时 |

---

## 一次完整演示

1. `/models`：查看内置的 Mock（默认）与 Claude Sonnet 5；新建 OpenAI 兼容模型（如本地 Ollama `http://127.0.0.1:11434/v1`），「测试连接」会真实调用一次模型。Key 只在保存时提交，列表只显示来源。
2. `/agents`：查看/新建 Agent，选择模型，挂载若干 Skill 与知识；进入详情页的「上下文预览」可查看最终拼装的 system/user prompt 与截断情况。
3. `/workflows`：打开「新功能开发」，看到 5 步管线（需求分析 → 架构设计 → 编码实现 → 质量验证 → 代码评审），其中「编码实现」「代码评审」为人工卡点；另有独立的「代码文档编写与评审」（文档编写 → 架构师评审），文档以任务中提供的代码为唯一事实来源。所有步骤都可修改 Agent、指令、依赖与超时。
4. `/tasks` → 「新建任务」：填写标题与描述，系统按场景/关键词/标签打分给出推荐工作流（含命中原因），确认后「创建并运行」。
5. 任务详情页：SSE 实时显示步骤流转与流式输出；到卡点暂停并弹出审批横幅，可填写意见后「通过 / 驳回」。
6. 最终状态与产物、事件日志持久化；刷新或重启服务后历史仍在。终端任务可一键重跑（生成新的 `run_number`，旧 run 只读）。

失败演示：在描述或步骤指令中加入 `[fail]`，或设置 `MOCK_FAIL_STEP=编码实现`。

---

## 架构

```
React SPA (Vite, TanStack Query)
        │ REST /api/*        │ SSE /api/runs/:runId/stream
        ▼                    ▼
Fastify Server ── 路由 / zod 校验 / 统一 envelope
  ├─ Domain：agents · skills · knowledge · models · workflows · tasks
  ├─ Execution：context-builder · orchestrator · executors(mock|anthropic|openai) · run-events
  └─ Overview：聚合指标
        │
   SQLite (node:sqlite)
```

```
autosdd/
├── apps/server/        # Fastify + 编排器 + SQLite 仓储
├── apps/web/           # React 控制台
├── packages/shared/    # 领域类型、zod schema、状态常量（前后端共享）
├── e2e/                # Playwright 冒烟测试与截图脚本
└── docs/               # 使用指南、设计文档、功能清单
    ├── guide/          # 使用指南与截图
    ├── design/         # 分主题设计文档
    └── FEATURES.md     # 已实现 / 待实现功能清单
```

### 关键设计

- **平台驱动的编排**：任务启动时冻结 workflow/agent/skill/knowledge 快照，创建 run 与全部 step_run；引擎按「依赖全部成功」计算就绪集合，当前并发为 1。审批通过的步骤才算成功，失败/驳回终止整条 run。
- **人工卡点**：`gate_mode=HUMAN_APPROVAL` 的步骤执行完进入 `WAITING_APPROVAL`，产物可审阅；通过后继续，驳回则 run 失败。
- **实时观察**：所有状态变化写入 `run_events` 并广播；SSE 支持 `Last-Event-ID` / `?after=` 回放与 15s 心跳，断线重连带游标。
- **确定性场景匹配**：场景精确 +10，关键词命中每个 +3，标签命中每个 +1；仅启用的工作流参与，返回 top 3 与命中原因，不依赖 LLM。
- **上下文预算**：skills ≤ 8k、knowledge ≤ 12k、依赖产物 ≤ 12k 字符；超限按条目截断并提示（system 总预算常量预留，详见 `docs/design/10-context.md`）。
- **模型注册表**：模型是一等资产（provider / baseUrl / maxTokens / Key 来源），执行时按 Agent 绑定的模型逐步解析执行器；未绑定则跟随默认模型，模型缺失或停用会让步骤以明确错误失败。
- **可插拔执行器**：`AgentExecutor` 统一流式事件、取消与超时语义；Mock、Anthropic 与 OpenAI 兼容实现可互换。

### API 一览

`GET/POST/PUT/DELETE` 覆盖 `/api/agents`、`/api/agents/:id/mounts`、`/api/agents/:id/context-preview`、`/api/skills`、`/api/knowledge`、`/api/models`（含 `:id/default`、`:id/test`）、`/api/workflows`、`/api/workflows/:id/validate`、`/api/workflows/match`、`/api/tasks`、`/api/tasks/:id/run|cancel|runs`、`/api/runs/:runId`、`/api/runs/:runId/events`、`/api/runs/:runId/stream`、`/api/runs/:runId/steps/:stepRunId/approval`、`/api/overview`。

响应统一为 `{ ok: true, data }` 或 `{ ok: false, error: { code, message, details? } }`。

---

## 测试

```bash
pnpm typecheck      # 四个包全量类型检查
pnpm test           # server 115 个（单元 + 集成） + web 16 个组件测试
pnpm test:coverage  # server：lines 75 / funcs 75 / branches 70 / statements 75 门禁
pnpm e2e            # 先构建 web，再以 4100 端口起真实服务跑 Playwright
```

首次运行 E2E 前安装浏览器：

```bash
pnpm --filter @autosdd/e2e exec playwright install chromium
```

E2E 使用独立库 `apps/server/data/e2e.db`（启动前清理），覆盖「新建任务 → 自动匹配 → 运行 → 两次审批 → 成功 → 刷新后历史仍在」，并冒烟模型管理的连接测试。

---

## 安全边界（请勿直接用于生产）

- **无鉴权、单工作空间**；默认只绑定 `127.0.0.1`，不要改为公网地址暴露。
- Markdown 渲染不启用原始 HTML。模型 API Key 可存于本地 SQLite（明文，仅本机演示），接口只返回来源（`stored` / `env` / `none`），永不回传明文；未保存时回退 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`。生产环境应接入密钥管理。
- 进程内编排、单并发；服务重启时进行中的 run 会被标记失败（`SERVER_RESTARTED`），等待审批的 run 保留。
- 当前取舍：Agent 版本评审/回滚、记忆审核、向量检索、多租户、IM、对象存储均未实现；详见设计文档「已知限制与后续路线」。

## 技术偏差说明

数据层使用 Node 内置 `node:sqlite` 的 `DatabaseSync`，而非 better-sqlite3：避免原生 addon 编译，代价是 Node ≥ 22.13 且启动会出现一次 `ExperimentalWarning`。`db/database.ts` 用门面保持仓储调用形态不变，未来可平滑替换。
