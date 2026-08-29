import {
  AUTH_STATUS,
  createPendingConsent,
  describeAuthError,
  isValidEmail,
  requiredLegalAccepted
} from './auth-state.js';
import {
  AUTH_SITE_URL,
  LEGAL_POLICY_VERSIONS,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  getAuthRedirectUrl,
  isSupabaseConfigured
} from './supabase-config.js';

const PENDING_CONSENT_KEY = 'samme3le.pendingConsent.v1';
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
const SUPABASE_CLIENT_OPTIONS = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'samme3le.supabase.auth.v1'
  }
};

let client = null;
let lastUser = null;
const listeners = new Set();

function readJson(key, fallback = null) {
  try {
    if (typeof sessionStorage === 'undefined') return fallback;
    return JSON.parse(sessionStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota / private-mode failures. Auth can still proceed.
  }
}

function notify(snapshot) {
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('Auth listener failed', error);
    }
  });
}

export function getSupabaseClient() {
  return client;
}

export async function loadSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  try {
    const { createClient } = await import(SUPABASE_ESM);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CLIENT_OPTIONS);
    return client;
  } catch (error) {
    console.warn('Supabase client failed to load', error);
    client = null;
    return null;
  }
}

export function onAuthChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentUser() {
  return lastUser;
}

export function isSignedIn() {
  return Boolean(lastUser?.id);
}

function snapshotFor(status, extras = {}) {
  return {
    configured: isSupabaseConfigured(),
    status,
    user: lastUser,
    email: lastUser?.email || extras.email || '',
    ...extras
  };
}

async function persistPendingConsent(user) {
  const pending = readJson(PENDING_CONSENT_KEY, null);
  if (!pending || !user?.id) return;
  const supabase = await loadSupabaseClient();
  if (!supabase) return;
  try {
    const { error } = await supabase.from('consent_records').insert({
      user_id: user.id,
      terms_version: pending.terms_version,
      privacy_version: pending.privacy_version,
      acceptable_use_version: pending.acceptable_use_version,
      age_18_confirmed: pending.age_18_confirmed,
      us_access_confirmed: pending.us_access_confirmed,
      marketing_consent: pending.marketing_consent,
      accepted_at: pending.accepted_at,
      client_context: pending.client_context ?? { source: 'account-sync-v1' }
    });
    if (error) throw error;
    if (typeof pending.marketing_consent === 'boolean') {
      await supabase.from('marketing_preferences').upsert({
        user_id: user.id,
        subscribed: pending.marketing_consent,
        source: 'account'
      });
    }
    sessionStorage.removeItem(PENDING_CONSENT_KEY);
  } catch (error) {
    console.warn('Consent record was not saved', error);
  }
}

