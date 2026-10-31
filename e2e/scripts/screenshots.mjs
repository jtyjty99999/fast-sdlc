/**
 * 生成使用文档截图。
 * 运行：pnpm --filter @autosdd/e2e exec node scripts/screenshots.mjs
 * 目标：临时演示服务 http://127.0.0.1:4102（使用独立 shots.db，不触碰开发库）
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SCREENSHOT_BASE ?? 'http://127.0.0.1:4102';
const OUT = process.env.SCREENSHOT_DIR ?? join(SCRIPT_DIR, '../../docs/guide/images');
const VIEWPORT = { width: 1440, height: 900 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, init = {}) {
  const headers = init.body ? { 'content-type': 'application/json', ...(init.headers ?? {}) } : init.headers;
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await response.json();
  if (!body.ok) throw new Error(`${path} failed: ${body.error?.message ?? response.status}`);
  return body.data;
}

async function getTask(taskId) {
  const detail = await api(`/api/tasks/${taskId}`);
  return detail.task;
}

async function waitForTask(taskId, statuses, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getTask(taskId);
    if (statuses.includes(task.status)) return task;
    await sleep(500);
  }
  throw new Error(`timeout waiting for task ${taskId} to be ${statuses.join('/')}`);
}

async function approvePending(runId, comment) {
  const run = await api(`/api/runs/${runId}`);
  const step = run.steps.find((item) => item.approval?.status === 'PENDING');
  if (!step) throw new Error(`run ${runId} has no pending approval`);
  await api(`/api/runs/${runId}/steps/${step.id}/approval`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'APPROVED', comment }),
  });
}

async function capture(page, path, file, { fullPage = true, wait = 900 } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell');
  await sleep(wait);
  await page.screenshot({ path: join(OUT, file), fullPage });
  console.log(`captured ${file}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const agents = await api('/api/agents');
  const workflows = await api('/api/workflows');
  const workflow = workflows.find((item) => item.name === '新功能开发');
  const agent = agents.find((item) => item.name === '需求分析师');
  if (!workflow || !agent) throw new Error('seed data missing workflow or agent');

  // 先准备一个到达人工卡点的任务，截图时直接进入详情页
  const task = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: '新增销售报表导出',
      description:
        '支持按日期范围筛选订单并导出 CSV，包含角色权限校验、审计日志与大数据量分页；导出任务需要可重复执行且不产生重复记录。',
      scenario: '新功能开发',
      workflowId: workflow.id,
    }),
  });
  await api(`/api/tasks/${task.id}/run`, { method: 'POST' });
  await waitForTask(task.id, ['WAITING_APPROVAL']);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  await capture(page, '/', '01-overview.png');
  await capture(page, '/tasks', '02-tasks.png');
  await capture(page, `/tasks/${task.id}`, '03-task-approval.png', { wait: 1200 });

  // 新建任务弹层：填写内容，等待推荐结果
  await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell');
  await page.getByRole('button', { name: '+ 新建任务' }).click();
  await page.fill('#task-title', '为订单中心增加批量取消接口');
  await page.fill('#task-scenario', '新功能开发');
  await page.fill(
    '#task-desc',
    '支持按订单号批量取消未支付订单，返回逐条处理结果；需要权限校验、幂等与失败重试，并补充接口文档。',
  );
  await sleep(1200);
  await page.screenshot({ path: join(OUT, '04-task-create.png'), fullPage: false });
  console.log('captured 04-task-create.png');
  await page.getByRole('button', { name: '取消' }).click();

  await capture(page, '/agents', '05-agents.png');
  await capture(page, `/agents/${agent.id}`, '06-agent-detail.png', { fullPage: false });
  await page.getByRole('tab', { name: '上下文预览' }).click();
  await sleep(1000);
  await page.screenshot({ path: join(OUT, '07-agent-context.png'), fullPage: true });
  console.log('captured 07-agent-context.png');

  await capture(page, '/skills', '08-skills.png');
  await capture(page, '/knowledge', '09-knowledge.png');
  await capture(page, '/workflows', '10-workflows.png');
  await capture(page, `/workflows/${workflow.id}`, '11-workflow-editor.png');
  await capture(page, '/models', '12-models.png');

  // 审批通过两处卡点，截取完成态
  const runningTask = await getTask(task.id);
  await approvePending(runningTask.currentRunId, '产物符合预期，继续。');
  await waitForTask(task.id, ['WAITING_APPROVAL']);
  const secondGate = await getTask(task.id);
  await approvePending(secondGate.currentRunId, '评审意见已确认，同意交付。');
  await waitForTask(task.id, ['SUCCEEDED']);

  await capture(page, `/tasks/${task.id}`, '13-task-detail.png', { wait: 1400 });
  await page.getByRole('tab', { name: '上下文' }).click();
  await sleep(800);
  await page.screenshot({ path: join(OUT, '14-task-context.png'), fullPage: true });
  console.log('captured 14-task-context.png');

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
