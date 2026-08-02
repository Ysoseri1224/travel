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
  await page.locator('.search-row input').fill('中国');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await expect(page.locator('.search-summary')).toContainText(/去过的城市|Visited cities/);
  await page.screenshot({ path: testInfo.outputPath('search-results.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test('desktop management keeps the map interactive beside a fixed editor drawer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'editing is desktop-only');
  await page.goto('/manage');
  await expect(page.locator('.login-form')).toBeVisible();
  await page.locator('.login-form input[type="password"]').fill(vars.TRAVEL_PASSWORD);
  await page.locator('.login-form button[type="submit"]').click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0, { timeout: 15_000 });

  await expect(page.locator('.action-manage .lucide-log-out')).toBeVisible();
  await page.locator('.action-map').click();
  await page.locator('.country-menu button').filter({ hasText: /中华人民共和国|China/ }).click();
  await expect(page.locator('.country-mode')).toBeVisible();
  await expect(page.locator('.zoom-local')).toHaveCount(0);

  const placeLabel = page.locator('.place-label').first();
  await expect(placeLabel).toBeVisible();
  await expect(placeLabel).toHaveCSS('opacity', '0.9');
  await page.waitForTimeout(700);

  const pinState = await page.locator('.pin-button:not([disabled])').evaluateAll((buttons) => {
    const target = buttons.find((button) => button.getBoundingClientRect().x > 600) || buttons[0];
    const rect = target.parentElement!.getBoundingClientRect();
    const label = target.getAttribute('aria-label') || '';
    (target as HTMLButtonElement).click();
    return { label, x: rect.x, y: rect.y };
  });
  const drawer = page.locator('.editor-drawer');
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/\/manage$/);
  await page.waitForTimeout(500);
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox?.x).toBeLessThanOrEqual(1);
  expect(drawerBox?.width).toBeGreaterThanOrEqual(480);
  expect(drawerBox?.height).toBeGreaterThanOrEqual(890);

  const pinAfter = await page.evaluate((label) => {
    const target = [...document.querySelectorAll('.pin-button')].find((button) => button.getAttribute('aria-label') === label);
    const rect = target?.parentElement?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y } : null;
  }, pinState.label);
  expect(Math.abs((pinAfter?.x || 0) - pinState.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((pinAfter?.y || 0) - pinState.y)).toBeLessThanOrEqual(1);

  const map = page.locator('.map-canvas');
  const box = await map.boundingBox();
  if (!box) throw new Error('map has no bounding box');
  await page.mouse.click(box.x + box.width * .72, box.y + box.height * .62, { button: 'right' });
  await expect(page.locator('.editor-form input').first()).toHaveValue('');

  await page.locator('.editor-form input').first().fill('Unsaved browser note');
  await page.mouse.click(box.x + box.width * .8, box.y + box.height * .7, { button: 'right' });
  const discardDialog = page.getByRole('alertdialog');
  await expect(discardDialog).toBeVisible();
  await discardDialog.locator('.danger').click();
  await expect(discardDialog).toHaveCount(0);
  await expect(page.locator('.editor-form input').first()).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('fixed-editor-drawer.png'), fullPage: true });
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
