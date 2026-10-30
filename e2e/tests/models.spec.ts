import { expect, test } from '@playwright/test';

test('model registry lists seeded models and tests the mock connection', async ({ page }) => {
  // Arrange: open the model registry with seeded models.
  await page.goto('/models');
  await expect(page.getByRole('heading', { name: '模型管理' })).toBeVisible();
  await expect(page.locator('.list-row').filter({ hasText: 'Mock 模拟模型' })).toBeVisible();
  await expect(page.locator('.list-row').filter({ hasText: 'Claude Sonnet 5' })).toBeVisible();

  // Act: test the default mock model.
  await page
    .locator('.list-row')
    .filter({ hasText: 'Mock 模拟模型' })
    .getByRole('button', { name: '测试连接' })
    .click();

  // Assert: the toast reports a successful connection.
  await expect(page.getByRole('status')).toContainText('连接成功');
});
