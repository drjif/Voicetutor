import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceFocusPath = new URL('../source-focus-ui.js', import.meta.url);
const appPath = new URL('../app.js', import.meta.url);
const workerPath = new URL('../service-worker.js', import.meta.url);

test('focused source UI is presentation-only and preserves existing importer DOM', async () => {
  const source = await readFile(sourceFocusPath, 'utf8');
  assert.match(source, /data-source-options/);
  assert.match(source, /Change source/);
  assert.match(source, /MutationObserver/);
  assert.doesNotMatch(source, /\.remove\s*\(/);
  assert.doesNotMatch(source, /replaceChildren\s*\(/);
});

test('unsaved Google Sheets keep their source actions while saved sources enter study focus', async () => {
  const source = await readFile(sourceFocusPath, 'utf8');
  assert.match(source, /sourceKind === 'google-sheet' && !savedSourceId \? 'source' : 'study'/);
  assert.match(source, /data-source-kind=\\"google-sheet\\"/);
  assert.match(source, /#personalBankControls/);
});

test('focused source UI initializes after dynamic import panels and is cached', async () => {
  const [app, worker] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(workerPath, 'utf8')
  ]);
  assert.match(app, /import \{ setupSourceFocusUI \} from '\.\/source-focus-ui\.js';/);
  assert.ok(app.indexOf('setupFileImportUI();') < app.indexOf('setupSourceFocusUI();'));
  assert.match(worker, /\.\/source-focus-ui\.js/);
});
