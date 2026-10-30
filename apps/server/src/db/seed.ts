import { DEFAULT_MODEL, DEFAULT_STEP_TIMEOUT_SECONDS } from '@autosdd/shared';
import type { Db } from './database';
import { nowIso } from './clock';
import { AgentRepository } from '../domain/agents/repository';
import { toAgentProfile } from '../domain/agents/profile';
import { SkillRepository } from '../domain/skills/repository';
import { KnowledgeRepository } from '../domain/knowledge/repository';
import { WorkflowRepository } from '../domain/workflows/repository';
import { TaskRepository } from '../domain/tasks/repository';
import { RunRepository } from '../domain/tasks/run-repository';
import { buildContext } from '../execution/context-builder';
import { buildSnapshot } from '../execution/snapshot';
import { RUN_EVENT_TYPES, RunEventStore } from '../execution/run-events';
import {
  SEED_AGENTS,
  SEED_COMPLETED_TASK,
  SEED_KNOWLEDGE,
  SEED_QUEUED_TASK,
  SEED_SKILLS,
  SEED_WORKFLOWS,
} from './seed-data';

export function seedIfEmpty(db: Db): boolean {
  const row = db.prepare('SELECT COUNT(*) AS c FROM agents').get() as { c: number };
  if (row.c > 0) return false;
  seed(db);
  return true;
}

export function clearAll(db: Db): void {
  const tables = [
    'run_events',
    'approvals',
    'step_runs',
    'task_runs',
    'tasks',
    'workflow_steps',
    'workflows',
    'agent_knowledge',
    'agent_skills',
    'knowledge_items',
    'skills',
    'agents',
  ];
  const run = db.transaction(() => {
    for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
  });
  run();
}

export function seed(db: Db): void {
  const agents = new AgentRepository(db);
  const skills = new SkillRepository(db);
  const knowledge = new KnowledgeRepository(db);
  const workflows = new WorkflowRepository(db);
  const tasks = new TaskRepository(db);
  const runs = new RunRepository(db);
  const events = new RunEventStore(db);

  const skillIds = new Map<string, string>();
  for (const seedSkill of SEED_SKILLS) {
    const created = skills.create(seedSkill);
    skillIds.set(created.name, created.id);
  }

  const knowledgeIds = new Map<string, string>();
  for (const seedKnowledge of SEED_KNOWLEDGE) {
    const created = knowledge.create(seedKnowledge);
    knowledgeIds.set(created.title, created.id);
  }

  const agentIds = new Map<string, string>();
  for (const seedAgent of SEED_AGENTS) {
    const created = agents.create({
      name: seedAgent.name,
      role: seedAgent.role,
      description: seedAgent.description,
      systemPrompt: seedAgent.systemPrompt,
      model: DEFAULT_MODEL,
      status: 'ACTIVE',
    });
    agentIds.set(created.name, created.id);
    agents.setMounts(created.id, {
      skillIds: seedAgent.skills.map((name) => requireId(skillIds, name)),
      knowledgeIds: seedAgent.knowledge.map((name) => requireId(knowledgeIds, name)),
    });
  }

  const workflowIds = new Map<string, string>();
  for (const seedWorkflow of SEED_WORKFLOWS) {
    const created = workflows.create({
      name: seedWorkflow.name,
      description: seedWorkflow.description,
      scenario: seedWorkflow.scenario,
      tags: seedWorkflow.tags,
      matchKeywords: seedWorkflow.matchKeywords,
      status: seedWorkflow.status,
      steps: seedWorkflow.steps.map((step, index) => ({
        stepKey: step.stepKey,
        name: step.name,
        agentId: requireId(agentIds, step.agentName),
        instructionMd: step.instructionMd,
        dependsOn: step.dependsOn,
        orderIndex: index,
        gateMode: step.gateMode ?? 'NONE',
        timeoutSeconds: DEFAULT_STEP_TIMEOUT_SECONDS,
      })),
    });
    workflowIds.set(created.name, created.id);
  }

  const completedWorkflow = workflows.findById(
    requireId(workflowIds, SEED_COMPLETED_TASK.workflowName),
  );
  if (completedWorkflow) {
    const task = tasks.create({
      title: SEED_COMPLETED_TASK.title,
      description: SEED_COMPLETED_TASK.description,
      scenario: SEED_COMPLETED_TASK.scenario,
      workflowId: completedWorkflow.id,
    });
    seedCompletedRun({ agents, runs, tasks, events, workflows }, task.id, completedWorkflow.id);
  }

  tasks.create({
    title: SEED_QUEUED_TASK.title,
    description: SEED_QUEUED_TASK.description,
    scenario: SEED_QUEUED_TASK.scenario,
    workflowId: requireId(workflowIds, SEED_QUEUED_TASK.workflowName),
  });
}

interface CompletedRunDeps {
  agents: AgentRepository;
  runs: RunRepository;
  tasks: TaskRepository;
  events: RunEventStore;
  workflows: WorkflowRepository;
}

