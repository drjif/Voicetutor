// One-tap handoff from same3le's free tool pages into the study app.
//
// A tool page (e.g. /quizlet-to-anki/) stores the cards in this tab's sessionStorage and
// navigates to the homepage. This module, loaded on the homepage AFTER app.js, puts the
// cards in the existing paste box and presses the existing "Use these questions" button,
// so the app loads them through exactly the same code path as a manual paste.
//
// Privacy: the cards never leave the browser, live only in this tab, expire after
// HANDOFF_TTL_MS, and are deleted as soon as they are read.

export const HANDOFF_KEY = 'same3le.handoff.v1';
export const HANDOFF_TTL_MS = 15 * 60 * 1000;
export const HANDOFF_MAX_CHARS = 2_000_000;

export function createHandoff(text, source, now = Date.now()) {
  const value = String(text ?? '');
  if (!value.trim()) throw new Error('Nothing to hand off.');
  if (value.length > HANDOFF_MAX_CHARS) throw new Error('Too many cards to hand off in one go.');
  return JSON.stringify({ v: 1, source: String(source ?? ''), created: now, text: value });
}

/** Returns { text, source } for a valid, fresh handoff, otherwise null. */
export function readHandoff(raw, now = Date.now()) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || typeof data.text !== 'string' || !data.text.trim()) return null;
  if (typeof data.created !== 'number' || now - data.created > HANDOFF_TTL_MS || data.created - now > 60_000) return null;
  if (data.text.length > HANDOFF_MAX_CHARS) return null;
  return { text: data.text, source: typeof data.source === 'string' ? data.source : '' };
}

/** Used by tool pages. Returns true when the cards were stored for the next page. */
export function storeHandoff(text, source) {
  try {
    window.sessionStorage.setItem(HANDOFF_KEY, createHandoff(text, source));
    return true;
  } catch {
    return false;
  }
}

function takeHandoff() {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    if (raw !== null) window.sessionStorage.removeItem(HANDOFF_KEY);
    return readHandoff(raw);
  } catch {
    return null;
  }
}

function applyHandoff() {
  const textarea = document.querySelector('#pasteQuestions');
  const loadButton = document.querySelector('#loadPaste');
  if (!textarea || !loadButton) return;
  const handoff = takeHandoff();
  if (!handoff) return;

  textarea.value = handoff.text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  loadButton.click();

  try {
    if (typeof window.gtag === 'function') window.gtag('event', 'tool_handoff_loaded', { source: handoff.source });
  } catch { /* analytics must never block studying */ }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyHandoff, { once: true });
  } else {
    applyHandoff();
  }
}
