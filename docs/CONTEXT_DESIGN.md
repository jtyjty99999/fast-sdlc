# 工作流上下文管理设计

> 范围：AutoSDD 每次执行任务时，**每个工作流步骤看到什么上下文、这些上下文从哪里来、如何在步骤之间共享**。
> 实现入口：`apps/server/src/execution/context-builder.ts`、`apps/server/src/execution/orchestrator.ts`、`apps/server/src/execution/snapshot.ts`。

---

## 1. 结论先行

AutoSDD 不为一条工作流维护「一个不断增长的对话」。每次步骤执行都**从零组装**一份上下文，只包含三类信息：

1. **执行快照中的静态资产**：Agent 身份、系统提示词、挂载的 Skill、挂载的项目知识；
2. **当前任务与当前步骤**：任务标题/描述/场景、步骤名与步骤指令；
3. **显式声明的前置依赖产物**：`depends_on` 中每个步骤的最终 Markdown 产物。

步骤之间**只共享产物（artifact），不共享上下文（context）、不共享对话历史**。没有全局记忆，也没有隐式的「上一步说了什么」。共享关系完全由工作流 DAG 中的 `depends_on` 决定，因此可解释、可预览、可重放。

---

## 2. 上下文的三层来源

| 层 | 内容 | 冻结时机 | 存放位置 |
|---|---|---|---|
| L1 执行快照 | 工作流元信息、全部步骤定义、被引用 Agent 的完整画像（含 Skill/知识正文） | `run` 启动时 | `task_runs.workflow_snapshot_json` |
| L2 任务与步骤 | 任务标题/描述/场景；步骤名、`step_key`、步骤指令、审批模式、超时 | L1 冻结；任务字段执行时实时读取 | `tasks`、`step_runs` |
| L3 依赖产物 | 直接依赖步骤的 `output_md` | 依赖步骤执行完成时 | `step_runs.output_md` |

关键点：

- **快照冻结**保证「启动 run 后再改 Agent、Skill、知识、工作流，不会影响本次 run」。重跑会重新冻结。
- **依赖产物按值传递**：下游拿到的是上游最终产物的完整文本，而不是上游的上下文或中间流式片段。
- **执行期模型记录实时解析**（`agent.modelId → models` 表），但上下文组装只使用快照中的 Agent 画像；模型变更不影响已经冻结的身份/技能/知识。

```
tasks ──┐
workflows/steps ──► buildSnapshot ──► workflow_snapshot_json ──┐
agents + skills + knowledge ──────────────────────────────────┤
                                                              ▼
step_runs.depends_on ──► 已成功步骤的 output_md ──► buildContext()
                                                              │
                                                  systemPrompt + userPrompt
                                                              ▼
                                                     executor.run(...)
                                                              │
                                                     output_md ──► 下游步骤
```

---

## 3. 一次步骤执行的数据流

`Orchestrator.executeStep` 的顺序（简化）：

```
1. 读 run 快照与当前任务
2. 找到步骤对应的 SnapshotAgent；解析执行模型（校验存在且 ACTIVE）
3. 收集依赖：step.dependsOn → 已成功步骤的 { stepKey, stepName, outputMd }
4. buildContext({ agent, task, step, dependencyOutputs })
5. step: PENDING → READY → RUNNING
   同时把 BuiltContext 写入 step_runs.context_json
6. executor.run({ systemPrompt, userPrompt, ... }, emit delta)
7. 产物写入 step_runs.output_md（审批卡点先进入 WAITING_APPROVAL）
```

因此，「这一步到底给模型看了什么」可以通过 `step_runs.context_json` 完整复原：两份 prompt、各段字符数、是否截断、注入了多少条 Skill/知识。

`STEP_DELTA` 只用于实时广播，不进入任何后续步骤的上下文；只有 `output_md` 会被下游引用。

---

## 4. 组装规则

`buildContext` 是纯函数，输入固定、输出确定，因此可以在 Agent 详情页做「上下文预览」。

### 4.1 System Prompt（稳定部分）

固定顺序，便于解释与审查：

```markdown
# 身份
你是「{agent.name}」，担任{agent.role}。
{agent.description}
{agent.systemPrompt}

# 已挂载技能
## 技能 1：{skill.name}
{skill.instructionsMd}
## 技能 2：...

# 项目知识
## [{知识类型标签}] {knowledge.title}
{knowledge.contentMd}
## ...

# 输出契约
- 只输出 Markdown 正文，不要输出与任务无关的寒暄。
- 结论先行，再给依据；引用知识时说明来源标题。
- 不要编造未在任务、知识或依赖产物中出现的事实；不确定时明确标注“待确认”。
- 产物应当可以直接被下一位同事使用。
```

