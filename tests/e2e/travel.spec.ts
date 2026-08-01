import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const vars = Object.fromEntries((await readFile('.dev.vars', 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));

test('world map renders with interactive search', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.map-canvas canvas')).toBeVisible();
  await page.waitForTimeout(900);
  const mapImage = await page.locator('.map-canvas').screenshot({ path: testInfo.outputPath('world-map.png') });
  const stats = await sharp(mapImage).stats();
  expect(stats.channels.slice(0, 3).every((channel) => channel.stdev > 8)).toBeTruthy();
  await page.locator('.action-search').click();
  await page.locator('.search-row input').fill('星海广场');
  await page.locator('.search-row input').press('Enter');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('search-results.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test('desktop management opens an anchored editor', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'editing is desktop-only');
  await page.goto('/manage');
  await expect(page.locator('.login-form')).toBeVisible();
  await page.locator('.login-form input[type="password"]').fill(vars.TRAVEL_PASSWORD);
  await page.locator('.login-form button[type="submit"]').click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0, { timeout: 15_000 });

  await page.goto('/');
  await expect(page.locator('.action-manage .lucide-log-out')).toHaveCount(0);
  await page.locator('.action-manage').click();
  await expect(page).toHaveURL(/\/manage$/);
  await expect(page.locator('.action-manage .lucide-log-out')).toBeVisible();

  const map = page.locator('.map-canvas');
  const box = await map.boundingBox();
  if (!box) throw new Error('map has no bounding box');
  await page.mouse.click(box.x + box.width * .58, box.y + box.height * .62, { button: 'right' });
  await expect(page.locator('.editor-form')).toBeVisible();
  await page.locator('.panel-actions .icon-command').click();
  await expect(page).toHaveURL(/\/manage$/);

  await page.mouse.click(box.x + box.width * .58, box.y + box.height * .62, { button: 'right' });
  await expect(page.locator('.editor-form')).toBeVisible();
  await page.locator('.editor-form input').first().fill('Browser acceptance note');
  await page.locator('.editor-form textarea').fill('A short **Markdown** note.');
  await page.screenshot({ path: testInfo.outputPath('anchored-editor.png'), fullPage: true });
  const editorBox = await page.locator('.node-overlay').boundingBox();
  expect(editorBox?.width).toBeGreaterThanOrEqual(480);
  expect(editorBox?.height).toBeLessThanOrEqual(630);
});

test('mobile remains a clean read-only map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile viewport only');
  await page.goto('/');
  await expect(page.locator('.map-canvas canvas')).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: testInfo.outputPath('mobile-map.png'), fullPage: true });
  const actions = await page.locator('.edge-action').all();
  const boxes = await Promise.all(actions.map((action) => action.boundingBox()));
  for (let left = 0; left < boxes.length; left += 1) for (let right = left + 1; right < boxes.length; right += 1) {
    const a = boxes[left]; const b = boxes[right];
    if (!a || !b) continue;
    const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlap).toBeFalsy();
  }
});