function callbackErrorFromLocation(locationLike = globalThis.location) {
  try {
    const search = new URLSearchParams(locationLike?.search || '');
    const hash = new URLSearchParams(String(locationLike?.hash || '').replace(/^#/, ''));
    const error = search.get('error') || hash.get('error');
    const description = search.get('error_description') || hash.get('error_description') || error;
    if (!error && !description) return null;
    return describeAuthError(description || error);
  } catch {
    return null;
  }
}

function hasAuthCallbackParams(locationLike = globalThis.location) {
  const search = `${locationLike?.search || ''}${locationLike?.hash || ''}`;
  return /[?&#](code|access_token|refresh_token|error|error_description|type)=/.test(search);
}

function cleanAuthParamsFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    ['code', 'error', 'error_description', 'state'].forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
  } catch {
    // Ignore URL cleanup failures.
  }
}

export async function initializeAuth() {
  if (!isSupabaseConfigured()) {
    const snapshot = snapshotFor(AUTH_STATUS.unavailable);
    notify(snapshot);
    return snapshot;
  }

  const callbackError = callbackErrorFromLocation();
  if (callbackError) {
    cleanAuthParamsFromUrl();
    const snapshot = snapshotFor(AUTH_STATUS.expired, { error: true, message: callbackError, messageType: 'error' });
    notify(snapshot);
    return snapshot;
  }

  if (hasAuthCallbackParams()) {
    notify(snapshotFor(AUTH_STATUS.callback, { message: 'Finishing sign-in…', messageType: 'loading' }));
  }

  try {
    const supabase = await loadSupabaseClient();
    if (!supabase) throw new Error('Failed to fetch');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    lastUser = data?.session?.user ?? null;
    if (lastUser) await persistPendingConsent(lastUser);
    cleanAuthParamsFromUrl();
    const snapshot = snapshotFor(lastUser ? AUTH_STATUS.signedIn : AUTH_STATUS.signedOut);
    notify(snapshot);

    supabase.auth.onAuthStateChange(async (event, session) => {
      lastUser = session?.user ?? null;
      if (lastUser && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION')) {
        await persistPendingConsent(lastUser);
      }
      notify(snapshotFor(lastUser ? AUTH_STATUS.signedIn : AUTH_STATUS.signedOut));
    });

    return snapshot;
  } catch (error) {
    console.warn('Supabase auth is unavailable', error);
    const snapshot = snapshotFor(AUTH_STATUS.unavailable, {
      error: true,
      message: describeAuthError(error),
      messageType: 'warning'
    });
    notify(snapshot);
    return snapshot;
  }
}

export async function requestEmailSignIn(input = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Account sync is not configured yet.');
  }
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
  if (!requiredLegalAccepted(input)) {
    throw new Error('Accept the Terms, Privacy Policy, and Acceptable Use Policy, and confirm you are at least 18 and accessing from the U.S.');
  }

  const pending = createPendingConsent(input, LEGAL_POLICY_VERSIONS);
  writeJson(PENDING_CONSENT_KEY, pending);
  notify(snapshotFor(AUTH_STATUS.sending, { email, message: 'Sending a sign-in email…', messageType: 'loading' }));

  const supabase = await loadSupabaseClient();
  if (!supabase) {
    const message = describeAuthError({ message: 'Failed to fetch' });
    notify(snapshotFor(AUTH_STATUS.unavailable, { email, error: true, message, messageType: 'warning' }));
    throw new Error(message);
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
      shouldCreateUser: true
    }
  });
  if (error) {
    notify(snapshotFor(AUTH_STATUS.signedOut, { email, error: true, message: describeAuthError(error), messageType: 'error' }));
    throw new Error(describeAuthError(error));
  }

  const snapshot = snapshotFor(AUTH_STATUS.codeSent, {
    email,
    message: `If an account can be created, we sent a sign-in email to ${email}. Enter the code or open the link on this device.`,
    messageType: 'success'
  });
  notify(snapshot);
  return snapshot;
}

export async function verifyEmailCode(email, token) {
  if (!isSupabaseConfigured()) throw new Error('Account sync is not configured yet.');
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const code = String(token ?? '').trim();
  if (!isValidEmail(normalizedEmail) || !code) throw new Error('Enter the email and one-time code from your message.');

  notify(snapshotFor(AUTH_STATUS.callback, { email: normalizedEmail, message: 'Checking that code…', messageType: 'loading' }));
  const supabase = await loadSupabaseClient();
  if (!supabase) throw new Error(describeAuthError({ message: 'Failed to fetch' }));
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizedEmail,
    token: code,
    type: 'email'
  });
  if (error) {
    const message = describeAuthError(error);
    const expired = /expired/i.test(message);
    notify(snapshotFor(expired ? AUTH_STATUS.expired : AUTH_STATUS.codeSent, {
      email: normalizedEmail,
      error: true,
      message,
      messageType: 'error'
    }));
    throw new Error(message);
  }
  lastUser = data?.user ?? data?.session?.user ?? lastUser;
  if (lastUser) await persistPendingConsent(lastUser);
  const snapshot = snapshotFor(AUTH_STATUS.signedIn);
  notify(snapshot);
  return snapshot;
}

export async function signOutAccount() {
  const supabase = client || await loadSupabaseClient();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn('Sign-out request failed', error);
    }
  }
  lastUser = null;
  const snapshot = snapshotFor(isSupabaseConfigured() ? AUTH_STATUS.signedOut : AUTH_STATUS.unavailable);
  notify(snapshot);
  return snapshot;
}

export function productionAuthDashboardNotes() {
  return [
    `Site URL: ${AUTH_SITE_URL}`,
    `Redirect URL: ${AUTH_SITE_URL}/`,
    'Also allow http://localhost:4173/ for local testing',
    'Enable email OTP / magic link. Do not require a password for v1.',
    'Custom SMTP is required before public signup; Supabase built-in email is not a production mailer.'
  ];
}
