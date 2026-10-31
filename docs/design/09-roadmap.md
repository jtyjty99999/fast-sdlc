# 已知限制与后续路线

> 所属：[AutoSDD 设计文档](README.md)
> 相关：[功能清单](../FEATURES.md) · [远程沙箱设计](11-sandbox.md)

---

## 已知限制与后续路线

| 限制 | 后续 |
|---|---|
| 单进程、单工作空间 | 多租户 + RBAC + Postgres |
| 线性 UI，引擎已支持 DAG | DAG 画布、分支条件、并行调度、汇聚 |
| 进程重启中断运行 | run 级 checkpoint，从最后完成步骤恢复 |
| 无重试预算 | step.attempt + retry budget + 退避 |
| 知识全量注入 | 检索（BM25）+ 渐进式加载（L0–L2） |
| 无 Agent 版本 | 版本快照、评审、发布、回滚、差异对比 |
| 无成本看板 | Token/费用聚合、预算与告警 |
| 无本地执行器 | Claude Code / CLI executor、WebSocket 调度、任务包 |
| 无 IM/通知 | 审批提醒、站内信 |
| 无 Skill 文件上传 | SKILL.md zip 解析与版本管理 |
