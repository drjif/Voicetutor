export const STORAGE_KEY = 'samme3le.settings.v1';
export const PROGRESS_KEY = 'samme3le.progress.v1';
const LEGACY_STORAGE_KEY = 'voicetutor.settings.v1';
const LEGACY_PROGRESS_KEY = 'voicetutor.progress.v1';
let progressListener = null;

export function onProgressSaved(listener) {
  progressListener = listener;
}

function migrateLegacyStorage() {
  if (localStorage.getItem(STORAGE_KEY) === null && localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
    localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_STORAGE_KEY));
  }
  if (localStorage.getItem(PROGRESS_KEY) === null && localStorage.getItem(LEGACY_PROGRESS_KEY) !== null) {
    localStorage.setItem(PROGRESS_KEY, localStorage.getItem(LEGACY_PROGRESS_KEY));
  }
}

export const elements = {
  signInForm: document.querySelector('#signInForm'),
  signInPanel: document.querySelector('#signInPanel'),
  accountEmail: document.querySelector('#accountEmail'),
  accountStatus: document.querySelector('#accountStatus'),
  accountSignedInPanel: document.querySelector('#accountSignedInPanel'),
  accountEmailLabel: document.querySelector('#accountEmailLabel'),
  signOutButton: document.querySelector('#signOutButton'),
  personalBankControls: document.querySelector('#personalBankControls'),
  pasteQuestions: document.querySelector('#pasteQuestions'),
  loadPaste: document.querySelector('#loadPaste'),
  pasteStatus: document.querySelector('#pasteStatus'),
  sheetUrl: document.querySelector('#sheetUrl'),
  loadSheet: document.querySelector('#loadSheet'),
  loadDemo: document.querySelector('#loadDemo'),
  csvUpload: document.querySelector('#csvUpload'),
  hasHeaders: document.querySelector('#hasHeaders'),
  sheetStatus: document.querySelector('#sheetStatus'),
  mappingPanel: document.querySelector('#mappingPanel'),
  questionColumn: document.querySelector('#questionColumn'),
  answerColumn: document.querySelector('#answerColumn'),
  acceptedColumn: document.querySelector('#acceptedColumn'),
  applyMapping: document.querySelector('#applyMapping'),
  bankSummary: document.querySelector('#bankSummary'),
  startRow: document.querySelector('#startRow'),
  modeInputs: [...document.querySelectorAll('input[name="mode"]')],
  keepScreenAwake: document.querySelector('#keepScreenAwake'),
  wakeLockControl: document.querySelector('#wakeLockControl'),
  wakeLockStatus: document.querySelector('#wakeLockStatus'),
  startNote: document.querySelector('#startNote'),
  answerDelay: document.querySelector('#answerDelay'),
  delayValue: document.querySelector('#delayValue'),
  voiceSelect: document.querySelector('#voiceSelect'),
  speechRate: document.querySelector('#speechRate'),
  rateValue: document.querySelector('#rateValue'),
  strictness: document.querySelector('#strictness'),
  startButton: document.querySelector('#startButton'),
  pauseButton: document.querySelector('#pauseButton'),
  resumeButton: document.querySelector('#resumeButton'),
  repeatButton: document.querySelector('#repeatButton'),
  previousButton: document.querySelector('#previousButton'),
  nextButton: document.querySelector('#nextButton'),
  stopButton: document.querySelector('#stopButton'),
  sessionPanel: document.querySelector('#sessionPanel'),
  progressText: document.querySelector('#progressText'),
  progressBar: document.querySelector('#progressBar'),
  sourceRowBadge: document.querySelector('#sourceRowBadge'),
  statusBadge: document.querySelector('#statusBadge'),
  currentQuestion: document.querySelector('#currentQuestion'),
  currentAnswer: document.querySelector('#currentAnswer'),
  answerCard: document.querySelector('#answerCard'),
  transcriptCard: document.querySelector('#transcriptCard'),
  transcript: document.querySelector('#transcript'),
  matchResult: document.querySelector('#matchResult'),
  listeningIndicator: document.querySelector('#listeningIndicator'),
  reviewDecision: document.querySelector('#reviewDecision'),
  reviewMessage: document.querySelector('#reviewMessage'),
  tryAgainButton: document.querySelector('#tryAgainButton'),
  markCorrectButton: document.querySelector('#markCorrectButton'),
  continueButton: document.querySelector('#continueButton'),
  browserWarning: document.querySelector('#browserWarning'),
  installButton: document.querySelector('#installButton'),
  conversionCard: document.querySelector('#conversionCard'),
  wouldPayButton: document.querySelector('#wouldPayButton'),
  notNowButton: document.querySelector('#notNowButton'),
  conversionStatus: document.querySelector('#conversionStatus')
};

