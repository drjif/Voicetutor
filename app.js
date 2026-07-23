import {
  elements,
  restoreSettings,
  saveSettings,
  setSessionStatus,
  state,
  updateControls
} from './dom.js';
import { setupSheetEvents } from './sheet.js';
import { setupSessionEvents } from './session.js';
import { checkBrowserSupport, populateVoices } from './voice.js';

function setupPreferences() {
  elements.answerDelay.addEventListener('input', () => {
    elements.delayValue.textContent = `${elements.answerDelay.value}s`;
    saveSettings();
  });
  elements.speechRate.addEventListener('input', () => {
    elements.rateValue.textContent = `${Number(elements.speechRate.value).toFixed(1)}×`;
    saveSettings();
  });
  elements.voiceSelect.addEventListener('change', saveSettings);
  elements.strictness.addEventListener('change', saveSettings);
  elements.modeInputs.forEach((input) => input.addEventListener('change', saveSettings));
}

function setupInstallation() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  }
}

function initialize() {
  restoreSettings();
  setupSheetEvents();
  setupSessionEvents();
  setupPreferences();
  setupInstallation();
  checkBrowserSupport();
  populateVoices();
  if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = populateVoices;
  setSessionStatus('idle', 'Ready');
  updateControls();
}

initialize();
