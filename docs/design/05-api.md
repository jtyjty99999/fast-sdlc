# API 与事件协议

> 所属：[AutoSDD 设计文档](README.md)
> 相关：[领域模型](03-domain-model.md) · [前端设计](06-frontend.md)

---

## API 设计

### 约定

- Base：`/api`
- 成功：`{ "ok": true, "data": ... }`
- 失败：`{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`
- 校验：zod；失败返回 400 + `VALIDATION_ERROR` + issues。
- 错误码：`VALIDATION_ERROR`、`NOT_FOUND`、`CONFLICT`、`WORKFLOW_INVALID`、`NO_WORKFLOW_MATCH`、`RUN_IN_PROGRESS`、`APPROVAL_NOT_PENDING`、`MODEL_NOT_FOUND`、`MODEL_DISABLED`、`MODEL_IN_USE`、`MODEL_IS_DEFAULT`、`LLM_NOT_CONFIGURED`、`LLM_ERROR`、`INTERNAL`。
- 时间均为 ISO-8601 UTC 字符串。

### 资源接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents?q=` | 列表（含 skillCount / knowledgeCount） |
| POST | `/api/agents` | 创建 |
| GET | `/api/agents/:id` | 详情（含 skills / knowledge） |
| PUT | `/api/agents/:id` | 更新基本信息 |
| DELETE | `/api/agents/:id` | 被 Workflow 引用时 409 |
| PUT | `/api/agents/:id/mounts` | `{ skillIds, knowledgeIds }` 整体替换挂载 |
| GET | `/api/agents/:id/context-preview` | 返回组装后的 systemPrompt / userPrompt / 统计 |
| GET | `/api/models?q=&provider=` | 模型列表（含 keySource / isDefault / agentCount） |
| POST | `/api/models` | 创建模型；apiKey 仅写入，永不回传 |
| GET | `/api/models/:id` | 模型详情（keySource 而非 Key） |
| PUT | `/api/models/:id` | 更新；apiKey 省略=保留、`""`=清空 |
| DELETE | `/api/models/:id` | 默认或被 Agent 引用时 409 |
| POST | `/api/models/:id/default` | 切换默认模型（仅 ACTIVE） |
| POST | `/api/models/:id/test` | 真实调用一次模型，返回 `{ok, latencyMs, sample}` |
| GET | `/api/skills?q=` | 技能列表 |
| POST/PUT/DELETE | `/api/skills[/:id]` | 技能 CRUD；删除级联解除挂载 |
| GET | `/api/knowledge?q=&type=` | 知识列表 |
| POST/PUT/DELETE | `/api/knowledge[/:id]` | 知识 CRUD |
| GET | `/api/workflows?status=` | 工作流列表（含步骤数、Agent 名） |
| POST | `/api/workflows` | 创建工作流（含步骤） |
| GET | `/api/workflows/:id` | 详情（含步骤） |
| PUT | `/api/workflows/:id` | 整体替换（事务） |
| DELETE | `/api/workflows/:id` | 被任务引用时 409 |
| POST | `/api/workflows/:id/validate` | 返回 `{valid, errors[]}` |
| POST | `/api/workflows/match` | `{ text, scenario? }` → 推荐列表 |
| GET | `/api/tasks?status=&q=` | 任务列表 |
| POST | `/api/tasks` | `{ title, description, scenario?, workflowId? }`；未指定则自动匹配，无匹配 400 |
| GET | `/api/tasks/:id` | 任务 + 当前 run + 步骤 + 审批 + 工作流 |
| POST | `/api/tasks/:id/run` | 启动/重跑，返回 `{ runId }` |
| POST | `/api/tasks/:id/cancel` | 取消活跃 run |
| GET | `/api/tasks/:id/runs` | 历史 run 列表 |
| GET | `/api/runs/:runId` | run + 步骤 + 审批 |
| GET | `/api/runs/:runId/events?after=` | 事件历史 |
| GET | `/api/runs/:runId/stream` | SSE；支持 `Last-Event-ID` |
| POST | `/api/runs/:runId/steps/:stepRunId/approval` | `{ decision: APPROVED\|REJECTED, comment? }` |
| GET | `/api/overview` | 计数、成功率、最近任务、执行器类型 |

### 关键请求示例

创建 Workflow：

```json
{
  "name": "新功能开发",
  "description": "从需求到评审的标准交付链路",
  "scenario": "新功能开发",
  "tags": ["需求", "开发", "评审"],
  "matchKeywords": ["新功能", "新增", "报表", "导出"],
  "status": "ENABLED",
  "steps": [
    {
      "stepKey": "s1",
      "name": "需求分析",
      "agentId": "01J...",
      "instructionMd": "输出需求规格、用户故事与验收标准",
      "dependsOn": [],
      "gateMode": "NONE",
      "timeoutSeconds": 300
    },
    {
      "stepKey": "s2",
      "name": "架构设计",
      "agentId": "01J...",
      "instructionMd": "给出模块划分、接口契约与数据模型",
      "dependsOn": ["s1"],
      "gateMode": "NONE"
    }
  ]
}
```

创建任务（自动匹配）：

```json
{ "title": "新增销售报表导出", "description": "支持按日期导出 CSV，包含权限校验", "scenario": "新功能开发" }
```

响应：

```json
{
  "ok": true,
  "data": {
    "id": "01J...",
    "workflowId": "01J...",
    "workflowName": "新功能开发",
    "status": "QUEUED"
  }
}
```

### SSE 事件

```
id: 42
event: run
data: {"id":42,"runId":"01J...","stepRunId":"01J...","type":"STEP_STARTED","message":"架构设计 开始执行","payload":{"stepKey":"s2"},"createdAt":"2026-10-30T..."}
```

事件类型：

| type | 含义 |
|---|---|
| RUN_STARTED | run 创建并开始 |
| STEP_READY | 步骤依赖满足，进入就绪 |
| STEP_STARTED | 步骤开始执行 |
| STEP_DELTA | 流式文本（**仅实时，不落库**） |
| STEP_OUTPUT | 最终产物已保存（payload 含字符数） |
| APPROVAL_REQUESTED | 命中人工卡点 |
| APPROVAL_DECIDED | 审批结果 |
| STEP_SUCCEEDED / STEP_FAILED | 步骤终态 |
| RUN_SUCCEEDED / RUN_FAILED / RUN_CANCELED | run 终态 |
| LOG | 过程日志 |

SSE 连接流程：先订阅内存事件 → 回放 `Last-Event-ID` 之后的数据库事件 → 按 id 去重推送 → 进入实时；每 15 秒发送心跳注释 `: ping`。

