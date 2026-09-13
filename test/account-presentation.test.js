import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { shouldPresentSignInModal } from '../account-presentation.js';

const accountPresentationPath = new URL('../account-presentation.js', import.meta.url);
const appPath = new URL('../app.js', import.meta.url);

test('signed-out account entry uses modal presentation', () => {
  assert.equal(shouldPresentSignInModal({ signInPanelHidden: false }), true);
  assert.equal(shouldPresentSignInModal({ signInPanelHidden: true }), false);
});

test('account modal reuses the existing sign-in panel and blocks the old scroll handler', async () => {
  const source = await readFile(accountPresentationPath, 'utf8');
  assert.match(source, /document\.body\.append\(signInPanel\)/);
  assert.match(source, /originalParent\.insertBefore\(signInPanel, originalNextSibling\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /#accountHeaderButton/);
  assert.doesNotMatch(source, /cloneNode\(/);
});

test('focused workspace keeps the existing My decks panel as a compact switcher', async () => {
  const source = await readFile(accountPresentationPath, 'utf8');
  assert.match(source, /#your-questions\.source-workspace-collapsed > :not\(#myDecksPanel\)/);
  assert.match(source, /#myDecksList/);
  assert.match(source, /overflow-x:\s*auto/);
  assert.match(source, /\[data-deck-study\]/);
});

test('account interception initializes before source-focus navigation capture', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /setupAccountPresentation\(\);/);
  assert.ok(source.indexOf('setupAccountPresentation();') < source.indexOf('setupSourceFocusUI(state);'));
});
