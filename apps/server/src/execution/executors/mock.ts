import type {
  AgentExecutor,
  ExecutorEmit,
  ExecutorInput,
  ExecutorResult,
} from '../types';

const CHUNK_SIZE = 40;

interface MockExecutorOptions {
  delayMs: number;
  failStep?: string | undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error('执行已取消');
  error.name = 'AbortError';
  return error;
}

function templateFor(role: string, agentName: string, taskTitle: string, stepName: string): string {
  const header = `# ${stepName}\n\n> 执行者：${agentName} · 任务：${taskTitle}\n`;
  if (role.includes('需求')) {
    return `${header}
## 一、问题与目标
围绕「${taskTitle}」，本步骤需要把模糊诉求收敛为可验收的需求。核心目标是让下游架构与开发可以据此做出确定的技术决策。

## 二、范围
- 本期范围：主流程闭环、关键异常提示、基础数据埋点。
- 明确不做：跨端同步、离线能力、历史数据迁移。

## 三、用户故事与验收标准
1. 作为核心用户，我可以完成「${taskTitle}」的主路径，且在 3 步以内到达结果。
2. 当输入不完整时，系统给出可理解的提示，并保留已填写内容。
3. 关键操作有明确的成功反馈，失败时可重试。

## 四、待确认
- 目标用户规模与峰值并发需要业务方补充。
- 是否需要兼容旧版本客户端，待技术评审确认。
`;
  }
  if (role.includes('架构')) {
    return `${header}
## 一、设计结论
采用“接口层 - 领域服务 - 仓储”三层结构承载「${taskTitle}」相关能力，保持与现有模块一致的边界与错误语义。

## 二、关键决策
| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 状态存储 | 关系型数据库 + 显式状态机 | 可审计、易恢复 |
| 调用方式 | 同步接口 + 事件通知 | 降低首版复杂度 |
| 幂等 | 客户端请求 ID | 防止重复提交 |

## 三、风险与缓解
- 状态竞态：使用条件更新，只允许合法前置状态迁移。
- 外部依赖超时：设置超时与重试上限，失败时降级为可重试提示。
- 数据膨胀：为高频查询字段建立索引，并保留归档策略。

## 四、给开发的接口契约
\`\`\`ts
interface CreateRequest { requestId: string; payload: unknown }
interface CreateResponse { id: string; status: 'ACCEPTED' | 'REJECTED' }
\`\`\`
`;
  }
  if (role.includes('测试')) {
    return `${header}
## 一、验证范围
覆盖「${taskTitle}」的主路径、边界条件与失败恢复，重点验证状态流转和重复提交。

## 二、用例结果
| 编号 | 场景 | 预期 | 结果 |
| --- | --- | --- | --- |
| T-01 | 正常创建 | 返回 ID 并进入待处理 | 通过 |
| T-02 | 重复 requestId | 返回同一结果，不产生重复数据 | 通过 |
| T-03 | 依赖超时 | 展示可重试提示，数据不脏写 | 通过 |
| T-04 | 非法输入 | 400 并给出字段级错误 | 通过 |

## 三、发现的问题
- 未发现阻塞级缺陷。
- 建议补充：弱网下连续点击的防抖提示。

## 四、结论
主流程质量达标，可以进入评审环节。
`;
  }
  if (role.includes('评审')) {
    return `${header}
## 一、评审结论
**通过（附 2 条建议）**。实现与设计文档一致，关键路径有测试覆盖，错误处理符合项目规范。

## 二、检查项
- [x] 状态迁移有前置条件校验
- [x] 外部输入经过 schema 校验
- [x] 失败路径有明确错误码
- [x] 无硬编码密钥与调试输出
- [x] 新增逻辑有对应测试

## 三、建议
1. 将重复的请求校验提取为共享函数，减少后续漂移。
2. 为关键状态变化补充结构化日志，便于线上排查。

## 四、遗留风险
低。上线后关注失败率与重试次数两个指标。
`;
  }
  if (role.includes('开发') || role.includes('工程')) {
    return `${header}
## 一、实现概述
按架构契约完成「${taskTitle}」的核心链路：请求校验 → 领域处理 → 持久化 → 结果返回。

## 二、改动点
- 新增请求/响应 schema，边界输入统一在第一层拦截。
- 领域服务以纯函数组织状态判断，仓储只负责读写。
- 失败路径返回稳定错误码，前端可据此给出可操作提示。

## 三、自测记录
\`\`\`
✓ 正常创建
✓ 重复请求幂等
✓ 非法输入返回 400
✓ 依赖超时降级
\`\`\`

## 四、已知限制
- 首版未做批量接口，单次仅处理一条记录。
- 历史数据迁移脚本不在本次范围。
`;
  }
  return `${header}
## 一、结论
已按当前步骤要求完成「${stepName}」，产物可供下游直接使用。

## 二、要点
- 输入信息已核对，关键约束来自任务描述与依赖步骤产物。
- 对不确定信息做了显式标注，未做无依据推断。
- 输出结构保持稳定，便于后续自动化处理。

## 三、后续建议
- 由下游角色确认关键假设后再进入实现。
- 如需补充上下文，请优先完善任务描述与知识条目。
`;
}

export class MockExecutor implements AgentExecutor {
  readonly kind = 'mock' as const;
  readonly model = 'mock';

  constructor(private readonly options: MockExecutorOptions) {}

  async run(
    input: ExecutorInput,
    emit: ExecutorEmit,
    signal: AbortSignal,
  ): Promise<ExecutorResult> {
    const shouldFail =
      (this.options.failStep !== undefined &&
        (this.options.failStep === input.stepName || this.options.failStep === input.taskTitle)) ||
      input.userPrompt.includes('[fail]');

    if (shouldFail) {
      await sleep(this.options.delayMs, signal);
      throw new Error('模拟执行失败：已触发 MOCK_FAIL_STEP 或 [fail] 标记');
    }

    const outputMd = templateFor(input.role, input.agentName, input.taskTitle, input.stepName);

    for (let index = 0; index < outputMd.length; index += CHUNK_SIZE) {
      signal.throwIfAborted();
      emit({ type: 'delta', text: outputMd.slice(index, index + CHUNK_SIZE) });
      await sleep(this.options.delayMs, signal);
    }

    return {
      outputMd,
      inputTokens: Math.ceil((input.systemPrompt.length + input.userPrompt.length) / 3),
      outputTokens: Math.ceil(outputMd.length / 3),
      model: this.model,
    };
  }
}