- Skill 与知识均按挂载的 `sort_order` 注入。
- 知识先截取前 `maxKnowledgeItems = 50` 条，再应用字符预算；超出 50 条时追加「其余未注入」提示。
- 输出契约是常量，始终位于最后。

### 4.2 User Prompt（本次执行部分）

```markdown
## 当前任务
- 标题：{task.title}
- 场景：{task.scenario}

{task.description}

## 当前步骤
- 步骤：{step.name}（{step.stepKey}）
- 该步骤完成后需要人工审批        ← 仅 gate_mode = HUMAN_APPROVAL

## 依赖步骤产物

### {dependency stepName}（{stepKey}）
{dependency.outputMd | （该步骤没有产出文本）}

## 你的产出要求

{step.instructionMd | （未填写额外要求，按角色职责完成本步骤）}
```

- 依赖产物按 `step.dependsOn` 数组顺序渲染（通常也是上游 `order_index` 顺序），而不是当前数据库中的任意顺序。
- 没有依赖时渲染「（无，当前步骤没有前置依赖）」，避免模型误以为信息丢失。
- 步骤指令属于“任务级临时要求”，与 Agent 的长期 `systemPrompt` 分离，便于同一个人设复用到不同步骤。

### 4.3 预算与截断

| 区域 | 预算 | 裁剪粒度 |
|---|---|---|
| Agent 身份 + 系统提示词 | 未单独限长 | 整段注入 |
| Skills | 8,000 字符 | 整条 Skill：放不下即停止，后续条目不注入 |
| Knowledge | 12,000 字符；最多 50 条 | 整条知识：放不下即停止 |
| 依赖产物 | 12,000 字符 | 整份产物：放不下即停止 |
| System 总预算 | 24,000（`CONTEXT_BUDGETS.system`，**预留常量，当前未强制裁剪**） | — |

截断语义：

- 采用「整条纳入」而非「切半条」，避免把一份 Skill 或知识截成难以理解的残句。
- 任一区域发生裁剪、或知识条目超过 50 条，`BuiltContext.truncated = true`。
- 每个区域返回 `{ label, chars, truncated }`，UI 展示各段字符数与总字符数。
- 单条文本的 `clampText()` 工具保留在模块中，当前组装器未使用；如需对某一整段做硬上限时可复用。

---

## 5. 跨阶段共享

### 5.1 只沿依赖边共享

```
requirement ─► architecture ─► implementation ─► verification ─► review
                                                              ├─► documentation
architecture ─────────────────────────────────────────────────┘
documentation ─► documentation-review
```

- `documentation` 的 `depends_on` 显式列出需求、架构、实现、验证、评审五个步骤，因此文档专家能同时看到五份产物。
- `documentation-review` 依赖架构与文档，评审时既能看到文档本身，也能对照架构决策。
- **非直接依赖不共享**：即使 `review` 的上下文里含有实现产物，它也不会把「实现产物的副本」传给文档步骤；文档步骤必须自己声明依赖。
- 调度器只把「全部依赖成功」的步骤置为 READY，因此下游读到的是已完成、稳定的产物，不存在读半成品的问题。

### 5.2 只共享最终产物

- 上游的 `systemPrompt` / `userPrompt` / 流式中间态 / 思考过程都不会传给下游。
- 审批操作不会改写产物；审批通过后步骤标记成功，下游拿到的仍是原产物。
- 产物为空时上游会被判为失败（「执行器返回了空产物」），因此下游不会拿到空字符串冒充内容。

### 5.3 产物即接口

步骤之间的事实传递完全依赖 `output_md` 的文本约定。这带来两个直接收益：

- **可审计**：每一步的输入上下文和输出都能在运行详情中单独查看。
- **可替换**：换模型、换执行器、重跑，都不需要迁移任何会话状态。

代价是：产物格式不受 schema 约束，下游依赖的是自然语言约定。当前通过步骤指令与系统输出契约约束格式；未来若需要强契约，可在步骤间增加结构化产物（JSON schema）。

---

## 6. 生命周期与不变量

