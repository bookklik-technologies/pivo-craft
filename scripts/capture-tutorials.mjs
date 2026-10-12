import { join } from 'node:path';
import { startCapture } from './tutorial-capture-lib.mjs';

const capture = await startCapture(new URL('../', import.meta.url), 5181);
const { page, shot, download, out, settle } = capture;
const button = name => page.getByRole('button', { name, exact: true });
async function options(name) { await page.locator('summary').filter({ hasText: new RegExp(`^${name}$`) }).click(); }
async function field(selector, value) { if (selector === '#duration' && !(await page.locator(selector).isVisible())) await options('Frame options'); await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab'); }
async function color(hex) { await page.locator('#fg').fill(hex); }
async function pixel(x, y) {
  const box = await page.locator('#viewport').boundingBox();
  const zoom = Number(await page.locator('#zoom').inputValue());
  return { x: box.x + box.width / 2 + (x - 8 + .5) * zoom, y: box.y + box.height / 2 + (y - 8 + .5) * zoom };
}
async function line(a, b = a) {
  const start = await pixel(...a), end = await pixel(...b);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
}
async function save(name) { await download(name, () => button('Save project').click()); }
async function reopen(name) { await page.locator('#open-file').setInputFiles(join(out, name)); await settle(); }
try {
  await options('File'); await button('New project…').click();
  await field('[name=name]', 'Pixel Face'); await field('[name=width]', 16); await field('[name=height]', 16);
  await page.locator('[name=mode]').selectOption('rgba');
  await shot('face-01-new', page.locator('#modal'));
  await button('Create').click(); await options('View options'); await button('Fit').click();
  await color('#facc15'); await button('Rectangle').click(); await options('Brush options'); await page.locator('#filled').check();
  await line([2, 2], [13, 13]); await shot('face-02-shape');
  await button('Pencil').click(); await color('#182131');
  await line([5, 5], [5, 6]); await line([10, 5], [10, 6]);
  await line([5, 10]); await line([6, 11], [9, 11]); await line([10, 10]);
  await shot('face-03-details', page.locator('.workspace'));
  await line([0, 0]); await page.locator('#viewport').focus(); await page.keyboard.press('Control+z');
  await save('pixel-face.pvc'); await shot('face-04-finished');
  await reopen('pixel-face.pvc');
  await field('#duration', 800); await page.locator('#continuous').uncheck(); await shot('blink-01-original',page.locator('.timelinebar .suite-menu-popup'));
  await button('+ Frame').click(); await options('Frame options'); await button('Unlink').click(); await field('#duration', 200);
  await shot('blink-02-copy',page.locator('.timelinebar .suite-menu-popup'));
  await color('#facc15'); await button('Pencil').click(); await line([5,5],[5,6]); await line([10,5],[10,6]);
  await color('#182131'); await line([4,6],[6,6]); await line([9,6],[11,6]);
  await shot('blink-03-eyes', page.locator('.workspace'));
  await options('Frame options'); await page.locator('#show-preview').check(); await button('Play').click();
  await page.waitForTimeout(250); await button('Stop').click();
  await page.locator('[data-frame]').nth(1).click();
  await save('blinking-face.pvc'); await shot('blink-04-preview');
  await reopen('blinking-face.pvc');
  await save('finished-face.pvc'); await shot('export-01-save');
  await reopen('finished-face.pvc');
  const project = await page.evaluate(() => window.pivoCraft.snapshot());
  if (project.width !== 16 || project.frames.length !== 2 || project.frames[0].duration !== 800 || project.frames[1].duration !== 200 || project.cels[0].imageId === project.cels[1].imageId) throw new Error('Blink checkpoint did not reopen correctly');
  await page.locator('[data-frame]').first().click(); await shot('export-02-reopened');
  await button('Export').click(); await page.getByLabel('Export format').selectOption('png');
  await shot('export-03-png', page.locator('#modal'));
  await download('pixel-face.png', () => page.locator('#modal-form button[type=submit]').click());
  await button('Export').click(); await page.getByLabel('Export format').selectOption('gif');
  await page.locator('[name=range]').uncheck();
  await shot('export-04-gif', page.locator('#modal'));
  await download('blinking-face.gif', () => page.locator('#modal-form button[type=submit]').click());
  await capture.report({ project: 'Pixel Face', frames: 2, durationsMs: [800, 200], checkpointsReopened: ['pixel-face.pvc', 'blinking-face.pvc', 'finished-face.pvc'] });
} catch (error) {
  await page.screenshot({ path: join(out, 'capture-error.png') });
  throw error;
} finally { await capture.close(); }
