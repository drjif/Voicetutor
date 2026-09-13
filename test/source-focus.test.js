import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildSourceFocusModel, buildWorkspacePresentation } from '../source-focus.js';

const sourceFocusPath = new URL('../source-focus.js', import.meta.url);

test('source focus stays inactive until a usable deck exists', () => {
  assert.deepEqual(buildSourceFocusModel({ sourceKind: 'none', questions: [] }), {
    ready: false,
    kind: 'none',
    label: 'Question bank',
    name: 'Question bank',
    questionCount: 0,
    saved: false,
    countText: '0 questions'
  });
});

test('saved Google Sheet summary is compact and content-free', () => {
  const model = buildSourceFocusModel({
    sourceKind: 'google-sheet',
    sourceName: 'GI Boards',
    savedSourceId: 'opaque-source-id',
    questions: new Array(625).fill({})
  });

  assert.equal(model.ready, true);
  assert.equal(model.label, 'Google Sheet');
  assert.equal(model.name, 'GI Boards');
  assert.equal(model.questionCount, 625);
  assert.equal(model.saved, true);
  assert.equal(model.countText, '625 questions · Saved');
  assert.equal(JSON.stringify(model).includes('opaque-source-id'), false);
});

test('local modalities get human-readable source labels', () => {
  const excel = buildSourceFocusModel({ sourceKind: 'xlsx', sourceName: 'review.xlsx', questions: [{}] });
  const anki = buildSourceFocusModel({ sourceKind: 'anki', sourceName: 'cards.apkg', questions: [{}, {}] });
  const paste = buildSourceFocusModel({ sourceKind: 'paste', questions: [{}] });

  assert.equal(excel.label, 'Excel file');
  assert.equal(excel.countText, '1 question');
  assert.equal(anki.label, 'Anki deck');
  assert.equal(anki.countText, '2 questions');
  assert.equal(paste.label, 'Pasted questions');
  assert.equal(paste.name, 'Pasted questions');
});

test('workspace becomes focused only after a usable deck exists', () => {
  assert.deepEqual(buildWorkspacePresentation({ sourceKind: 'none', questions: [], status: 'idle' }), {
    state: 'landing',
    sessionActive: false
  });

  assert.deepEqual(buildWorkspacePresentation({ sourceKind: 'google-sheet', questions: [{}], status: 'idle' }), {
    state: 'ready',
    sessionActive: false
  });
});

test('running, paused, and completed sessions prioritize the player', () => {
  for (const status of ['running', 'listening', 'waiting', 'paused', 'complete']) {
    assert.deepEqual(buildWorkspacePresentation({ sourceKind: 'paste', questions: [{}], status }), {
      state: 'session',
      sessionActive: true
    });
  }

  assert.deepEqual(buildWorkspacePresentation({ sourceKind: 'paste', questions: [{}], status: 'idle' }), {
    state: 'ready',
    sessionActive: false
  });
});

test('focused workspace collapses marketing and onboarding without removing source DOM', async () => {
  const source = await readFile(sourceFocusPath, 'utf8');
  assert.match(source, /body\[data-same3le-workspace="ready"\] \.hero/);
  assert.match(source, /body\[data-same3le-workspace="ready"\] #start-studying/);
  assert.match(source, /body\[data-same3le-workspace="ready"\] \.free-product-strip/);
  assert.match(source, /body\[data-same3le-workspace="ready"\] \.how-card/);
  assert.match(source, /#your-questions\.source-workspace-collapsed/);
  assert.match(source, /sourceSection\.classList\.toggle\('source-workspace-collapsed'/);
  assert.match(source, /document\.body\.dataset\.same3leWorkspace = workspace\.state/);
  assert.match(source, /observer\.observe\(statusBadge, \{ attributes: true, attributeFilter: \['data-status'\] \}\)/);
});
