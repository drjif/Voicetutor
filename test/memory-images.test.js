import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MEMORY_IMAGE_HARD_LIMIT_BYTES,
  MEMORY_IMAGE_TARGET_BYTES,
  cardFingerprint,
  filterMemoryImagesBySource,
  fitImageDimensions,
  memoryImageObjectPath,
  normalizeMemoryImageAsset,
  resolveMemoryImageCardText,
  reviewImageModel
} from '../memory-images.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function asset(overrides = {}) {
  return {
    id: overrides.id ?? 'asset-1',
    user_id: 'user-1',
    saved_source_id: overrides.saved_source_id ?? 'deck-1',
    source_row: overrides.source_row ?? 3,
    question_column: overrides.question_column ?? 0,
    answer_column: overrides.answer_column ?? 1,
    question_hash: overrides.question_hash ?? HASH_A,
    image_hash: overrides.image_hash ?? HASH_B,
    storage_path: overrides.storage_path ?? `user-1/${HASH_B}.webp`,
    mime_type: overrides.mime_type ?? 'image/webp',
    byte_size: overrides.byte_size ?? 280000,
    width: overrides.width ?? 1600,
    height: overrides.height ?? 1000,
    created_at: null,
    updated_at: null
  };
}

test('memory image limits favor compact screenshots while preserving a 1 MB hard ceiling', () => {
  assert.equal(MEMORY_IMAGE_TARGET_BYTES, 500 * 1024);
  assert.equal(MEMORY_IMAGE_HARD_LIMIT_BYTES, 1024 * 1024);
});

test('image dimensions preserve aspect ratio and never upscale small screenshots', () => {
  assert.deepEqual(fitImageDimensions(3024, 1964, 1600), { width: 1600, height: 1039 });
  assert.deepEqual(fitImageDimensions(900, 600, 1600), { width: 900, height: 600 });
  assert.deepEqual(fitImageDimensions(1200, 2400, 1600), { width: 800, height: 1600 });
});

test('card fingerprints ignore inconsequential whitespace but change when content changes', async () => {
  const first = await cardFingerprint({ question: 'Pancreatic   cysts?', answer: 'IPMN\nMCN' });
  const whitespaceOnly = await cardFingerprint({ question: ' Pancreatic cysts? ', answer: 'IPMN MCN' });
  const changed = await cardFingerprint({ question: 'Pancreatic cysts?', answer: 'IPMN, MCN, SCA' });
  assert.equal(first, whitespaceOnly);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('deduplicated storage path depends on the user and optimized image hash, not the question row', () => {
  assert.equal(memoryImageObjectPath('user-1', HASH_B, 'image/webp'), `user-1/${HASH_B}.webp`);
  assert.equal(memoryImageObjectPath('user-1', HASH_B, 'image/jpeg'), `user-1/${HASH_B}.jpg`);
});

test('memory image metadata stores mapping and hashes without question or answer text', () => {
  const normalized = normalizeMemoryImageAsset(asset());
  assert.equal(normalized.source_row, 3);
  assert.equal(normalized.question_column, 0);
  assert.equal(normalized.answer_column, 1);
  assert.equal(normalized.byte_size, 280000);
  assert.equal(Object.hasOwn(normalized, 'question_text'), false);
  assert.equal(Object.hasOwn(normalized, 'answer_text'), false);
  assert.throws(() => normalizeMemoryImageAsset(asset({ byte_size: MEMORY_IMAGE_HARD_LIMIT_BYTES + 1 })), /storage limit/i);
  assert.throws(() => normalizeMemoryImageAsset(asset({ mime_type: 'image/png' })), /unsupported/i);
  assert.throws(() => normalizeMemoryImageAsset(asset({ answer_column: 0 })), /columns/i);
});

test('review source text is resolved from the live sheet row and fingerprint-checked', async () => {
  const question = 'What are the high-risk features of IPMN?';
  const answer = 'Obstructive jaundice, mural nodule, or main pancreatic duct dilation.';
  const questionHash = await cardFingerprint({ question, answer });
  const rows = [['Question', 'Answer'], ['Other', 'Other answer'], [question, answer]];
  const matched = await resolveMemoryImageCardText(asset({ question_hash: questionHash }), rows);
  assert.deepEqual(matched, { matches: true, missing: false, question, answer });

  const changedRows = [['Question', 'Answer'], ['Other', 'Other answer'], ['Different question', answer]];
  const stale = await resolveMemoryImageCardText(asset({ question_hash: questionHash }), changedRows);
  assert.equal(stale.matches, false);
  assert.equal(stale.missing, false);
  assert.equal(stale.question, '');
  assert.equal(stale.answer, '');
});

test('Review Images filters by deck and starts image-first with question and answer hidden', () => {
  const assets = [
    asset({ id: 'one', saved_source_id: 'deck-1', source_row: 10 }),
    asset({ id: 'two', saved_source_id: 'deck-2', source_row: 11, image_hash: 'c'.repeat(64), storage_path: `user-1/${'c'.repeat(64)}.webp` })
  ];
  assert.equal(filterMemoryImagesBySource(assets, 'deck-1').length, 1);
  const model = reviewImageModel({ assets, savedSourceId: 'deck-1' });
  assert.equal(model.total, 1);
  assert.equal(model.current.id, 'one');
  assert.equal(model.showQuestion, false);
  assert.equal(model.showAnswer, false);
  const revealed = reviewImageModel({ assets, savedSourceId: '', index: 1, revealQuestion: true, revealAnswer: true });
  assert.equal(revealed.current.id, 'two');
  assert.equal(revealed.canPrevious, true);
  assert.equal(revealed.canNext, false);
  assert.equal(revealed.showQuestion, true);
  assert.equal(revealed.showAnswer, true);
});

test('memory image UI is isolated to the normal app, lazy behind answer reveal, and fetches source text on demand', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../memory-image-ui.js', import.meta.url), 'utf8');
  const car = readFileSync(new URL('../car/index.html', import.meta.url), 'utf8');
  assert.match(app, /setupMemoryImageUI\(state\)/);
  assert.match(ui, /!answerCard\.hidden/);
  assert.match(ui, /Review images/);
  assert.match(ui, /Show question/);
  assert.match(ui, /Show answer/);
  assert.match(ui, /reconstructSavedSourceRequest/);
  assert.match(ui, /Loading the current source row/);
  assert.match(ui, /Do not upload patient data/);
  assert.doesNotMatch(car, /memory-image-ui\.js/);
});

test('Supabase migration keeps images private, content-free, least-privilege, and capped at 1 MB', () => {
  const migration = readFileSync(new URL('../supabase/migrations/202610020001_memory_images.sql', import.meta.url), 'utf8');
  assert.match(migration, /memory_image_assets/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.memory_image_assets from anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.memory_image_assets to authenticated/i);
  assert.match(migration, /question_column integer not null/);
  assert.match(migration, /answer_column integer not null/);
  assert.doesNotMatch(migration, /question_text/);
  assert.doesNotMatch(migration, /answer_text/);
  assert.match(migration, /memory_image_assets_saved_source_id_idx/);
  assert.match(migration, /'memory-images',\s*'memory-images',\s*false,/s);
  assert.match(migration, /1048576/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.match(migration, /memory_image_assets_hash_idx/);
});

test('service worker precaches the memory-image modules without breaking the v17 validation contract', () => {
  const worker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /same3le-v17-memory-images-review/);
  assert.match(worker, /\.\/memory-images\.js/);
  assert.match(worker, /\.\/memory-image-ui\.js/);
});
