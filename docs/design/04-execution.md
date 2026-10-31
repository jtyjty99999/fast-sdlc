# 执行引擎

> 所属：[AutoSDD 设计文档](README.md)
> 相关：[工作流上下文管理](10-context.md) · [领域模型](03-domain-model.md) · [远程沙箱设计](11-sandbox.md)

---

## 执行引擎

### 上下文组装

#### System Prompt（身份与约束）

固定顺序，保证可解释、可预览：

```
# 身份
你是「{agent.name}」，担任{agent.role}。
{agent.description}
{agent.system_prompt}

# 已挂载技能
## 技能 {n}：{skill.name}
{skill.instructions_md}

# 项目知识
## [{typeLabel}] {knowledge.title}
{knowledge.content_md}
...

# 输出契约
- 只输出 Markdown 正文，不要输出与任务无关的寒暄。
- 结论先行，再给依据；引用知识时说明来源标题。
- 不要编造未在任务、知识或依赖产物中出现的事实；不确定时明确标注“待确认”。
- 产物应当可以直接被下一位同事使用。
```

- Skill 按挂载 `sort_order` 注入；知识同样。
- 知识最多注入 **50 条**，超出按顺序截断并提示。
- 预算：Skills ≤ 8k；Knowledge ≤ 12k；依赖产物 ≤ 12k 字符。按条目整条纳入，放不下的条目跳过并标记 `truncated`；预览接口返回各段字符数。
- `CONTEXT_BUDGETS.system = 24k` 为预留总预算常量，当前未强制裁剪（身份与输出契约应始终保留）。详见 [工作流上下文管理设计](10-context.md)。

#### User Prompt（本步任务）

```
## 当前任务
- 标题：{task.title}
- 场景：{task.scenario}

{task.description}

## 当前步骤
- 步骤：{step.name}（{step.key}）
- 该步骤完成后需要人工审批        ← 仅 gate_mode=HUMAN_APPROVAL

## 依赖步骤产物

### {dependency step name}（{stepKey}）
{dependency.output_md | （该步骤没有产出文本）}

## 你的产出要求

{step.instruction_md | （未填写额外要求，按角色职责完成本步骤）}
```
- 组装结果写入 `step_runs.context_json`，运行详情可查看「这一步到底给模型看了什么」。

### Executor 抽象

```ts
export interface AgentExecutor {
  readonly kind: 'mock' | 'anthropic' | 'openai';
  run(
    input: ExecutorInput,
    emit: (event: ExecutorEvent) => void,
    signal: AbortSignal,
  ): Promise<ExecutorResult>;
}
```

- `ExecutorEvent`：`delta`（流式文本）。
- `ExecutorResult`：`outputMd`、`model`、`inputTokens`、`outputTokens`。
- 所有执行器共享同一超时、取消与事件语义；上层不关心模型来源。

#### MockExecutor

- 根据 Agent 角色与步骤名选择模板：需求规格、架构设计、实现说明、测试报告、评审结论、文档。
- 输出引用任务标题、上游产物摘要、已挂载技能/知识名称，形成可读的「伪真实」产物。
- 按段落分片流式输出，默认每片延迟 `MOCK_DELAY_MS`（250ms），总时长 2–4 秒。
- 任务描述或步骤指令含 `[fail]`，或设置 `MOCK_FAIL_STEP={步骤名称或任务标题}` 时抛错，便于演示失败与测试。
- Token 估算：`round(chars / 3)`。

#### AnthropicExecutor

- `@anthropic-ai/sdk` 的 `messages.stream`，`system` + 单条 user message。
- 模型名、`max_tokens`、可选 `baseURL` 均来自模型注册表记录。
- 逐段 `delta`；结束时读取 `usage.input_tokens/output_tokens`。
- 若响应没有任何文本块：`stop_reason=max_tokens` 时提示「推理过程可能耗尽 token 额度，请调大 Max Tokens」，其他原因附带 `stop_reason`；不再退化为通用的「执行器返回了空产物」。
- 支持 `AbortSignal`（取消/超时）；错误统一包装为 `LLM_ERROR`，不向客户端泄露 Key 或堆栈。

#### OpenAICompatibleExecutor

- 直接 `fetch` 调用 `{baseUrl}/chat/completions`（已带该路径则不重复拼接），`stream: true`。
- 兼容 DeepSeek、通义千问、Ollama 等；Key 可空（本地无鉴权服务），有 Key 时发送 `Authorization: Bearer`。
- 解析 SSE `data:` 行（支持 CRLF 与多行），逐段 emit `delta`，跳过 `[DONE]`；忽略无法解析的片段。
- usage 兼容 `prompt_tokens/completion_tokens` 与 `input_tokens/output_tokens`；缺失记为 null。
- 流结束仍无正文时按 `finish_reason` 报错：`length` 提示调大 Max Tokens，其他原因附带 `finish_reason`。
- 非 2xx 或流内 `error` 转为 `LLM_ERROR`，保留状态码与脱敏后的上游信息；AbortSignal 透传 fetch。

#### 工厂

每次执行步骤时按模型记录实时解析，而非进程启动时固定：

