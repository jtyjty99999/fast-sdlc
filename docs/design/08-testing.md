# 测试策略与验证

> 所属：[AutoSDD 设计文档](README.md)
> 相关：[功能清单](../FEATURES.md) · [执行引擎](04-execution.md)

---

## 测试策略

| 层级 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | matcher 打分/原因、context-builder 顺序与截断、workflow validator（环/缺依赖/Agent 禁用）、状态迁移辅助 |
| 集成 | Vitest + `app.inject` | Agent/Skill/Knowledge CRUD 与挂载、Workflow CRUD/校验、任务全生命周期（mock）：成功、审批通过、审批驳回、失败、取消、重跑、409 冲突 |
| 组件 | Vitest + RTL | StatusBadge、步骤管线、匹配推荐、审批横幅、上下文预览 |
| E2E | Playwright | 创建任务 → 自动匹配 → 运行 → 两次审批 → 成功；断言实时状态与产物 |

- 测试库使用 `:memory:`，每个测试独立 app 实例；Mock 延迟设为 0。
- 服务端覆盖率门禁（`@vitest/coverage-v8`）：lines 75 / functions 75 / branches 70 / statements 75。
- E2E 使用独立数据库 `apps/server/data/e2e.db`（端口 4100，启动前清理），`MOCK_DELAY_MS=5` 控制时长；要求先 `pnpm build`，server 直接托管 `apps/web/dist`。

**当前实测（2026-10-31）**

| 指标 | 结果 |
|---|---|
| 服务端测试 | 115 个测试全部通过 |
| 服务端覆盖率 | statements 86.03%、branches 71.19%、functions 90.13%、lines 88.86% |
| 前端组件测试 | 16 个测试全部通过 |
| E2E | 2 条（任务全生命周期 + 模型连接测试）通过 |


## 验证清单

- [x] `pnpm typecheck` 通过
- [x] `pnpm test` 通过（server 115 + web 16）；覆盖率高于门禁
- [x] `pnpm build` 成功；`pnpm start` 单端口可访问（E2E 即以此形态运行）
- [x] 创建 Agent 并挂载技能/知识，上下文预览顺序正确（集成测试覆盖）
- [x] 创建含人工卡点的 Workflow，校验错误可见（集成测试覆盖）
- [x] 任务自动匹配 Workflow；运行后 SSE 实时更新（集成 + E2E 覆盖）
- [x] 审批通过继续、驳回失败、取消、重跑、服务重启恢复符合预期（集成测试覆盖）
- [x] 模型 CRUD、Key 永不回传、默认切换与删除/停用保护（集成测试覆盖）
- [x] E2E 冒烟通过（任务生命周期 + 模型连接测试）
