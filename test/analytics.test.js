import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  analyticsSourceType,
  questionCountBucket,
  trackAnalyticsEvent
} from '../analytics.js';

const ROOT = process.cwd();
const MEASUREMENT_ID = 'G-8FVETBN9N5';
const productionHtmlPages = [
  'index.html',
  'about/index.html',
  'acceptable-use/index.html',
  'accessibility/index.html',
  'active-recall-out-loud/index.html',
  'billing-and-cancellation/index.html',
  'contact/index.html',
  'google-sheets-flashcards/index.html',
  'medical-disclaimer/index.html',
  'medical-students/index.html',
  'pricing/index.html',
  'privacy/index.html',
  'quiz-me-from-my-notes/index.html',
  'terms/index.html',
  'voice-flashcards/index.html'
];

const requestedEvents = [
  'demo_started',
  'paste_deck_loaded',
  'file_deck_loaded',
  'google_sheet_loaded',
  'study_session_started',
  'five_questions_completed',
  'ten_questions_completed',
  'study_session_completed',
  'account_created',
  'deck_saved'
];

test('question counts are reduced to coarse buckets', () => {
  assert.equal(questionCountBucket(1), '1-5');
  assert.equal(questionCountBucket(5), '1-5');
  assert.equal(questionCountBucket(6), '6-10');
  assert.equal(questionCountBucket(25), '11-25');
  assert.equal(questionCountBucket(100), '51-100');
  assert.equal(questionCountBucket(625), '501+');
  assert.equal(questionCountBucket(0), undefined);
});

test('source kinds are reduced to coarse source categories', () => {
  assert.equal(analyticsSourceType('demo'), 'demo');
  assert.equal(analyticsSourceType('paste'), 'paste');
  assert.equal(analyticsSourceType('google-sheet'), 'google_sheet');
  assert.equal(analyticsSourceType('csv'), 'file');
  assert.equal(analyticsSourceType('xlsx'), 'file');
  assert.equal(analyticsSourceType('anki'), 'file');
  assert.equal(analyticsSourceType('local-txt'), 'file');
  assert.equal(analyticsSourceType('unknown'), undefined);
});

test('GA event wrapper drops user content and identifiers', () => {
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    gtag: (...args) => calls.push(args)
  };

  try {
    const sent = trackAnalyticsEvent('study_session_started', {
      study_mode: 'active',
      source_type: 'google_sheet',
      question_count: 625,
      question: 'sensitive question',
      answer: 'sensitive answer',
      transcript: 'spoken response',
      filename: 'private-file.csv',
      google_sheet_url: 'https://docs.google.com/private',
      spreadsheet_id: 'secret-sheet-id',
      email: 'person@example.com',
      user_id: 'user-123',
      supabase_id: 'supabase-123',
      deck_name: 'private deck'
    });

    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
      'event',
      'study_session_started',
      {
        study_mode: 'active',
        source_type: 'google_sheet',
        question_count_bucket: '501+'
      }
    ]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('GA event wrapper rejects events outside the explicit allowlist', () => {
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = { gtag: (...args) => calls.push(args) };
  try {
    assert.equal(trackAnalyticsEvent('question_viewed', { question: 'do not send me' }), false);
    assert.equal(calls.length, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('all requested custom event names are implemented', async () => {
  const sources = await Promise.all([
    fs.readFile(path.join(ROOT, 'analytics.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'beta.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'auth.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'saved-sources.js'), 'utf8')
  ]);
  const combined = sources.join('\n');
  for (const eventName of requestedEvents) {
    assert.match(combined, new RegExp(`['\"]${eventName}['\"]`), `missing ${eventName}`);
  }
});

test('every production HTML page has the privacy-safe GA4 tag immediately after head', async () => {
  for (const relativePath of productionHtmlPages) {
    const html = await fs.readFile(path.join(ROOT, relativePath), 'utf8');
    assert.match(
      html,
      new RegExp(`<head>\\s*<!-- Google tag \\(gtag\\.js\\) -->\\s*<script async src="https://www\\.googletagmanager\\.com/gtag/js\\?id=${MEASUREMENT_ID}"`),
      `${relativePath} is missing the Google tag immediately after <head>`
    );
    assert.match(html, new RegExp(`gtag\\('config', '${MEASUREMENT_ID}'`), `${relativePath} missing GA4 config`);
    assert.match(html, /send_page_view:\s*false/, `${relativePath} must suppress automatic full-URL page views`);
    assert.match(html, /allow_google_signals:\s*false/, `${relativePath} must keep Google Signals disabled`);
    assert.match(html, /allow_ad_personalization_signals:\s*false/, `${relativePath} must keep ad personalization disabled`);
    assert.match(html, /window\.location\.origin\s*\+\s*window\.location\.pathname/, `${relativePath} must strip query and hash from page_location`);
  }
});

test('privacy policy discloses GA4 and exclusions', async () => {
  const privacy = await fs.readFile(path.join(ROOT, 'privacy/index.html'), 'utf8');
  assert.match(privacy, /Google Analytics 4/i);
  assert.match(privacy, /does not intentionally send question text, answer text, spoken responses, transcripts, filenames, Google Sheet URLs or identifiers, email addresses, account or Supabase user identifiers, or deck names to Google Analytics/i);
  assert.match(privacy, /without Google Signals/i);
  assert.match(privacy, /does not enable Google Ads or remarketing/i);
});
