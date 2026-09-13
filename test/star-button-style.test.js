import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styleModulePath = new URL('../star-button-style.js', import.meta.url);
const appPath = new URL('../app.js', import.meta.url);

test('star button is explicitly visible against the dark question card', async () => {
  const source = await readFile(styleModulePath, 'utf8');
  assert.match(source, /#starQuestionButton\s*\{/);
  assert.match(source, /color:\s*#ffffff/i);
  assert.match(source, /border-color:\s*rgba\(255,\s*255,\s*255,\s*0\.78\)/i);
  assert.match(source, /#starQuestionButton\[aria-pressed="true"\]/);
  assert.match(source, /background:\s*var\(--primary\)/);
});

test('app installs star button styles before setting up starred-question UI', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /import \{ installStarButtonStyles \} from '\.\/star-button-style\.js';/);
  assert.ok(source.indexOf('installStarButtonStyles();') < source.indexOf('setupStarredQuestionUI();'));
});
