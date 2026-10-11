// Shared Google Analytics events for same3le's free tool pages.
//
// One event scheme for every tool, so a single GA4 funnel can compare them by the `tool`
// parameter. Like analytics.js, everything is allowlisted: no card text, file names or
// other user content can ever be sent.
//
// Funnel: tool_viewed → tool_converted → tool_study_clicked → tool_handoff_loaded
//         → study_session_started → five_questions_completed (the last two come from the app)

import { questionCountBucket } from './analytics.js';

export const TOOL_EVENTS = new Set([
  'tool_viewed',
  'tool_converted',
  'tool_example_used',
  'tool_file_opened',
  'tool_downloaded',
  'tool_study_clicked',
  'tool_handoff_loaded'
]);

const ALLOWED_VALUES = {
  method: new Set(['picker', 'drop', 'handoff', 'clipboard']),
  format: new Set(['anki_txt', 'csv', 'tsv', 'copy']),
  result: new Set(['success', 'error'])
};

export function toolEventParams(tool, params = {}) {
  const safe = {};
  if (typeof tool === 'string' && /^[a-z0-9-]{1,40}$/.test(tool)) safe.tool = tool;
  for (const [key, allowed] of Object.entries(ALLOWED_VALUES)) {
    if (allowed.has(params[key])) safe[key] = params[key];
  }
  const bucket = questionCountBucket(params.question_count);
  if (bucket) safe.question_count_bucket = bucket;
  return safe;
}

/**
 * Sends one allowlisted tool event. Returns true when it was handed to gtag.
 * `onSent` (optional) runs once GA has dispatched the hit — or immediately if GA isn't on
 * the page — so callers can navigate without losing the event.
 */
export function trackToolEvent(name, tool, params = {}, onSent) {
  const done = typeof onSent === 'function' ? onSent : null;
  try {
    if (!TOOL_EVENTS.has(name) || typeof window === 'undefined' || typeof window.gtag !== 'function') {
      done?.();
      return false;
    }
    const payload = toolEventParams(tool, params);
    if (done) {
      payload.event_callback = done;
      payload.event_timeout = 300;
      payload.transport_type = 'beacon';
    }
    window.gtag('event', name, payload);
    return true;
  } catch {
    done?.();
    return false;
  }
}

/**
 * Record that a tool page was opened. If analytics is on hold until the visitor answers the
 * consent banner (consent.js), the view is recorded again once they allow analytics, so
 * people who accept still enter the funnel at step 1.
 */
export function trackToolView(tool) {
  trackToolEvent('tool_viewed', tool);
  try {
    const consent = typeof window !== 'undefined' ? window.same3leConsent : null;
    if (consent && typeof consent.held === 'function' && consent.held()) {
      window.addEventListener('same3le:consent', (event) => {
        if (event?.detail?.analytics === 'granted') trackToolEvent('tool_viewed', tool);
      }, { once: true });
    }
  } catch { /* analytics must never break the tool */ }
}

/** Track an event, then go to `url` as soon as GA confirms it — never waiting more than `maxWaitMs`. */
export function trackThenNavigate(name, tool, params, url, maxWaitMs = 350) {
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    window.location.href = url;
  };
  trackToolEvent(name, tool, params, go);
  window.setTimeout(go, maxWaitMs);
}
