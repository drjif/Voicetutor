import { elements, state } from './dom.js';

const METRICS_KEY = 'samme3le.prototypeMetrics.v1';
const VISIT_KEY = 'samme3le.prototypeVisit.v1';
const SESSION_VISIT_KEY = 'samme3le.visitRecorded';
const LEGACY_ACCOUNT_KEYS = ['samme3le.betaAccount.v1', 'gijadTutor.betaAccount.v1'];
const LEGACY_KEYS = [
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

export function setupBetaFunnel() {
  migrateLegacyStorage();
  LEGACY_ACCOUNT_KEYS.forEach((key) => localStorage.removeItem(key));
  recordVisit();

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
