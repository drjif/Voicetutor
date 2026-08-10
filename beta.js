import { elements, setPasteStatus, setSessionStatus, setSheetStatus, state, updateControls } from './dom.js';

const ACCOUNT_KEY = 'samme3le.betaAccount.v1';
const METRICS_KEY = 'samme3le.prototypeMetrics.v1';
const VISIT_KEY = 'samme3le.prototypeVisit.v1';
const SESSION_VISIT_KEY = 'samme3le.visitRecorded';
const LEGACY_KEYS = [
  ['gijadTutor.betaAccount.v1', ACCOUNT_KEY],
  ['gijadTutor.prototypeMetrics.v1', METRICS_KEY],
  ['gijadTutor.prototypeVisit.v1', VISIT_KEY]
];
const MAX_EVENTS = 100;

function migrateLegacyStorage() {
  LEGACY_KEYS.forEach(([legacyKey, currentKey]) => {
    if (localStorage.getItem(currentKey) === null && localStorage.getItem(legacyKey) !== null) {
      localStorage.setItem(currentKey, localStorage.getItem(legacyKey));
    }
  });
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getBetaAccount() {
  return readJson(ACCOUNT_KEY, null);
}

export function hasBetaAccess() {
  return Boolean(getBetaAccount()?.email);
}

export function recordMetric(name, details = {}) {
  const events = readJson(METRICS_KEY, []);
  events.push({
    name,
    at: new Date().toISOString(),
    sourceType: state.sourceType,
    sourceKind: state.sourceKind,
    ...details
  });
  writeJson(METRICS_KEY, events.slice(-MAX_EVENTS));
}

function recordVisit() {
  if (sessionStorage.getItem(SESSION_VISIT_KEY)) return;
  sessionStorage.setItem(SESSION_VISIT_KEY, '1');

  const now = Date.now();
  const prior = readJson(VISIT_KEY, null);
  if (prior?.lastVisitAt) {
    const elapsed = now - prior.lastVisitAt;
    if (elapsed > 30 * 60 * 1000 && elapsed <= 7 * 24 * 60 * 60 * 1000) {
      recordMetric('returned_within_7_days', { elapsedHours: Math.round(elapsed / 3600000) });
    }
  }

  writeJson(VISIT_KEY, {
    firstVisitAt: prior?.firstVisitAt || now,
    lastVisitAt: now
  });
  recordMetric('visit');
}

function resetLoadedContent() {
  state.generation += 1;
  state.rawRows = [];
  state.currentDeck = null;
  state.questions = [];
  state.currentIndex = 0;
  state.sourceType = 'none';
  state.sourceKind = 'none';
  state.completedQuestionCount = 0;
  state.tenQuestionMilestoneRecorded = false;
  window.speechSynthesis?.cancel?.();
  elements.mappingPanel.hidden = true;
  elements.sessionPanel.hidden = true;
  elements.conversionCard.hidden = true;
  elements.startRow.innerHTML = '<option>Load questions first</option>';
  elements.startRow.disabled = true;
  setPasteStatus('Paste questions above to study without an account.', 'neutral');
  setSheetStatus('No Google Sheet or CSV loaded.', 'neutral');
  setSessionStatus('idle', 'Ready');
  updateControls();
}

function renderAccessState() {
  const account = getBetaAccount();
  const active = Boolean(account?.email);
  elements.betaSignupPanel.hidden = active;
  elements.betaMemberPanel.hidden = !active;
  elements.personalBankControls.disabled = !active;
  elements.personalBankLock.hidden = active;
  if (active) elements.betaMemberEmail.textContent = account.email;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function requireBetaAccess() {
  if (hasBetaAccess()) return true;
  elements.betaSignupStatus.textContent = 'Enter your email to unlock Google Sheet and CSV import. Pasting questions above does not require an account.';
  elements.betaSignupStatus.dataset.type = 'error';
  elements.betaSignupPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  elements.betaEmail.focus();
  return false;
}

export function setupBetaFunnel() {
  migrateLegacyStorage();
  recordVisit();
  renderAccessState();

  elements.betaSignupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = elements.betaEmail.value.trim().toLowerCase();
    if (!isValidEmail(email)) {
      elements.betaSignupStatus.textContent = 'Enter a valid email address.';
      elements.betaSignupStatus.dataset.type = 'error';
      elements.betaEmail.focus();
      return;
    }
    if (!elements.betaConsent.checked) {
      elements.betaSignupStatus.textContent = 'Confirm that you understand access is saved only on this device.';
      elements.betaSignupStatus.dataset.type = 'error';
      elements.betaConsent.focus();
      return;
    }

    writeJson(ACCOUNT_KEY, {
      email,
      createdAt: new Date().toISOString(),
      accountType: 'samme3le-local-prototype'
    });
    recordMetric('beta_account_created');
    renderAccessState();
    elements.betaSignupForm.reset();
    elements.personalBankControls.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  elements.signOutButton.addEventListener('click', () => {
    localStorage.removeItem(ACCOUNT_KEY);
    recordMetric('local_beta_access_removed');
    resetLoadedContent();
    renderAccessState();
  });

  elements.wouldPayButton.addEventListener('click', () => {
    recordMetric('would_pay_for_pro');
    elements.wouldPayButton.disabled = true;
    elements.notNowButton.disabled = true;
    elements.conversionStatus.textContent = 'Thank you. Your answer was recorded on this device for prototype testing.';
    elements.conversionStatus.dataset.type = 'success';
  });

  elements.notNowButton.addEventListener('click', () => {
    recordMetric('not_ready_to_pay');
    elements.wouldPayButton.disabled = true;
    elements.notNowButton.disabled = true;
    elements.conversionStatus.textContent = 'Thank you. Your answer was recorded on this device for prototype testing.';
    elements.conversionStatus.dataset.type = 'neutral';
  });

  window.samme3lePrototypeMetrics = () => readJson(METRICS_KEY, []);
  window.gijadTutorPrototypeMetrics = window.samme3lePrototypeMetrics;
}

export function noteSourceLoaded(sourceType, questionCount) {
  state.sourceType = sourceType;
  state.completedQuestionCount = 0;
  state.tenQuestionMilestoneRecorded = false;
  elements.conversionCard.hidden = true;
  elements.wouldPayButton.disabled = false;
  elements.notNowButton.disabled = false;
  elements.conversionStatus.textContent = 'This only measures interest. No payment will be collected.';
  elements.conversionStatus.dataset.type = 'neutral';

  if (sourceType === 'demo') {
    recordMetric('demo_loaded', { questionCount });
  } else {
    recordMetric('personal_question_bank_loaded', { questionCount });
  }
}

export function noteSessionStarted() {
  state.completedQuestionCount = 0;
  state.tenQuestionMilestoneRecorded = false;
  recordMetric(state.sourceType === 'demo' ? 'demo_started' : 'personal_session_started', {
    questionCount: state.questions.length
  });
}

export function noteQuestionCompleted() {
  state.completedQuestionCount += 1;
  if (state.sourceType === 'personal'
      && state.completedQuestionCount >= 10
      && !state.tenQuestionMilestoneRecorded) {
    state.tenQuestionMilestoneRecorded = true;
    recordMetric('completed_10_questions');
  }
}

export function noteSessionCompleted() {
  if (state.sourceType === 'demo') {
    const target = Math.min(5, state.questions.length);
    if (state.completedQuestionCount >= target) {
      recordMetric('demo_completed', { completedQuestions: state.completedQuestionCount });
    }
  } else {
    recordMetric('personal_session_completed', { completedQuestions: state.completedQuestionCount });
  }
  elements.conversionCard.hidden = false;
  elements.conversionCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