export const state = {
  rawRows: [],
  currentDeck: null,
  questions: [],
  currentIndex: 0,
  mode: 'active',
  status: 'idle',
  generation: 0,
  recognition: null,
  currentUtterance: null,
  voices: [],
  resumeResolvers: [],
  deferredInstallPrompt: null,
  restartCurrentQuestion: false,
  reviewChoice: null,
  sourceType: 'none',
  sourceKind: 'none',
  sourceName: '',
  sourceDetail: '',
  googleSheetIdentity: null,
  savedSourceId: null,
  resumeSourceRow: null,
  completedQuestionCount: 0,
  tenQuestionMilestoneRecorded: false,
  wakeLock: null,
  wakeLockRequested: false,
  lockScreenWatchdog: null
};

export function loadSettings() {
  migrateLegacyStorage();
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function selectedMode() {
  return elements.modeInputs.find((input) => input.checked)?.value ?? 'active';
}

export function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sheetUrl: elements.sheetUrl.value,
    hasHeaders: elements.hasHeaders.checked,
    mode: selectedMode(),
    keepScreenAwake: elements.keepScreenAwake?.checked ?? true,
    answerDelay: Number(elements.answerDelay.value),
    speechRate: Number(elements.speechRate.value),
    strictness: elements.strictness.value,
    voiceURI: elements.voiceSelect.value
  }));
}

export function restoreSettings() {
  migrateLegacyStorage();
  const settings = loadSettings();
  if (settings.sheetUrl && settings.sheetUrl !== 'Built-in demo') elements.sheetUrl.value = settings.sheetUrl;
  if (typeof settings.hasHeaders === 'boolean') elements.hasHeaders.checked = settings.hasHeaders;
  if (settings.mode) {
    const input = elements.modeInputs.find((candidate) => candidate.value === settings.mode);
    if (input) input.checked = true;
  }
  if (elements.keepScreenAwake) {
    elements.keepScreenAwake.checked = typeof settings.keepScreenAwake === 'boolean'
      ? settings.keepScreenAwake
      : true;
  }
  if (settings.answerDelay) elements.answerDelay.value = settings.answerDelay;
  if (settings.speechRate) elements.speechRate.value = settings.speechRate;
  if (settings.strictness) elements.strictness.value = settings.strictness;
  elements.delayValue.textContent = `${elements.answerDelay.value}s`;
  elements.rateValue.textContent = `${Number(elements.speechRate.value).toFixed(1)}×`;
}

export function saveProgress() {
  migrateLegacyStorage();
  if (!state.questions.length) return;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({
    sheetUrl: elements.sheetUrl.value,
    sourceKind: state.sourceKind,
    sourceRow: state.questions[state.currentIndex]?.sourceRow ?? null
  }));
  try {
    progressListener?.();
  } catch (error) {
    console.warn('Cloud progress listener failed', error);
  }
}

export function setSheetStatus(message, type = 'neutral') {
  elements.sheetStatus.textContent = message;
  elements.sheetStatus.dataset.type = type;
}

export function setPasteStatus(message, type = 'neutral') {
  if (!elements.pasteStatus) return;
  elements.pasteStatus.textContent = message;
  elements.pasteStatus.dataset.type = type;
}

export function setSessionStatus(status, message) {
  state.status = status;
  elements.statusBadge.textContent = message;
  elements.statusBadge.dataset.status = status;
  elements.pauseButton.disabled = !['running', 'listening', 'waiting'].includes(status);
  elements.resumeButton.disabled = status !== 'paused';
  elements.stopButton.disabled = status === 'idle' || status === 'complete';
}

export function updateControls() {
  const hasQuestions = state.questions.length > 0;
  elements.startButton.disabled = !hasQuestions || ['running', 'listening', 'waiting', 'paused'].includes(state.status);
  elements.repeatButton.disabled = !hasQuestions || state.status === 'idle';
  elements.previousButton.disabled = !hasQuestions || state.currentIndex <= 0;
  elements.nextButton.disabled = !hasQuestions || state.currentIndex >= state.questions.length - 1;
}

export function safeJson(value) {
  try { return JSON.parse(value || 'null'); } catch { return null; }
}