```
resolve step model:
  agent.modelId ?? 默认模型
  模型不存在 → 步骤失败「模型不存在或已被删除」
  模型 DISABLED → 步骤失败「已停用」

createExecutorForModel(model, config):
  mock      → MockExecutor(delayMs, failStep)
  anthropic → Key = model.apiKey ?? ANTHROPIC_API_KEY；缺失 → LLM_NOT_CONFIGURED
  openai    → Key = model.apiKey ?? OPENAI_API_KEY（可空）；baseUrl 必填
```

- Key 只存在于服务端存储/环境变量；公开 API 只返回来源（`stored` / `env` / `none`）。
- 遗留 run 快照若没有 `modelId`，执行期回退当前默认模型。

### 编排器

#### 启动 run

```
startRun(taskId):
  1. 校验 task 非活跃、workflow 为 ENABLED、通过 Workflow 校验
  2. 事务：run_number = max+1；冻结 snapshot；写 task_run + N 个 step_run(PENDING) + RUN_STARTED
  3. 更新 task.status=RUNNING, current_run_id
  4. setImmediate(runLoop(runId))
  5. 返回 runId
```

#### runLoop（DAG 就绪队列，当前并发 1）

```
while true:
  run = reload
  if run.status == CANCELED: return
  steps = reload step_runs
  if any step FAILED: failRun; return
  if all steps SUCCEEDED/SKIPPED: succeedRun; return
  if any step WAITING_APPROVAL: set run WAITING_APPROVAL; return   // 等审批回调
  ready = steps where status=PENDING and all deps SUCCEEDED/SKIPPED
  if ready empty: failRun(DEADLOCK); return
  step = ready.sort(order_index)[0]
  executeStep(step)
  if step WAITING_APPROVAL: set run WAITING_APPROVAL; return
  if step FAILED: failRun; return
```

- **线性流程**下任一时刻 ready 恰好 1 个；未来并发 >1 只需去掉「取一个」的限制。
- 死锁（依赖成环或依赖失败却未被标记）会显式失败，而不是永远挂起。
- 同一 run 用 `Set<runId>` 防重入；审批恢复时重新进入 loop。

#### 执行单步

```
executeStep:
  step: PENDING → RUNNING（条件更新）
  emit STEP_STARTED
  context = buildContext(snapshot.agent, step, task, dependency outputs)
  save step.context_json
  result = executor.run(..., emit delta → 实时广播, AbortSignal(超时))
  if gate HUMAN_APPROVAL:
      step → WAITING_APPROVAL；创建 approval(PENDING)；emit APPROVAL_REQUESTED
  else:
      step → SUCCEEDED；emit STEP_SUCCEEDED
  on error:
      step → FAILED, error；emit STEP_FAILED
```

`STEP_DELTA` 只实时广播、不落库（避免高频写放大）；最终 `output_md` 落库。断线重连后从 `step_runs.output_md` 恢复完整文本，事件历史只回放状态变化。

#### 审批

```
approve(stepRunId, decision, comment):
  条件更新 approval PENDING → APPROVED/REJECTED（事务）
  APPROVED: step WAITING_APPROVAL → SUCCEEDED；emit APPROVAL_DECIDED + STEP_SUCCEEDED；resume runLoop
  REJECTED: step → FAILED；run/task → FAILED；emit APPROVAL_DECIDED + RUN_FAILED
  非 PENDING 或 run 已终态 → APPROVAL_NOT_PENDING
```

#### 取消

```
cancel(taskId):
  活跃 run 置 CANCELED；未完成 step 置 CANCELED；pending approval 置 REJECTED?
  → approval 保持 PENDING 但 run 终态，UI 不再展示确认按钮
  AbortController.abort()
  emit RUN_CANCELED
```

#### 重跑

终态任务再次启动：创建新 run（冻结当下 workflow/agent/知识），旧 run 与产物全部保留。`GET /api/tasks/:id/runs` 可对比历史。

#### 进程重启恢复

启动时：

- `task_runs.status = RUNNING` → 标记 FAILED，error=`SERVER_RESTARTED`；其 RUNNING/READY 步骤标记 FAILED；写 `RUN_FAILED` 事件；任务标记 FAILED，UI 提示「执行被服务重启中断，可重跑」。
- `WAITING_APPROVAL` 保留：人工仍可审批，审批通过后编排器从暂停点继续（内存无 loop，但 approve 会重新拉起）。

### 场景 → Workflow 匹配

纯函数、确定性、可测试：

```
score = 0
if workflow.scenario == input.scenario: score += 10  // 精确场景
for kw in workflow.match_keywords:
    if kw 出现在 (title + description)（中文子串，英文忽略大小写）: score += 3
for tag in workflow.tags:
    if tag 出现在文本: score += 1
只考虑 status=ENABLED
按 score 降序，取前 3；score=0 不返回
```

返回 `{ workflow, score, reasons[] }`，`reasons` 直接展示给用户（如「场景命中：新功能开发」「关键词命中：报表、导出」）。不做 LLM 分类，避免不确定性与额外成本；未来可加 `matchMode=llm`。

