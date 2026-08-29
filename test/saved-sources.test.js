import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGoogleSheetIdentity,
  parseGoogleSheetUrl,
  reconstructGoogleSheetUrls
} from '../sheet-data.js';
import {
  findDuplicateSavedSource,
  inferDeckDisplayName,
  mergeSavedSource,
  normalizeSavedSource,
  reconstructSavedSourceRequest,
  toSavedSourceWritePayload,
  upsertSavedSources
} from '../saved-sources.js';

test('extracts spreadsheet id and gid from edit, share, and hash URLs', () => {
  const cases = [
    ['https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?gid=987#gid=987', 'abc_DEF-123', '987'],
    ['https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=42', 'abc_DEF-123', '42'],
    ['https://docs.google.com/spreadsheets/d/abc_DEF-123/', 'abc_DEF-123', '0']
  ];
  for (const [url, spreadsheetId, sheetGid] of cases) {
    const identity = extractGoogleSheetIdentity(url);
    assert.equal(identity.spreadsheetId, spreadsheetId);
    assert.equal(identity.sheetGid, sheetGid);
    assert.equal(identity.sourceType, 'google-sheet');
  }
});

test('direct CSV URLs are readable but not saveable as account decks', () => {
  const parsed = parseGoogleSheetUrl('https://example.com/deck.csv');
  assert.equal(parsed.spreadsheetId, null);
  assert.equal(extractGoogleSheetIdentity('https://example.com/deck.csv'), null);
});

test('reconstructs export and gviz URLs from stored identifiers only', () => {
  const urls = reconstructGoogleSheetUrls('abc_DEF-123', '456');
  assert.equal(urls.spreadsheetId, 'abc_DEF-123');
  assert.equal(urls.gid, '456');
  assert.equal(urls.exportCsvUrl, 'https://docs.google.com/spreadsheets/d/abc_DEF-123/export?format=csv&gid=456');
  assert.equal(urls.csvUrl, 'https://docs.google.com/spreadsheets/d/abc_DEF-123/gviz/tq?tqx=out:csv&gid=456');
});

test('saved-source normalization keeps identifiers and drops study content', () => {
  const normalized = normalizeSavedSource({
    display_name: '  GI Boards  ',
    source_type: 'google-sheet',
    spreadsheet_id: 'abc_DEF-123',
    sheet_gid: '0',
    last_source_row: 18,
    url: 'https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?gid=0',
    question: 'What does the heart pump?',
    answer: 'Blood',
    accepted: 'blood cells'
  });
  assert.equal(normalized.display_name, 'GI Boards');
  assert.equal(normalized.spreadsheet_id, 'abc_DEF-123');
  assert.equal(normalized.sheet_gid, '0');
  assert.equal(normalized.last_source_row, 18);
  assert.equal(normalized.url, undefined);
  assert.equal(normalized.question, undefined);
  assert.equal(normalized.answer, undefined);
});

test('rejects unsupported source types and malformed identifiers', () => {
  assert.throws(() => normalizeSavedSource({ source_type: 'xlsx', spreadsheet_id: 'abc', sheet_gid: '0' }), /Google Sheets/);
  assert.throws(() => normalizeSavedSource({ spreadsheet_id: 'not a sheet', sheet_gid: '0' }), /spreadsheet id/);
  assert.throws(() => normalizeSavedSource({ spreadsheet_id: 'abc', sheet_gid: 'tab' }), /sheet tab/);
});

test('write payload requires a signed-in user and never includes a raw URL', () => {
  assert.throws(() => toSavedSourceWritePayload({ spreadsheet_id: 'abc', sheet_gid: '0' }), /Sign in/);
  const payload = toSavedSourceWritePayload({
    display_name: 'GI Boards',
    spreadsheet_id: 'abc_DEF-123',
    sheet_gid: '9',
    url: 'https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?gid=9'
  }, 'user-a');
  assert.equal(payload.user_id, 'user-a');
  assert.equal(payload.source_type, 'google-sheet');
  assert.equal(payload.url, undefined);
  assert.equal(payload.spreadsheet_id, 'abc_DEF-123');
});

test('duplicate spreadsheet plus gid updates the existing saved source', () => {
  const existing = [{
    id: 'src-1',
    user_id: 'user-a',
    display_name: 'Old name',
    source_type: 'google-sheet',
    spreadsheet_id: 'abc_DEF-123',
    sheet_gid: '0',
    last_source_row: 4
  }];
  const result = upsertSavedSources(existing, {
    display_name: 'GI Boards',
    spreadsheet_id: 'abc_DEF-123',
    sheet_gid: '0',
    last_source_row: 22,
    last_opened_at: '2026-08-29T00:00:00.000Z'
  });
  assert.equal(result.action, 'update');
  assert.equal(result.list.length, 1);
  assert.equal(result.record.id, 'src-1');
  assert.equal(result.record.display_name, 'GI Boards');
  assert.equal(result.record.last_source_row, 22);
  assert.equal(findDuplicateSavedSource(existing, { spreadsheet_id: 'abc_DEF-123', sheet_gid: '0' }).id, 'src-1');
});

test('a different gid is a new saved source, not a duplicate', () => {
  const existing = [{
    id: 'src-1',
    display_name: 'Tab one',
    spreadsheet_id: 'abc_DEF-123',
    sheet_gid: '0'
  }];
  const result = upsertSavedSources(existing, {
    display_name: 'Tab two',
    spreadsheet_id: 'abc_DEF-123',
    sheet_gid: '7'
  });
  assert.equal(result.action, 'insert');
  assert.equal(result.list.length, 2);
});

test('merge preserves the original id while updating the visible name', () => {
  const merged = mergeSavedSource(
    { id: 'src-1', spreadsheet_id: 'abc', sheet_gid: '0', display_name: 'Old' },
    { spreadsheet_id: 'abc', sheet_gid: '0', display_name: 'New' }
  );
  assert.equal(merged.id, 'src-1');
  assert.equal(merged.display_name, 'New');
});

test('reconstructed study request uses stored identifiers, not a saved URL', () => {
  const request = reconstructSavedSourceRequest({
    display_name: 'GI Boards',
    spreadsheet_id: 'abc_DEF-123',
    sheet_gid: '12',
    url: 'https://example.invalid/should-not-be-used'
  });
  assert.equal(request.sourceLabel, 'Google Sheet');
  assert.match(request.exportCsvUrl, /\/spreadsheets\/d\/abc_DEF-123\/export\?format=csv&gid=12$/);
  assert.equal(request.url, undefined);
});

test('inferred deck names stay short and content-free', () => {
  assert.equal(inferDeckDisplayName({}), 'Google Sheet');
  assert.equal(inferDeckDisplayName({ displayName: '   GI Boards   ' }), 'GI Boards');
  assert.equal(inferDeckDisplayName({ display_name: 'x'.repeat(200) }).length, 120);
});
