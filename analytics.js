const ALLOWED_EVENTS = new Set([
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
]);

const STUDY_MODES = new Set(['active', 'passive', 'lockscreen']);
const SOURCE_TYPES = new Set(['demo', 'paste', 'file', 'google_sheet']);
const ACCOUNT_CREATED_SESSION_KEY = 'same3le.ga4.accountCreated.v1';

export function questionCountBucket(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (value <= 5) return '1-5';
  if (value <= 10) return '6-10';
  if (value <= 25) return '11-25';
  if (value <= 50) return '26-50';
  if (value <= 100) return '51-100';
  if (value <= 250) return '101-250';
  if (value <= 500) return '251-500';
  return '501+';
}

export function analyticsSourceType(sourceKind) {
  const value = String(sourceKind ?? '').toLowerCase();
  if (value === 'demo') return 'demo';
  if (value === 'paste') return 'paste';
  if (value === 'google-sheet') return 'google_sheet';
  if (value === 'csv'
      || value === 'xlsx'
      || value === 'anki'
      || value === 'anki-text'
      || value.startsWith('local-')) return 'file';
  return undefined;
}

function safeParams(params = {}) {
  const safe = {};
  if (STUDY_MODES.has(params.study_mode)) safe.study_mode = params.study_mode;
  if (SOURCE_TYPES.has(params.source_type)) safe.source_type = params.source_type;
  const bucket = questionCountBucket(params.question_count);
  const suppliedBucket = String(params.question_count_bucket ?? '');
  if (bucket) safe.question_count_bucket = bucket;
  else if (/^(1-5|6-10|11-25|26-50|51-100|101-250|251-500|501\+)$/.test(suppliedBucket)) {
    safe.question_count_bucket = suppliedBucket;
  }
  return safe;
}

export function trackAnalyticsEvent(name, params = {}) {
  if (!ALLOWED_EVENTS.has(name)) return false;
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return false;
  window.gtag('event', name, safeParams(params));
  return true;
}

export function maybeTrackAccountCreated(user) {
  if (!user?.created_at || typeof sessionStorage === 'undefined') return false;
  if (sessionStorage.getItem(ACCOUNT_CREATED_SESSION_KEY)) return false;

  const createdAt = Date.parse(user.created_at);
  if (!Number.isFinite(createdAt)) return false;
  const ageMs = Date.now() - createdAt;
  if (ageMs < -60_000 || ageMs > 10 * 60 * 1000) return false;

  sessionStorage.setItem(ACCOUNT_CREATED_SESSION_KEY, '1');
  return trackAnalyticsEvent('account_created');
}
