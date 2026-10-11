import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandoff, readHandoff, HANDOFF_TTL_MS, HANDOFF_MAX_CHARS } from '../handoff.js';

const NOW = 1_800_000_000_000;

test('round-trips a fresh handoff', () => {
  const raw = createHandoff('Q: a\nA: b', 'quizlet-to-anki', NOW);
  assert.deepEqual(readHandoff(raw, NOW + 1000), { text: 'Q: a\nA: b', source: 'quizlet-to-anki' });
});

test('ignores expired, future-dated, malformed and empty payloads', () => {
  const raw = createHandoff('Q: a\nA: b', 'x', NOW);
  assert.equal(readHandoff(raw, NOW + HANDOFF_TTL_MS + 1), null);
  assert.equal(readHandoff(createHandoff('Q: a\nA: b', 'x', NOW + 5 * 60_000), NOW), null);
  assert.equal(readHandoff('not json', NOW), null);
  assert.equal(readHandoff(null, NOW), null);
  assert.equal(readHandoff(JSON.stringify({ v: 2, created: NOW, text: 'x' }), NOW), null);
  assert.equal(readHandoff(JSON.stringify({ v: 1, created: NOW, text: '   ' }), NOW), null);
  assert.equal(readHandoff(JSON.stringify({ v: 1, created: 'yesterday', text: 'x' }), NOW), null);
});

test('refuses to create empty or oversized handoffs', () => {
  assert.throws(() => createHandoff('  ', 'x', NOW));
  assert.throws(() => createHandoff('x'.repeat(HANDOFF_MAX_CHARS + 1), 'x', NOW));
});

test('the homepage loads the handoff after the app', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = html.indexOf('src="./app.js"');
  const handoff = html.indexOf('src="./handoff.js"');
  assert.ok(app > 0 && handoff > app, 'handoff.js must be a module script after app.js');
});
