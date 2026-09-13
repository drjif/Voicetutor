import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canOfferStarredQuestion,
  findSavedSourceForSheet,
  normalizeStarredQuestion,
  starredCountsBySource,
  starredRowsForSource
} from '../starred-questions.js';

test('Google Sheet questions can offer a star before the deck has a saved-source id', () => {
  assert.equal(canOfferStarredQuestion({ sourceKind: 'google-sheet', sourceRow: 12 }), true);
  assert.equal(canOfferStarredQuestion({ sourceKind: 'google-sheet', sourceRow: null }), false);
  assert.equal(canOfferStarredQuestion({ sourceKind: 'paste', sourceRow: 12 }), false);
});

test('findSavedSourceForSheet resolves an already-saved Sheet by spreadsheet and tab identity', () => {
  const sources = [
    { id: 'one', spreadsheet_id: 'sheet-a', sheet_gid: '0' },
    { id: 'two', spreadsheet_id: 'sheet-b', sheet_gid: '123' }
  ];
  assert.equal(findSavedSourceForSheet(sources, { spreadsheetId: 'sheet-b', sheetGid: '123' })?.id, 'two');
  assert.equal(findSavedSourceForSheet(sources, { spreadsheetId: 'sheet-b', sheetGid: '999' }), null);
});

test('normalizeStarredQuestion stores only deck and row references', () => {
  assert.deepEqual(normalizeStarredQuestion({
    id: 'star-1',
    user_id: 'user-1',
    saved_source_id: 'deck-1',
    source_row: 42,
    created_at: '2026-09-12T00:00:00Z',
    question: 'must not survive normalization',
    answer: 'must not survive normalization'
  }), {
    id: 'star-1',
    user_id: 'user-1',
    saved_source_id: 'deck-1',
    source_row: 42,
    created_at: '2026-09-12T00:00:00Z'
  });
});

test('normalizeStarredQuestion rejects invalid source rows', () => {
  assert.throws(() => normalizeStarredQuestion({ saved_source_id: 'deck-1', source_row: 0 }), /positive source row/i);
  assert.throws(() => normalizeStarredQuestion({ saved_source_id: '', source_row: 2 }), /saved deck/i);
});

test('starredRowsForSource deduplicates and sorts rows', () => {
  const rows = [
    { saved_source_id: 'deck-1', source_row: 12 },
    { saved_source_id: 'deck-2', source_row: 5 },
    { saved_source_id: 'deck-1', source_row: 3 },
    { saved_source_id: 'deck-1', source_row: 12 }
  ];
  assert.deepEqual(starredRowsForSource(rows, 'deck-1'), [3, 12]);
});

test('starredCountsBySource groups stars without content data', () => {
  const counts = starredCountsBySource([
    { saved_source_id: 'deck-a', source_row: 2 },
    { saved_source_id: 'deck-a', source_row: 9 },
    { saved_source_id: 'deck-b', source_row: 4 }
  ]);
  assert.equal(counts.get('deck-a'), 2);
  assert.equal(counts.get('deck-b'), 1);
});
