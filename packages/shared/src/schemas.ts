import { z } from 'zod';
import {
  AGENT_STATUSES,
  APPROVAL_STATUSES,
  DEFAULT_MODEL_MAX_TOKENS,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  GATE_MODES,
  KNOWLEDGE_TYPES,
  MODEL_PROVIDERS,
  MODEL_STATUSES,
  WORKFLOW_STATUSES,
} from './constants';

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const stringList = (maxItems = 50) =>
  z.array(z.string().trim().min(1).max(200)).max(maxItems);
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^https?:\/\/\S+$/i.test(value), 'Base URL 必须是 http(s) 地址')
  .refine((value) => !/^https?:\/\/[^/?#\s]*@/i.test(value), 'Base URL 不能包含用户名或密码');

export const agentInputSchema = z.object({
  name: requiredText(80),
  role: requiredText(80),
  description: text(1000).default(''),
  systemPrompt: text(30_000).default(''),
  modelId: z.string().trim().min(1).max(120).optional(),
  status: z.enum(AGENT_STATUSES).default('ACTIVE'),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

export const modelInputSchema = z
  .object({
    name: requiredText(80),
    provider: z.enum(MODEL_PROVIDERS),
    modelId: requiredText(120),
    baseUrl: text(500).default(''),
    apiKey: z.string().trim().max(500).optional(),
    maxTokens: z
      .number()
      .int()
      .min(1)
      .max(65_536)
      .default(DEFAULT_MODEL_MAX_TOKENS),
    status: z.enum(MODEL_STATUSES).default('ACTIVE'),
  })
  .superRefine((input, ctx) => {
    if (input.provider === 'openai' && !httpUrl.safeParse(input.baseUrl).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'OpenAI 兼容模型必须填写 http(s) Base URL',
      });
    }
    if (input.provider === 'anthropic' && input.baseUrl !== '' && !httpUrl.safeParse(input.baseUrl).success) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Base URL 必须是 http(s) 地址' });
    }
  });
export type ModelInputSchema = z.infer<typeof modelInputSchema>;

export const agentMountInputSchema = z.object({
  skillIds: z.array(z.string().min(1)).max(50).default([]),
  knowledgeIds: z.array(z.string().min(1)).max(100).default([]),
});
export type AgentMountInput = z.infer<typeof agentMountInputSchema>;

export const skillInputSchema = z.object({
  name: requiredText(80),
  category: requiredText(40).default('通用'),
  description: text(1000).default(''),
  instructionsMd: z.string().trim().min(1).max(50_000),
});
export type SkillInput = z.infer<typeof skillInputSchema>;

export const knowledgeInputSchema = z.object({
  title: requiredText(120),
  type: z.enum(KNOWLEDGE_TYPES).default('RULE'),
  contentMd: z.string().trim().min(1).max(100_000),
  tags: stringList().default([]),
});
export type KnowledgeInput = z.infer<typeof knowledgeInputSchema>;

export const workflowStepInputSchema = z.object({
  stepKey: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .optional(),
  name: requiredText(120),
  agentId: z.string().min(1),
  instructionMd: text(30_000).default(''),
  dependsOn: stringList().default([]),
  orderIndex: z.number().int().min(0).max(500).optional(),
  gateMode: z.enum(GATE_MODES).default('NONE'),
  timeoutSeconds: z.number().int().min(10).max(3600).default(DEFAULT_STEP_TIMEOUT_SECONDS),
});
export type WorkflowStepInput = z.infer<typeof workflowStepInputSchema>;

export const workflowInputSchema = z.object({
  name: requiredText(120),
  description: text(2000).default(''),
  scenario: requiredText(80),
  tags: stringList(20).default([]),
  matchKeywords: stringList(30).default([]),
  status: z.enum(WORKFLOW_STATUSES).default('DRAFT'),
  steps: z.array(workflowStepInputSchema).min(1).max(50),
});
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export const taskInputSchema = z.object({
  title: requiredText(200),
  description: text(30_000).default(''),
  scenario: text(80).default(''),
  workflowId: z.string().min(1).optional(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const matchInputSchema = z.object({
  text: z.string().trim().min(1).max(30_000),
  scenario: z.string().trim().max(80).optional(),
});
export type MatchInput = z.infer<typeof matchInputSchema>;

export const approvalInputSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: text(2000).default(''),
});
export type ApprovalInput = z.infer<typeof approvalInputSchema>;

export const taskListQuerySchema = z.object({
  status: z.string().trim().max(40).optional(),
  q: z.string().trim().max(200).optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