function seedCompletedRun(
  deps: CompletedRunDeps,
  taskId: string,
  workflowId: string,
): void {
  const workflow = deps.workflows.findById(workflowId);
  if (!workflow) return;

  const snapshot = buildSnapshot(workflow, (agentId) => {
    const detail = deps.agents.findDetail(agentId);
    if (!detail) throw new Error(`seed: agent ${agentId} missing`);
    return toAgentProfile(detail);
  });

  const run = deps.runs.createRun({
    taskId,
    runNumber: 1,
    snapshot,
    steps: snapshot.steps,
  });
  deps.tasks.setCurrentRun(taskId, run.id);
  deps.runs.updateRunStatus(run.id, 'RUNNING', { startedAt: nowIso() });
  deps.events.append({
    runId: run.id,
    type: RUN_EVENT_TYPES.RUN_STARTED,
    message: '开始执行（演示数据）',
  });

  const task = deps.tasks.findById(taskId);
  if (!task) return;
  const stepRuns = deps.runs.listStepRuns(run.id);
  const outputByKey = new Map<string, string>();

  for (const step of snapshot.steps) {
    const stepRun = stepRuns.find((candidate) => candidate.stepKey === step.stepKey);
    if (!stepRun) continue;
    const agent = snapshot.agents[step.agentId];
    if (!agent) continue;

    const outputMd =
      SEED_COMPLETED_TASK.outputs[step.stepKey] ??
      `# ${step.name}\n\n已按步骤要求完成，产物供下游使用。`;

    const context = buildContext({
      agent,
      task: { title: task.title, description: task.description, scenario: task.scenario },
      step: {
        stepKey: step.stepKey,
        name: step.name,
        instructionMd: step.instructionMd,
        gateMode: step.gateMode,
      },
      dependencyOutputs: step.dependsOn.map((key) => {
        const dependency = snapshot.steps.find((candidate) => candidate.stepKey === key);
        return {
          stepKey: key,
          stepName: dependency?.name ?? key,
          outputMd: outputByKey.get(key) ?? null,
        };
      }),
    });

    deps.runs.markStepReady(stepRun.id);
    deps.events.append({
      runId: run.id,
      stepRunId: stepRun.id,
      type: RUN_EVENT_TYPES.STEP_READY,
      message: `步骤「${step.name}」就绪`,
    });
    deps.runs.markStepRunning(stepRun.id, context, 'mock');
    deps.events.append({
      runId: run.id,
      stepRunId: stepRun.id,
      type: RUN_EVENT_TYPES.STEP_STARTED,
      message: `步骤「${step.name}」开始，执行者：${agent.name}`,
    });
    deps.runs.markStepWaitingApproval(stepRun.id, outputMd, {
      inputTokens: Math.ceil((context.systemPrompt.length + context.userPrompt.length) / 3),
      outputTokens: Math.ceil(outputMd.length / 3),
      model: 'mock',
    });
    deps.events.append({
      runId: run.id,
      stepRunId: stepRun.id,
      type: RUN_EVENT_TYPES.STEP_OUTPUT,
      message: `步骤「${step.name}」产物已生成`,
      payload: { chars: outputMd.length },
    });

    if (step.gateMode === 'HUMAN_APPROVAL') {
      const approval = deps.runs.createApproval(run.id, stepRun.id);
      deps.events.append({
        runId: run.id,
        stepRunId: stepRun.id,
        type: RUN_EVENT_TYPES.APPROVAL_REQUESTED,
        message: `步骤「${step.name}」等待人工审批`,
        payload: { approvalId: approval.id },
      });
      deps.runs.decideApproval(approval.id, 'APPROVED', '演示审批：产物符合预期');
      deps.events.append({
        runId: run.id,
        stepRunId: stepRun.id,
        type: RUN_EVENT_TYPES.APPROVAL_DECIDED,
        message: '审批通过：演示审批：产物符合预期',
        payload: { decision: 'APPROVED', comment: '演示审批：产物符合预期' },
      });
    }

    deps.runs.markStepSucceeded(stepRun.id);
    deps.events.append({
      runId: run.id,
      stepRunId: stepRun.id,
      type: RUN_EVENT_TYPES.STEP_SUCCEEDED,
      message: `步骤「${step.name}」完成`,
    });
    outputByKey.set(step.stepKey, outputMd);
  }

  deps.runs.updateRunStatus(run.id, 'SUCCEEDED', {
    startedAt: run.startedAt ?? nowIso(),
    finishedAt: nowIso(),
  });
  deps.tasks.updateStatus(taskId, 'SUCCEEDED');
  deps.events.append({
    runId: run.id,
    type: RUN_EVENT_TYPES.RUN_SUCCEEDED,
    message: '全部步骤完成，任务成功',
  });
}

function requireId(map: Map<string, string>, key: string): string {
  const id = map.get(key);
  if (!id) throw new Error(`seed: missing ${key}`);
  return id;
}