| 事件 | 上下文行为 |
|---|---|
| 启动 run | 冻结工作流 + Agent 画像快照；所有步骤初始为 PENDING |
| 步骤开始 | 基于快照与当前依赖产物**组装一次**，写入 `context_json` |
| 流式输出 | 只广播 delta，不进入上下文 |
| 人工审批 | 只改变步骤状态，不重新组装上下文 |
| 审批通过 | 步骤成功，产物供下游使用 |
| 驳回 | 步骤失败，run 终止；不会带着审批意见重试 |
| 取消 / 超时 | 步骤失败或取消，不产生可被下游使用的产物 |
| 重跑 | 创建新 run：重新冻结快照、重新组装全部上下文；旧 run 只读 |
| 服务重启 | 进行中的 run 标记失败；等待审批的 run 保留，审批后继续（上下文已在 `context_json` 中） |

其他不变量：

- 同一 run 内，步骤上下文一旦写入不会被后续事件修改。
- 依赖产物只在步骤成功（或审批通过）后才可能被引用；失败步骤的 `output_md` 不会流入下游。
- 模型缺失/停用会让步骤在执行前直接失败，不会用其他模型静默替换。

---

## 7. 哪些内容刻意不共享

| 不共享 | 原因 |
|---|---|
| 完整对话历史 / 消息数组 | 避免上下文随步骤线性膨胀，保持每步输入可预测 |
| 上游的 system/user prompt | 防止身份与技能串味；下游只应继承产物 |
| 流式增量与中间态 | 无法保证一致性，且会放大 token 成本 |
| 兄弟分支的产物 | 未声明依赖即无数据关系；由 DAG 显式表达 |
| 全局「项目记忆」 | 当前以知识库静态注入替代，避免隐式状态 |
| 模型 API Key / 运行日志 | 与任务上下文无关，且属于敏感信息 |
| 历史 run 的产物 | 重跑是独立执行；跨 run 对比通过 API 查看，不自动注入 |

---

## 8. 边界与已知限制

1. **任务字段是实时读取的**：Agent 画像与步骤定义在启动时冻结，但 `tasks.title/description/scenario` 在每次 `executeStep` 时从数据库读取。若 run 期间编辑任务，后续步骤会看到新描述。需要完全冻结时，应把任务快照一并写入 `workflow_snapshot_json`。
2. **system 总预算尚未强制**：`CONTEXT_BUDGETS.system = 24k` 是预留常量；身份、Skill、知识、输出契约各自受限，但总长可能超过 24k。未来可在保留输出契约的前提下，对身份/技能/知识做全局配额分配。
3. **整条截断会浪费剩余空间**：某条超大 Skill 放不下时直接停止，后续小条目也不会注入。若实际使用中常见，可改为「跳过超大条目继续尝试」或按 token 估算动态装箱。
4. **知识全量注入、无检索**：最多 50 条、12k 字符，超出即丢弃。长期应引入 BM25/向量检索与渐进式加载。
5. **无 token 级预算**：预算以字符计，未按模型 tokenizer 换算；对中文/代码混排的内容只是近似。
6. **预览与实际执行不完全一致**：Agent 详情页的上下文预览使用固定示例任务，且没有依赖产物；它用于检查 System Prompt 与技能/知识注入，不代表某次真实 run 的 User Prompt。
7. **无跨步骤摘要**：长链路中依赖产物较多时，下游可能只看到前几份产物。当前依赖通常 1–2 个；若链路变宽，需要增加「汇总步骤」或分层摘要。

---

## 9. 演进方向

| 方向 | 说明 |
|---|---|
| 任务快照 | 把任务标题/描述/场景冻结进 run 快照，补齐「run 内完全不变」 |
| 结构化产物 | 步骤产物增加 JSON 契约（如需求条目、接口列表），降低自然语言漂移 |
| 汇总/压缩 | 在依赖产物过多时引入 Map-Reduce 式汇总步骤，而非无限扩大预算 |
| 检索注入 | 知识按任务相关性检索，替代固定 50 条全量注入 |
| token 预算 | 按目标模型 tokenizer 计算预算，并预留输出 token |
| 上下文差异视图 | 运行详情同时展示「本步上下文」与「上一步上下文」的差异，便于调试 |

---

## 10. 验证覆盖

| 行为 | 测试 |
|---|---|
| System Prompt 段落顺序、身份/技能/知识/契约注入 | `apps/server/test/unit/context-builder.test.ts` |
| User Prompt 包含任务、步骤、依赖产物与审批提示 | 同上 |
| 无依赖时的空状态提示 | 同上 |
| Skill 超预算时整条停止并标记 truncated | 同上 |
| 知识超过 50 条时截断并提示 | 同上 |
| 真实执行时上下文写入 `step_runs.context_json` | `apps/server/test/integration/lifecycle.test.ts` |
| 依赖步骤产物进入下游步骤 | 同上（运行详情可断言） |
| 上下文预览接口 | `apps/server/test/integration/agents.test.ts` |
