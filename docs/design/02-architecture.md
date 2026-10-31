# 总体架构与技术栈

> 所属：[AutoSDD 设计文档](README.md)
> 相关：[产品定位](01-product.md) · [执行引擎](04-execution.md) · [测试策略](08-testing.md)

---

## 总体架构

```
┌────────────────────────────────────────────────────────────┐
│                     Browser (React + Vite)                 │
│  总览 / Agent / Skill / 知识 / Workflow / Task / 运行观察    │
└───────────────┬───────────────────────────┬────────────────┘
                │ REST (JSON)               │ SSE (run events)
┌───────────────▼───────────────────────────▼────────────────┐
│                      Fastify Server                        │
│  HTTP 层：路由 / zod 校验 / 统一 envelope / 错误映射          │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ Domain       │  │ Execution    │  │ Overview        │   │
│  │ Agent/Skill  │  │ Context      │  │ 聚合查询         │   │
│  │ Knowledge    │  │ Builder      │  │                 │   │
│  │ Workflow     │  │ Orchestrator │  │                 │   │
│  │ Task         │  │ Executors    │  │                 │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘   │
│         └─────────────────┴───────────────────┘            │
│                      SQLite (node:sqlite)                  │
└────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript 5.9 | 前后端共享类型 |
| 后端 | Node 22.13+ + Fastify 5 | 轻量、schema 友好、SSE 易实现 |
| 数据库 | SQLite + 内置 `node:sqlite`（`DatabaseSync`） | 零运维、同步 API、天然适合单进程编排；无需原生编译 |
| 校验 | zod 4 | 请求边界校验，前后端共享 schema |
| 前端 | React 19 + Vite 8 + React Router 7 | 控制台 SPA |
| 数据请求 | TanStack Query 5 | 缓存、失效、轮询兜底 |
| Markdown | react-markdown 10 + remark-gfm | 默认不渲染原始 HTML，规避 XSS |
| 测试 | Vitest 5 + RTL + Playwright 1.64 | 单元 / 集成 / E2E |
| 模型 | 模型注册表：Mock / Anthropic SDK / OpenAI 兼容（fetch 流式） | 默认 Mock，无 Key 可完整演示；其余在界面注册 |

选择 **SQLite + 手写 SQL** 而非 ORM：本系统表少、查询明确，手写 SQL 可读、可控，事务边界清晰；迁移用简单的顺序 SQL 文件 + `schema_migrations` 表。同步 API 也让编排器状态更新天然串行，避免异步写竞争。

数据库驱动使用 Node 内置的 `node:sqlite`（`DatabaseSync`），并以 `Db` 门面把 `prepare/exec/transaction` 包装成与 better-sqlite3 一致的调用形态。这样无需原生 addon 编译（CI、容器、arm64 都省事），代价是要求 Node ≥ 22.13，且启动时会出现一次 `ExperimentalWarning: SQLite is an experimental feature`，可忽略。若未来需要更强的 SQLite 特性（自定义函数、备份 API），只需替换 `db/database.ts` 的实现，仓储层不变。

### 运行形态

- 开发：`pnpm dev` 同时启动 server（4000）与 web（5173），Vite 代理 `/api` 与 SSE。
- 生产演示：`pnpm build && pnpm start`，server 托管 `apps/web/dist`，单进程单端口。
- 单工作空间、无登录；SQLite 文件默认 `./data/autosdd.db`。
- 配置全部来自环境变量；`apps/server/.env.example` 列出全部变量，`dev/start/seed` 通过 `tsx --env-file-if-exists=.env` 自动加载 `apps/server/.env`（该文件被 git 忽略）。
- 编排器与 HTTP 服务同进程；进程内 `EventEmitter` + 持久化事件表实现观察与回放。


## 工程结构

```
autosdd/
├── package.json                 # workspace 脚本
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   ├── guide/                   # 使用指南与截图
│   ├── design/                  # 设计文档（本目录）
│   └── FEATURES.md              # 功能清单
├── README.md
├── packages/shared/
│   └── src/{index,types,schemas,constants}.ts
├── apps/server/
│   ├── src/
│   │   ├── index.ts             # 监听入口
│   │   ├── app.ts               # buildApp（可测试）
│   │   ├── config.ts
│   │   ├── db/{database,migrate,seed}.ts + migrations/{001_init,002_models}.sql
│   │   ├── http/{errors,respond,validate}.ts
│   │   ├── domain/agents/…      # repository / service / routes / schemas
│   │   ├── domain/skills/…
│   │   ├── domain/knowledge/…
│   │   ├── domain/workflows/…   # + matcher / validator
│   │   ├── domain/models/…      # repository / service / routes
│   │   ├── domain/tasks/…
│   │   ├── execution/{types,context-builder,run-events,orchestrator,recovery}.ts
│   │   ├── execution/executors/{mock,anthropic,openai,factory}.ts
│   │   └── overview/routes.ts
│   └── test/*.test.ts
├── apps/web/
│   ├── index.html / vite.config.ts
│   └── src/
│       ├── main.tsx / App.tsx / router.tsx
│       ├── api/{client,hooks,sse}.ts
│       ├── styles/{tokens,global}.css
│       ├── components/*.tsx + *.css
│       └── pages/{Overview,Agents,AgentDetail,Skills,Knowledge,Models,Workflows,WorkflowEditor,Tasks,TaskDetail}
└── e2e/{playwright.config.ts,tests/smoke.spec.ts}
```
