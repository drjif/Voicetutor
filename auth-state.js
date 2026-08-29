export const AUTH_STATUS = Object.freeze({
  unavailable: 'unavailable',
  signedOut: 'signed-out',
  sending: 'sending',
  codeSent: 'code-sent',
  callback: 'callback',
  expired: 'expired',
  signedIn: 'signed-in'
});

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

export function requiredLegalAccepted(input = {}) {
  return Boolean(input.legalAccepted) && Boolean(input.age18Confirmed) && Boolean(input.usAccessConfirmed);
}

export function createPendingConsent(input = {}, versions = {}) {
  if (!requiredLegalAccepted(input)) {
    throw new Error('Accept the required legal terms before creating an account.');
  }
  if (input.marketingRequired) {
    throw new Error('Marketing consent cannot be required for account creation.');
  }
  return {
    terms_version: versions.terms,
    privacy_version: versions.privacy,
    acceptable_use_version: versions.acceptableUse,
    age_18_confirmed: true,
    us_access_confirmed: true,
    marketing_consent: Boolean(input.marketingConsent),
    accepted_at: input.acceptedAt || new Date().toISOString(),
    client_context: { source: 'account-sync-v1' }
  };
}

export function describeAuthError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (!message) return 'Sign-in could not be completed.';
  if (message.includes('expired') || message.includes('otp_expired') || message.includes('token has expired')) {
    return 'That login link or code expired. Request a new one.';
  }
  if (message.includes('invalid') && (message.includes('otp') || message.includes('token') || message.includes('code'))) {
    return 'That login code is invalid. Request a new one.';
  }
  if (message.includes('rate') || message.includes('too many')) {
    return 'Too many sign-in attempts. Wait a moment and try again.';
  }
  if (message.includes('fetch') || message.includes('network') || message.includes('failed to fetch')) {
    return 'Account service is unavailable. You can still study in this browser.';
  }
  return error?.message || 'Sign-in could not be completed.';
}

export function accountViewModel(snapshot = {}) {
  const status = snapshot.status || AUTH_STATUS.signedOut;
  const configured = snapshot.configured !== false;
  const signedIn = status === AUTH_STATUS.signedIn && Boolean(snapshot.email);
  const unavailable = !configured || status === AUTH_STATUS.unavailable;

  return {
    status,
    configured,
    unavailable,
    signedIn,
    showSignInForm: configured && !unavailable && !signedIn && status !== AUTH_STATUS.codeSent && status !== AUTH_STATUS.callback,
    showCodeForm: status === AUTH_STATUS.codeSent || status === AUTH_STATUS.callback,
    showSignedIn: signedIn,
    showMyDecks: signedIn,
    canSaveToAccount: signedIn,
    promptSignInToSave: !signedIn,
    headerLabel: signedIn ? snapshot.email : 'Sign in',
    statusMessage: snapshot.message || defaultStatusMessage(status, unavailable),
    statusType: snapshot.messageType || defaultStatusType(status, unavailable, snapshot.error)
  };
}

function defaultStatusMessage(status, unavailable) {
  if (unavailable) return 'Account sync is unavailable. Paste, local files, demo, and Google Sheets still work in this browser.';
  if (status === AUTH_STATUS.sending) return 'Sending a sign-in email…';
  if (status === AUTH_STATUS.codeSent) return 'Check your email for a one-time code or sign-in link.';
  if (status === AUTH_STATUS.callback) return 'Finishing sign-in…';
  if (status === AUTH_STATUS.expired) return 'That login link or code expired. Request a new one.';
  if (status === AUTH_STATUS.signedIn) return 'Signed in. Saved Google Sheets appear under My decks.';
  return 'Sign in to reopen a Google Sheet on another phone or computer. Studying does not require an account.';
}

function defaultStatusType(status, unavailable, error) {
  if (error || status === AUTH_STATUS.expired) return 'error';
  if (unavailable) return 'warning';
  if (status === AUTH_STATUS.sending || status === AUTH_STATUS.callback) return 'loading';
  if (status === AUTH_STATUS.codeSent || status === AUTH_STATUS.signedIn) return 'success';
  return 'neutral';
}

export function formatLastOpened(value, now = Date.now()) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const delta = now - date.getTime();
  if (delta < 60 * 1000) return 'Opened just now';
  if (delta < 60 * 60 * 1000) return `Opened ${Math.floor(delta / 60000)} min ago`;
  if (delta < 24 * 60 * 60 * 1000) return `Opened ${Math.floor(delta / 3600000)} hr ago`;
  return `Opened ${date.toLocaleDateString()}`;
}
