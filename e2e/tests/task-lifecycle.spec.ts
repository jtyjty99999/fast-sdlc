import { expect, test } from '@playwright/test';

test('task flows from scenario match to approved success', async ({ page }) => {
  // Arrange: open the task workspace with seeded assets.
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: '任务' })).toBeVisible();

  // Act: create a task from a natural-language description.
  await page.getByRole('button', { name: /新建任务/ }).first().click();
  await page.getByLabel('标题').fill('为订单中心增加批量取消接口');
  await page.getByLabel('场景（可选）').fill('新功能开发');
  await page
    .getByLabel('描述')
    .fill('新增批量取消订单接口，要求幂等、可重试，并补充单元测试与评审。');

  const recommended = page.locator('.match-card').filter({ hasText: '新功能开发' }).first();
  await expect(recommended).toBeVisible();
  await recommended.click();
  await page.getByRole('button', { name: '创建并运行' }).click();

  // Assert: the task detail page opens and streams to the first gate.
  await expect(page).toHaveURL(/\/tasks\/[A-Z0-9]+$/);
  await expect(page.getByText(/人工审批卡点：编码实现/)).toBeVisible();

  // Act: approve the implementation gate.
  await page
    .locator('.approval-banner')
    .getByRole('button', { name: '通过' })
    .click();

  // Assert: the pipeline resumes and stops at the review gate.
  await expect(page.getByText(/人工审批卡点：代码评审/)).toBeVisible();
  await page
    .locator('.approval-banner')
    .getByRole('button', { name: '通过' })
    .click();

  // Assert: the run reaches the terminal success state.
  await expect(
    page.locator('.task-meta .badge').filter({ hasText: '已完成' }),
  ).toBeVisible();

  // Assert: events were persisted and are visible in the log.
  await page.getByRole('tab', { name: /事件/ }).click();
  await expect(page.locator('.log-list')).toContainText('RUN_SUCCEEDED');
  await expect(page.locator('.log-list')).toContainText('STEP_DELTA');

  // Assert: history survives a full page reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: '为订单中心增加批量取消接口' })).toBeVisible();
  await expect(
    page.locator('.task-meta .badge').filter({ hasText: '已完成' }),
  ).toBeVisible();
});
