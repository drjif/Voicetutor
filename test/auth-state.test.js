import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_STATUS,
  accountViewModel,
  createPendingConsent,
  describeAuthError,
  formatLastOpened,
  isValidEmail,
  requiredLegalAccepted
} from '../auth-state.js';
import {
  AUTH_SITE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  getAuthRedirectUrl,
  isSupabaseConfigured
} from '../supabase-config.js';

test('unsigned users see sign-in, not My decks or save-to-account', () => {
  const view = accountViewModel({ status: AUTH_STATUS.signedOut, configured: true });
  assert.equal(view.signedIn, false);
  assert.equal(view.showSignInForm, true);
  assert.equal(view.showMyDecks, false);
  assert.equal(view.canSaveToAccount, false);
  assert.equal(view.promptSignInToSave, true);
  assert.equal(view.headerLabel, 'Sign in');
});

test('signed-in users see My decks and can save a Google Sheet', () => {
  const view = accountViewModel({
    status: AUTH_STATUS.signedIn,
    configured: true,
    email: 'student@example.com'
  });
  assert.equal(view.showSignedIn, true);
  assert.equal(view.showMyDecks, true);
  assert.equal(view.canSaveToAccount, true);
  assert.equal(view.promptSignInToSave, false);
  assert.equal(view.headerLabel, 'student@example.com');
});

test('code-sent and expired states keep studying available', () => {
  const sent = accountViewModel({ status: AUTH_STATUS.codeSent, configured: true, email: 'student@example.com' });
  assert.equal(sent.showCodeForm, true);
  assert.equal(sent.showMyDecks, false);

  const expired = accountViewModel({ status: AUTH_STATUS.expired, configured: true, error: true });
  assert.equal(expired.statusType, 'error');
  assert.match(expired.statusMessage, /expired/i);
});

test('unconfigured or unavailable supabase never blocks anonymous study UI', () => {
  const view = accountViewModel({ status: AUTH_STATUS.unavailable, configured: false });
  assert.equal(view.unavailable, true);
  assert.equal(view.showSignInForm, false);
  assert.equal(view.showMyDecks, false);
  assert.match(view.statusMessage, /still work/i);
});

test('legal acceptance is required and marketing stays optional', () => {
  assert.equal(requiredLegalAccepted({}), false);
  assert.equal(requiredLegalAccepted({ legalAccepted: true, age18Confirmed: true, usAccessConfirmed: true }), true);
  const consent = createPendingConsent(
    { legalAccepted: true, age18Confirmed: true, usAccessConfirmed: true, marketingConsent: false },
    { terms: '2026-08-01', privacy: '2026-08-15', acceptableUse: '2026-08-01' }
  );
  assert.equal(consent.marketing_consent, false);
  assert.equal(consent.terms_version, '2026-08-01');
  assert.throws(
    () => createPendingConsent({ legalAccepted: true, age18Confirmed: true, usAccessConfirmed: true, marketingRequired: true }),
    /Marketing consent cannot be required/
  );
});

test('email validation and auth error copy', () => {
  assert.equal(isValidEmail('student@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.match(describeAuthError({ message: 'Token has expired or is invalid' }), /expired/i);
  assert.match(describeAuthError({ message: 'Failed to fetch' }), /unavailable/i);
});

test('last-opened labels stay human-readable without exposing URLs', () => {
  assert.equal(formatLastOpened(null), '');
  assert.equal(formatLastOpened('2026-08-29T00:00:00.000Z', Date.parse('2026-08-29T00:00:30.000Z')), 'Opened just now');
  assert.match(formatLastOpened('2026-08-20T00:00:00.000Z', Date.parse('2026-08-29T00:00:00.000Z')), /Opened /);
});

test('auth redirect stays on the current production hostname', () => {
  assert.equal(AUTH_SITE_URL, 'https://same3le.com');
  assert.equal(getAuthRedirectUrl({ origin: 'https://same3le.com' }), 'https://same3le.com/');
  assert.equal(getAuthRedirectUrl({ origin: 'http://localhost:4173' }), 'http://localhost:4173/');
  assert.equal(isSupabaseConfigured('', ''), false);
  assert.equal(isSupabaseConfigured('https://example.supabase.co', 'short'), false);
});

test('frontend is configured for the same3le project with an anon key', () => {
  assert.equal(isSupabaseConfigured(), true);
  assert.equal(SUPABASE_URL, 'https://yleyerkmqeozlfuaqbmj.supabase.co');
  const payload = JSON.parse(Buffer.from(SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.role, 'anon');
  assert.equal(payload.ref, 'yleyerkmqeozlfuaqbmj');
});
