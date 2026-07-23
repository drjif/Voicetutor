export const STORAGE_KEY = 'voicetutor.settings.v1';
export const PROGRESS_KEY = 'voicetutor.progress.v1';

export const elements = {
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
  browserWarning: document.querySelector('#browserWarning'),
  installButton: document.querySelector('#installButton')
};

export const state = {
  rawRows: [],
  questions: [],
  currentIndex: 0,
  mode: 'passive',
  status: 'idle',
  generation: 0,
  recognition: null,
  currentUtterance: null,
  voices: [],
  resumeResolvers: [],
  deferredInstallPrompt: null,
  restartCurrentQuestion: false
};

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function selectedMode() {
  return elements.modeInputs.find((input) => input.checked)?.value ?? 'passive';
}

export function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sheetUrl: elements.sheetUrl.value,
    hasHeaders: elements.hasHeaders.checked,
    mode: selectedMode(),
    answerDelay: Number(elements.answerDelay.value),
    speechRate: Number(elements.speechRate.value),
    strictness: elements.strictness.value,
    voiceURI: elements.voiceSelect.value
  }));
}

export function restoreSettings() {
  const settings = loadSettings();
  if (settings.sheetUrl) elements.sheetUrl.value = settings.sheetUrl;
  if (typeof settings.hasHeaders === 'boolean') elements.hasHeaders.checked = settings.hasHeaders;
  if (settings.mode) {
    const input = elements.modeInputs.find((candidate) => candidate.value === settings.mode);
    if (input) input.checked = true;
  }
  if (settings.answerDelay) elements.answerDelay.value = settings.answerDelay;
  if (settings.speechRate) elements.speechRate.value = settings.speechRate;
  if (settings.strictness) elements.strictness.value = settings.strictness;
  elements.delayValue.textContent = `${elements.answerDelay.value}s`;
  elements.rateValue.textContent = `${Number(elements.speechRate.value).toFixed(1)}×`;
}

export function saveProgress() {
  if (!state.questions.length) return;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({
    sheetUrl: elements.sheetUrl.value,
    sourceRow: state.questions[state.currentIndex]?.sourceRow ?? null
  }));
}

export function setSheetStatus(message, type = 'neutral') {
  elements.sheetStatus.textContent = message;
  elements.sheetStatus.dataset.type = type;
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
