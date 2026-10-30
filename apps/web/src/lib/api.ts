import type {
  Agent,
  AgentDetail,
  AgentInput,
  AgentMountInput,
  ApiResponse,
  ApprovalInput,
  ContextPreview,
  KnowledgeInput,
  KnowledgeItem,
  MatchCandidate,
  MatchInput,
  OverviewData,
  RunDetail,
  RunEvent,
  Skill,
  SkillInput,
  StepRun,
  Task,
  TaskDetail,
  TaskInput,
  TaskRun,
  Workflow,
  WorkflowInput,
  WorkflowSummary,
  WorkflowValidationResult,
} from '@autosdd/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('无法连接 AutoSDD 服务，请确认后端已启动', 0, 'NETWORK_ERROR');
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('服务返回了无法解析的响应', response.status, 'INVALID_RESPONSE');
  }

  if (!payload.ok) {
    throw new ApiError(
      payload.error.message,
      response.status,
      payload.error.code,
      payload.error.details,
    );
  }
  return payload.data;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  overview: () => request<OverviewData>('/api/overview'),

  agents: {
    list: (q?: string) => request<Agent[]>(`/api/agents${query({ q })}`),
    get: (id: string) => request<AgentDetail>(`/api/agents/${id}`),
    create: (input: AgentInput) =>
      request<Agent>('/api/agents', { method: 'POST', body: input }),
    update: (id: string, input: AgentInput) =>
      request<Agent>(`/api/agents/${id}`, { method: 'PUT', body: input }),
    remove: (id: string) => request<{ deleted: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
    setMounts: (id: string, input: AgentMountInput) =>
      request<AgentDetail>(`/api/agents/${id}/mounts`, { method: 'PUT', body: input }),
    contextPreview: (id: string) =>
      request<ContextPreview>(`/api/agents/${id}/context-preview`),
  },

  skills: {
    list: (filters: { q?: string; category?: string } = {}) =>
      request<Skill[]>(`/api/skills${query(filters)}`),
    get: (id: string) => request<Skill>(`/api/skills/${id}`),
    create: (input: SkillInput) =>
      request<Skill>('/api/skills', { method: 'POST', body: input }),
    update: (id: string, input: SkillInput) =>
      request<Skill>(`/api/skills/${id}`, { method: 'PUT', body: input }),
    remove: (id: string) => request<{ deleted: boolean }>(`/api/skills/${id}`, { method: 'DELETE' }),
  },

  knowledge: {
    list: (filters: { q?: string; type?: string } = {}) =>
      request<KnowledgeItem[]>(`/api/knowledge${query(filters)}`),
    get: (id: string) => request<KnowledgeItem>(`/api/knowledge/${id}`),
    create: (input: KnowledgeInput) =>
      request<KnowledgeItem>('/api/knowledge', { method: 'POST', body: input }),
    update: (id: string, input: KnowledgeInput) =>
      request<KnowledgeItem>(`/api/knowledge/${id}`, { method: 'PUT', body: input }),
    remove: (id: string) =>
      request<{ deleted: boolean }>(`/api/knowledge/${id}`, { method: 'DELETE' }),
  },

  workflows: {
    list: () => request<WorkflowSummary[]>('/api/workflows'),
    get: (id: string) => request<Workflow>(`/api/workflows/${id}`),
    create: (input: WorkflowInput) =>
      request<Workflow>('/api/workflows', { method: 'POST', body: input }),
    update: (id: string, input: WorkflowInput) =>
      request<Workflow>(`/api/workflows/${id}`, { method: 'PUT', body: input }),
    remove: (id: string) =>
      request<{ deleted: boolean }>(`/api/workflows/${id}`, { method: 'DELETE' }),
    match: (input: MatchInput) =>
      request<MatchCandidate[]>('/api/workflows/match', { method: 'POST', body: input }),
    validate: (id: string) =>
      request<WorkflowValidationResult>(`/api/workflows/${id}/validate`, { method: 'POST' }),
  },

  tasks: {
    list: (filters: { status?: string; q?: string } = {}) =>
      request<Task[]>(`/api/tasks${query(filters)}`),
    create: (input: TaskInput) =>
      request<Task>('/api/tasks', { method: 'POST', body: input }),
    get: (id: string) => request<TaskDetail>(`/api/tasks/${id}`),
    run: (id: string) => request<TaskDetail>(`/api/tasks/${id}/run`, { method: 'POST' }),
    cancel: (id: string) => request<TaskDetail>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
    runs: (id: string) => request<TaskRun[]>(`/api/tasks/${id}/runs`),
  },

  runs: {
    get: (runId: string) => request<RunDetail>(`/api/runs/${runId}`),
    events: (runId: string, after = 0) =>
      request<RunEvent[]>(`/api/runs/${runId}/events${query({ after })}`),
    approve: (runId: string, stepRunId: string, input: ApprovalInput) =>
      request<StepRun>(`/api/runs/${runId}/steps/${stepRunId}/approval`, {
        method: 'POST',
        body: input,
      }),
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '发生未知错误';
}
