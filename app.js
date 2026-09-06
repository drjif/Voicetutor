import {
  elements,
  restoreSettings,
  saveSettings,
  selectedMode,
  setSessionStatus,
  state,
  updateControls
} from './dom.js';
import { setupBetaFunnel } from './beta.js';
import { setupFileImportUI } from './file-import-ui.js';
import { setupHomepageMarketing } from './homepage-marketing.js';
import { handleWakeLockPreferenceChange, releaseSessionWakeLock, setupPowerManagement } from './power.js';
import { loadSavedGoogleSheet, setSheetReadyHandler, setupSheetEvents } from './sheet-v2.js';
import { hideSheetReadyActions, setSavedSheetLoader, setupAccountUI, showSheetReadyActions } from './account-ui.js';
import { restartAt, setupSessionEvents } from './session-next.js';
import { checkBrowserSupport, populateVoices } from './voice.js';

function updateModePresentation() {
  const mode = selectedMode();
  elements.wakeLockControl.hidden = mode !== 'active';

  if (mode === 'active') {
    elements.startButton.textContent = 'Start quizzing me';
    elements.startNote.textContent = 'Microphone access is requested only for “Answer out loud.” Keep Screen Awake reduces interruptions. Do not use same3le while driving or during patient care.';
  } else if (mode === 'passive') {
    elements.startButton.textContent = 'Start listening';
    elements.startNote.textContent = 'same3le will read each question, wait, and then read the answer. No microphone is used.';
    releaseSessionWakeLock();
  } else {
    elements.startButton.textContent = 'Start lock-screen review';
    elements.startNote.textContent = 'Experimental: start the continuous spoken review before locking your phone. Background playback still depends on your phone and browser. This mode does not listen or grade.';
    releaseSessionWakeLock();
  }
}

function setupSessionControlGuards() {
  // startSession performs async cleanup before it marks the run active. Disable
  // immediately so a fast double-click cannot launch overlapping generations.
  elements.startButton.addEventListener('click', () => {
    if (state.status === 'complete') {
      // A completed run leaves the player on the final card. Start should mean
      // start the deck again unless the user explicitly chose another start row
      // (changing the selector moves the session back to Ready first).
      elements.startRow.value = '0';
    }
    elements.startButton.disabled = true;
  }, { capture: true });

  // At completion Repeat used to be enabled but restartAt treated the session as
  // inactive, so the button only changed the UI to Ready. Make it actually replay
  // the currently displayed card.
  elements.repeatButton.addEventListener('click', (event) => {
    if (state.status !== 'complete') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.status = 'running';
    restartAt(state.currentIndex);
  }, { capture: true });
}

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
  elements.keepScreenAwake.addEventListener('change', () => {
    saveSettings();
    handleWakeLockPreferenceChange();
  });
  elements.modeInputs.forEach((input) => input.addEventListener('change', () => {
    saveSettings();
    updateModePresentation();
  }));
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
  setupHomepageMarketing();
  setupFileImportUI();
  restoreSettings();
  setupBetaFunnel();
  setupSheetEvents();
  setSheetReadyHandler({
    show: showSheetReadyActions,
    hide: hideSheetReadyActions
  });
  setSavedSheetLoader((deck) => loadSavedGoogleSheet(deck));
  setupAccountUI();
  setupSessionControlGuards();
  setupSessionEvents();
  setupPreferences();
  setupPowerManagement();
  setupInstallation();
  checkBrowserSupport();
  populateVoices();
  if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = populateVoices;
  updateModePresentation();
  setSessionStatus('idle', 'Ready');
  updateControls();
}

initialize();
