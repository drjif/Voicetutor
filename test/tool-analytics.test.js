import test from 'node:test';
import assert from 'node:assert/strict';
import { toolEventParams, trackToolEvent, TOOL_EVENTS } from '../tool-analytics.js';

test('keeps only allowlisted parameters and buckets card counts like the app', () => {
  const params = toolEventParams('quizlet-to-anki', {
    method: 'drop',
    format: 'csv',
    result: 'success',
    question_count: 37,
    term: 'secret card text',
    file_name: 'my notes.txt'
  });
  assert.deepEqual(params, {
    tool: 'quizlet-to-anki',
    method: 'drop',
    format: 'csv',
    result: 'success',
    question_count_bucket: '26-50'
  });
});

test('rejects unknown values and malformed tool names', () => {
  assert.deepEqual(toolEventParams('Quizlet To Anki!', { method: 'email', format: 'pdf', question_count: 0 }), {});
});

test('sends known events to gtag and refuses unknown ones', () => {
  const calls = [];
  globalThis.window = { gtag: (...args) => calls.push(args) };
  try {
    assert.equal(trackToolEvent('tool_converted', 'quizlet-to-anki', { question_count: 3 }), true);
    assert.deepEqual(calls[0], ['event', 'tool_converted', { tool: 'quizlet-to-anki', question_count_bucket: '1-5' }]);
    assert.equal(trackToolEvent('card_text_leak', 'quizlet-to-anki', {}), false);
    assert.equal(calls.length, 1);
  } finally {
    delete globalThis.window;
  }
});

test('onSent is passed to GA as a callback, and runs immediately when GA is missing', () => {
  const calls = [];
  let sent = 0;
  globalThis.window = { gtag: (...args) => calls.push(args) };
  try {
    trackToolEvent('tool_study_clicked', 'quizlet-to-anki', { method: 'handoff' }, () => { sent += 1; });
    const payload = calls[0][2];
    assert.equal(typeof payload.event_callback, 'function');
    assert.equal(payload.transport_type, 'beacon');
    payload.event_callback();
    assert.equal(sent, 1);
  } finally {
    delete globalThis.window;
  }
  trackToolEvent('tool_study_clicked', 'quizlet-to-anki', {}, () => { sent += 1; });
  assert.equal(sent, 2, 'no window/gtag: callback still runs so navigation never hangs');
});

test('every funnel event name fits GA4 limits', () => {
  for (const name of TOOL_EVENTS) {
    assert.match(name, /^[a-z][a-z0-9_]{0,39}$/);
  }
});
