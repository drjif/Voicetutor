import {
  TTS_UNAVAILABLE_WITH_AUDIO,
  WEBSITE_AUDIO_UNAVAILABLE,
  inspectSpeechSynthesisApi,
  isSpeechSynthesisUsable,
  summarizeAudioDiagnostic,
  waitForSpeechVoices
} from './audio-diagnostics.js';
import { elements, loadSettings, setSessionStatus, state } from './dom.js';

let loadTimeTtsWarning = null;
let diagnosticSupportMessage = null;

function isIOSDevice() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || navigator.standalone === true;
}

function isSafariBrowser() {
  const userAgent = navigator.userAgent;
  return /Safari/i.test(userAgent) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(userAgent);
}

function renderBrowserSupport(recognitionMessages) {
  const messages = [...recognitionMessages];
  if (diagnosticSupportMessage) messages.push(diagnosticSupportMessage);
  else if (loadTimeTtsWarning) messages.push(loadTimeTtsWarning);

  if (messages.length) {
    elements.browserWarning.hidden = false;
    elements.browserWarning.textContent = messages.join(' ');
  } else {
    elements.browserWarning.hidden = true;
    elements.browserWarning.textContent = '';
  }
}

function recognitionSupportMessages() {
  const messages = [];
  const activeInput = elements.modeInputs.find((input) => input.value === 'active');
  const passiveInput = elements.modeInputs.find((input) => input.value === 'passive');

  if (!recognitionConstructor()) {
    messages.push('Answer out loud is unavailable here; use Safari on iPhone or current Chrome or Edge on a computer.');
    if (activeInput) {
      activeInput.disabled = true;
      activeInput.closest('.mode-card')?.setAttribute('aria-disabled', 'true');
      if (activeInput.checked && passiveInput) passiveInput.checked = true;
    }
  } else if (isIOSDevice() && (isStandaloneApp() || !isSafariBrowser())) {
    messages.push('On iPhone, Answer out loud is most reliable in a Safari browser tab. Installed web apps and other iPhone browsers may expose speech recognition but still fail to start it.');
  } else if (isIOSDevice()) {
    messages.push('On iPhone, Answer out loud requires Safari microphone permission and Siri enabled in Settings.');
  }

  return messages;
}

