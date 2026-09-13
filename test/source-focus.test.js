import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSourceFocusModel } from '../source-focus.js';

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
