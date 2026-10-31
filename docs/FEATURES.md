# 功能清单

> 最后更新：2026-10-31
> 状态图例：✅ 已实现 · 📐 设计完成、未实现 · 📋 计划中
> 维护约定：新增/调整功能时，同步更新本表、对应设计文档与使用指南；设计文档描述**当前实现**，草案单独标注。

---

## 已实现

### 资产与配置

| 功能 | 说明 | 文档 | 代码入口 |
|---|---|---|---|
| ✅ Agent 管理 | 创建/编辑/删除角色化 Agent，配置身份、系统提示词、模型与状态 | [领域模型](design/03-domain-model.md) · [执行引擎](design/04-execution.md) | `apps/server/src/domain/agents/` |
| ✅ Skill 管理 | Skill CRUD、分类与指令正文，删除时级联解除挂载 | [领域模型](design/03-domain-model.md) | `apps/server/src/domain/skills/` |
| ✅ 知识库 | 知识 CRUD、类型与标签，按 Agent 挂载 | [领域模型](design/03-domain-model.md) · [上下文管理](design/10-context.md) | `apps/server/src/domain/knowledge/` |
| ✅ Agent 挂载 | 整体替换 Agent 的 Skill/知识挂载，保留注入顺序 | [上下文管理](design/10-context.md) | `apps/server/src/domain/agents/` |
| ✅ 上下文预览 | 预览 System/User Prompt、分段字符数、知识条数与截断标记 | [上下文管理](design/10-context.md) · [使用指南](guide/README.md#42-上下文预览) | `apps/server/src/execution/context-builder.ts` |
| ✅ 模型注册表 | 模型 CRUD、默认模型、启用/停用、Agent 引用保护 | [执行引擎](design/04-execution.md) · [API](design/05-api.md) | `apps/server/src/domain/models/` |
| ✅ 模型连接测试 | 对已保存模型真实调用一次，返回延迟与样例；Mock 直接成功 | [执行引擎](design/04-execution.md) | `apps/server/src/domain/models/service.ts` |
| ✅ Key 来源管理 | Key 只写不读，接口仅返回 `stored/env/none`；支持环境变量兜底 | [安全与边界](design/07-security.md) | `apps/server/src/domain/models/` |
| ✅ 多模型执行器 | Mock、Anthropic SDK、OpenAI Chat Completions 兼容（fetch 流式） | [执行引擎](design/04-execution.md) | `apps/server/src/execution/executors/` |
| ✅ 空产物诊断 | 推理耗尽 `max_tokens` / `finish_reason=length` 时提示调大 Max Tokens | [执行引擎](design/04-execution.md) | `apps/server/src/execution/executors/empty-output.ts` |

### 编排与执行

| 功能 | 说明 | 文档 | 代码入口 |
|---|---|---|---|
| ✅ 工作流管理 | 工作流 CRUD、步骤编排、整体替换（事务） | [领域模型](design/03-domain-model.md) · [使用指南](guide/README.md#6-工作流) | `apps/server/src/domain/workflows/` |
| ✅ 工作流校验 | 空步骤、依赖缺失/成环、Agent 停用等保存前校验 | [领域模型](design/03-domain-model.md) | `apps/server/src/domain/workflows/validator.ts` |
| ✅ 依赖调度（DAG 数据模型） | 按 `depends_on` 计算就绪集合；当前执行并发为 1，UI 维护线性链 | [执行引擎](design/04-execution.md) | `apps/server/src/execution/orchestrator.ts` |
| ✅ 场景匹配 | 场景 +10、关键词每个 +3、标签每个 +1，返回 top 3 与命中原因 | [执行引擎](design/04-execution.md) | `apps/server/src/domain/workflows/matcher.ts` |
| ✅ 运行快照 | 启动时冻结工作流、Agent、Skill、知识；重跑重新冻结 | [上下文管理](design/10-context.md) | `apps/server/src/execution/snapshot.ts` |
| ✅ 上下文组装 | 身份/技能/知识/输出契约 + 任务/步骤/依赖产物，按预算截断 | [上下文管理](design/10-context.md) | `apps/server/src/execution/context-builder.ts` |
| ✅ 任务执行 | 创建、启动、逐步执行、终态收敛、失败与死锁检测 | [执行引擎](design/04-execution.md) | `apps/server/src/execution/orchestrator.ts` |
| ✅ 人工审批 | 步骤产物生成后暂停，通过后继续、驳回终止 | [领域模型](design/03-domain-model.md) · [使用指南](guide/README.md#72-实时执行与人工审批) | `apps/server/src/execution/orchestrator.ts` |
| ✅ 取消与重跑 | 取消活跃 run；终态任务创建新 run，旧 run 只读 | [执行引擎](design/04-execution.md) | `apps/server/src/execution/orchestrator.ts` |
| ✅ 重启恢复 | 进行中 run 标记 `SERVER_RESTARTED`；待审批 run 保留并可继续 | [执行引擎](design/04-execution.md) | `apps/server/src/execution/recovery.ts` |
| ✅ 超时控制 | 每步 `AbortSignal` 超时（默认 300s，可配置） | [执行引擎](design/04-execution.md) | `apps/server/src/execution/orchestrator.ts` |
| ✅ 独立文档工作流 | 「代码文档编写与评审」：文档编写 → 架构师对照代码评审 | [产品定位](design/01-product.md#演示数据) · [使用指南](guide/README.md#8-用代码文档编写与评审工作流写文档) | `apps/server/src/db/seed-data.ts` |

### 观察与体验

| 功能 | 说明 | 文档 | 代码入口 |
|---|---|---|---|
| ✅ 总览 | Agent/Skill/知识/工作流计数、成功率、最近任务、执行器信息 | [前端设计](design/06-frontend.md) | `apps/server/src/overview/` · `apps/web/src/pages/OverviewPage.tsx` |
| ✅ SSE 实时输出 | 状态事件 + 流式增量；支持 `Last-Event-ID` / `?after=` 回放与心跳 | [API 与事件](design/05-api.md) | `apps/server/src/execution/run-events.ts` · `apps/web/src/api/sse.ts` |
| ✅ 任务详情 | 步骤时间线、产物、输入上下文、事件、元数据、审批横幅 | [前端设计](design/06-frontend.md) · [使用指南](guide/README.md#7-任务) | `apps/web/src/pages/TaskDetailPage.tsx` |
| ✅ 统一错误体验 | `{ok,data}` / `{ok:false,error}` 信封；错误码与可操作提示 | [API 与事件](design/05-api.md) | `apps/server/src/http/` |
| ✅ 演示种子数据 | 7 Agent、9 Skill、8 知识、4 工作流、2 模型、3 任务 | [产品定位](design/01-product.md#演示数据) | `apps/server/src/db/seed-data.ts` |
| ✅ 使用指南与截图 | 全流程图文指南，截图脚本可重复生成 | [使用指南](guide/README.md) | `e2e/scripts/screenshots.mjs` |

### 工程与质量

| 功能 | 说明 | 文档 | 代码入口 |
|---|---|---|---|
| ✅ 类型共享 | 前后端共享领域类型、zod schema 与状态常量 | [总体架构](design/02-architecture.md) | `packages/shared/` |
| ✅ 数据库迁移 | 顺序 SQL + `schema_migrations`，现有 `001_init`、`002_models` | [领域模型](design/03-domain-model.md) | `apps/server/src/db/migrations/` |
| ✅ 测试体系 | 单元 + 集成 + 组件 + Playwright E2E；覆盖率门禁 | [测试策略](design/08-testing.md) | `apps/server/test/` · `apps/web/src/**/*.test.tsx` · `e2e/` |
| ✅ 本地安全边界 | 默认 127.0.0.1、无鉴权、Key 不回传、Markdown 不渲染 HTML | [安全与边界](design/07-security.md) | `apps/server/src/config.ts` · `apps/web/src/components/Markdown.tsx` |

---

## 待实现

### 设计完成、待实现

| 功能 | 说明 | 文档 | 状态 |
|---|---|---|---|
| 📐 远程沙箱执行 | Agent 在远程 Linux 主机的 Bubblewrap 沙箱内运行，控制面/数据面分离 | [远程沙箱设计](design/11-sandbox.md) | 设计草案，待评审 |
| 📐 沙箱管理 | 主机注册/心跳/排空、Profile、实例生命周期、TTL、配额、对账 | [沙箱管理](design/11-sandbox.md#6-沙箱领域模型) · [管理界面](design/11-sandbox.md#13-沙箱管理界面与-api) | 设计草案 |
| 📐 沙箱内 Agent Runtime | 工具循环（文件读写、检索、命令执行）、事件回传、产物收集 | [Agent Runtime](design/11-sandbox.md#10-沙箱内-agent-runtime) | 设计草案 |
| 📐 Runner 协议 | 出站 mTLS、注册、心跳、任务租约、事件与结果上报 | [Runner 协议](design/11-sandbox.md#8-runner-协议控制面--runner) | 设计草案 |
| 📐 LLM Gateway | 沙箱通过 Unix Socket 访问模型，Key 不进入沙箱 | [LLM Gateway](design/11-sandbox.md#105-llm-gateway) | 设计草案 |
| 📐 沙箱 UI/API | `/sandboxes` 主机/Profile/实例管理页与控制面 API | [沙箱管理界面与 API](design/11-sandbox.md#13-沙箱管理界面与-api) | 设计草案 |

### 计划中

| 功能 | 说明 | 文档 | 优先级 |
|---|---|---|---|
| 📋 多租户与鉴权 | 登录、SSO、RBAC、工作空间隔离、Postgres | [后续路线](design/09-roadmap.md) | 高（生产化前置） |
| 📋 run 级 checkpoint | 进程重启后从最后完成步骤恢复，而非整条失败 | [后续路线](design/09-roadmap.md) | 高 |
| 📋 重试预算 | `step.attempt` + 退避 + 可重试错误分类 | [后续路线](design/09-roadmap.md) | 中 |
| 📋 DAG 画布与并行 | 分支、汇聚、并行调度；引擎已具备 DAG 就绪队列 | [后续路线](design/09-roadmap.md) | 中 |
| 📋 知识检索 | BM25/向量检索替代 50 条全量注入，渐进式加载 | [后续路线](design/09-roadmap.md) · [上下文管理](design/10-context.md#8-边界与已知限制) | 中 |
| 📋 Agent 版本管理 | 版本快照、评审、发布、回滚、差异对比 | [后续路线](design/09-roadmap.md) | 中 |
| 📋 成本与配额看板 | Token/费用聚合、预算与告警 | [后续路线](design/09-roadmap.md) | 低 |
| 📋 IM 与通知 | 审批提醒、站内信、Webhook | [后续路线](design/09-roadmap.md) | 低 |
| 📋 Skill 文件上传 | SKILL.md / zip 解析与版本管理 | [后续路线](design/09-roadmap.md) | 低 |
| 📋 对象存储 | 产物与大文件外置到 OSS/S3 | [后续路线](design/09-roadmap.md) | 低 |
| 📋 本地执行器 daemon | WebSocket 调度、任务包、Claude Code / CLI 执行器 | [后续路线](design/09-roadmap.md) | 中（与沙箱方案衔接） |

---

## 文档对应关系

| 文档 | 覆盖内容 |
|---|---|
| [设计文档索引](design/README.md) | 阅读路径、文档约定、模块导航 |
| [产品定位](design/01-product.md) | 背景、目标、非目标、设计取舍、演示数据 |
| [总体架构](design/02-architecture.md) | 技术栈、运行形态、工程结构 |
| [领域模型](design/03-domain-model.md) | ER 图、表设计、状态机、一致性约束 |
| [执行引擎](design/04-execution.md) | 上下文、执行器、编排器、匹配、恢复 |
| [API 与事件](design/05-api.md) | REST 接口、统一信封、SSE 事件 |
| [前端设计](design/06-frontend.md) | 信息架构、视觉语言、页面线框、实时状态 |
| [安全与边界](design/07-security.md) | 风险与措施、部署边界 |
| [测试策略](design/08-testing.md) | 测试分层、覆盖率门禁、验证清单 |
| [后续路线](design/09-roadmap.md) | 已知限制与演进方向 |
| [上下文管理](design/10-context.md) | 上下文来源、预算、跨步骤共享与限制 |
| [远程沙箱设计](design/11-sandbox.md) | 沙箱架构、领域模型、Runner、bubblewrap、安全（草案） |
| [使用指南](guide/README.md) | 安装配置、页面操作、完整演示与排查 |