export function populateVoices() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  state.voices = voices;
  if (voices.length && loadTimeTtsWarning && !diagnosticSupportMessage) {
    loadTimeTtsWarning = null;
    renderBrowserSupport(recognitionSupportMessages());
  }
  const savedVoice = loadSettings().voiceURI;
  elements.voiceSelect.innerHTML = '';
  const preferred = voices.filter((voice) => /^en(-|_)/i.test(voice.lang));
  const list = preferred.length ? preferred : voices;

  if (!list.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'System default voice';
    elements.voiceSelect.append(option);
    return;
  }

  list.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})${voice.default ? ' — default' : ''}`;
    elements.voiceSelect.append(option);
  });
  if (savedVoice && list.some((voice) => voice.voiceURI === savedVoice)) {
    elements.voiceSelect.value = savedVoice;
  }
}

function selectedVoice() {
  return state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) ?? null;
}

export function createCancellationError() {
  return Object.assign(new Error('Session cancelled'), { name: 'SessionCancelledError' });
}

export function assertGeneration(generation) {
  if (generation !== state.generation) throw createCancellationError();
}

export async function waitUntilResumed(generation) {
  assertGeneration(generation);
  if (state.status !== 'paused') return;
  await new Promise((resolve) => state.resumeResolvers.push(resolve));
  assertGeneration(generation);
}

export async function pausableWait(milliseconds, generation) {
  let remaining = milliseconds;
  while (remaining > 0) {
    assertGeneration(generation);
    await waitUntilResumed(generation);
    const slice = Math.min(100, remaining);
    await new Promise((resolve) => setTimeout(resolve, slice));
    if (state.status !== 'paused') remaining -= slice;
  }
}

export function speak(text, generation) {
  return new Promise(async (resolve, reject) => {
    try {
      assertGeneration(generation);
      await waitUntilResumed(generation);
      assertGeneration(generation);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = selectedVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = Number(elements.speechRate.value);
      utterance.pitch = 1;
      utterance.volume = 1;
      state.currentUtterance = utterance;
      utterance.onend = () => {
        state.currentUtterance = null;
        resolve();
      };
      utterance.onerror = (event) => {
        state.currentUtterance = null;
        if (event.error === 'canceled' || event.error === 'interrupted') {
          reject(createCancellationError());
        } else {
          reject(new Error(`Speech synthesis error: ${event.error}`));
        }
      };
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      reject(error);
    }
  });
}

export function recognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function combineRecognitionAlternatives(finalResults) {
  const orderedResults = [...finalResults.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value);

  if (!orderedResults.length) return [];

  let combinations = [{ transcript: '', confidenceTotal: 0, confidenceCount: 0 }];

  for (const resultAlternatives of orderedResults) {
    const next = [];
    for (const combination of combinations) {
      for (const alternative of resultAlternatives) {
        const hasConfidence = Number.isFinite(alternative.confidence) && alternative.confidence > 0;
        next.push({
          transcript: `${combination.transcript} ${alternative.transcript}`.trim(),
          confidenceTotal: combination.confidenceTotal + (hasConfidence ? alternative.confidence : 0),
          confidenceCount: combination.confidenceCount + (hasConfidence ? 1 : 0)
        });
      }
    }

    combinations = next
      .sort((left, right) => {
        const leftConfidence = left.confidenceCount
          ? left.confidenceTotal / left.confidenceCount
          : 0;
        const rightConfidence = right.confidenceCount
          ? right.confidenceTotal / right.confidenceCount
          : 0;
        return rightConfidence - leftConfidence;
      })
      .slice(0, 5);
  }

  return combinations.map((item) => ({
    transcript: item.transcript,
    confidence: item.confidenceCount
      ? item.confidenceTotal / item.confidenceCount
      : null
  }));
}

function recognitionErrorMessage(error) {
  if (error === 'not-allowed') {
    return 'Microphone or speech-recognition permission was denied. Allow access in the browser settings and try again.';
  }
  if (error === 'service-not-allowed') {
    return isIOSDevice()
      ? 'Speech recognition is unavailable in this iPhone browser context. Open same3le in Safari, make sure Siri is enabled, and try again.'
      : 'The browser did not allow its speech-recognition service. Try current Chrome or Edge.';
  }
  if (error === 'audio-capture') {
    return 'No working microphone was found. Check the microphone, Bluetooth connection, and browser permission.';
  }
  if (error === 'network') {
    return 'Speech recognition could not reach its recognition service. Check the internet connection and try again.';
  }
  if (error === 'language-not-supported' || error === 'language-unavailable') {
    return 'English speech recognition is not available on this device or browser.';
  }
  return `Speech recognition error: ${error}`;
}

export function listenForAnswer(generation) {
  return new Promise((resolve, reject) => {
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      reject(new Error('Speech recognition is not supported in this browser. Use Safari on iPhone or current Chrome or Edge on a computer.'));
      return;
    }

    const recognition = new Recognition();
    state.recognition = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = !isIOSDevice();
    recognition.continuous = false;
    recognition.maxAlternatives = 5;

    const finalResults = new Map();
    let settled = false;

    const cleanup = () => {
      if (state.recognition === recognition) state.recognition = null;
      elements.listeningIndicator.hidden = true;
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    recognition.onstart = () => {
      try {
        assertGeneration(generation);
      } catch (error) {
        try { recognition.abort(); } catch {}
        fail(error);
        return;
      }
      setSessionStatus('listening', 'Listening');
      elements.listeningIndicator.hidden = false;
      elements.transcriptCard.hidden = false;
      elements.transcript.textContent = 'Listening…';
    };

    recognition.onresult = (event) => {
      if (generation !== state.generation) return;
      let interim = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          const alternatives = Array.from(result)
            .slice(0, 5)
            .map((alternative) => ({
              transcript: alternative.transcript.trim(),
              confidence: alternative.confidence
            }))
            .filter((alternative) => alternative.transcript);
          finalResults.set(i, alternatives);
        } else if (i >= event.resultIndex) {
          interim += result[0]?.transcript ?? '';
        }
      }

      const alternatives = combineRecognitionAlternatives(finalResults);
      const finalTranscript = alternatives[0]?.transcript ?? '';
      elements.transcript.textContent = finalTranscript || interim.trim() || 'Listening…';
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') {
        if (generation !== state.generation || state.status === 'idle' || state.status === 'complete') {
          fail(createCancellationError());
          return;
        }
        if (state.status === 'paused') {
          finish({ transcript: '', alternatives: [], paused: true });
          return;
        }
      }
      if (event.error === 'no-speech') {
        finish({ transcript: '', alternatives: [], noSpeech: true });
        return;
      }
      fail(new Error(recognitionErrorMessage(event.error)));
    };

    recognition.onend = () => {
      if (settled) return;
      if (generation !== state.generation || state.status === 'idle' || state.status === 'complete') {
        fail(createCancellationError());
        return;
      }
      const alternatives = combineRecognitionAlternatives(finalResults);
      finish({
        transcript: alternatives[0]?.transcript ?? '',
        alternatives
      });
    };

    try {
      assertGeneration(generation);
      recognition.start();
    } catch (error) {
      fail(error);
    }
  });
}

export function applyDiagnosticSupportMessage(diagnostic) {
  const view = summarizeAudioDiagnostic(diagnostic);
  if (isSpeechSynthesisUsable(diagnostic)) {
    diagnosticSupportMessage = null;
    loadTimeTtsWarning = null;
  } else if (view.summary === TTS_UNAVAILABLE_WITH_AUDIO || view.summary === WEBSITE_AUDIO_UNAVAILABLE) {
    diagnosticSupportMessage = view.summary;
    loadTimeTtsWarning = null;
  }
  renderBrowserSupport(recognitionSupportMessages());
}

export function checkBrowserSupport() {
  const api = inspectSpeechSynthesisApi(window);
  const recognitionMessages = recognitionSupportMessages();

  if (!api.hasSpeechSynthesis || !api.hasSpeechSynthesisUtterance) {
    loadTimeTtsWarning = 'This browser cannot read questions aloud.';
    renderBrowserSupport(recognitionMessages);
    return;
  }

  // Presence of speechSynthesis is not proof that TTS works (Tesla-style shells
  // expose the API with zero voices and utterances that never start).
  loadTimeTtsWarning = null;
  renderBrowserSupport(recognitionMessages);

  waitForSpeechVoices().then(({ voiceCount }) => {
    if (diagnosticSupportMessage) return;
    const liveCount = window.speechSynthesis?.getVoices?.()?.length ?? voiceCount;
    if (liveCount > 0) {
      loadTimeTtsWarning = null;
    } else {
      loadTimeTtsWarning = 'This browser does not currently provide a usable text-to-speech voice. Tap Test audio to confirm speakers and browser voice.';
    }
    renderBrowserSupport(recognitionSupportMessages());
  });
}