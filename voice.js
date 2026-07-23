import { elements, loadSettings, setSessionStatus, state } from './dom.js';

export function populateVoices() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  state.voices = voices;
  const savedVoice = loadSettings().voiceURI;
  elements.voiceSelect.innerHTML = '';
  const preferred = voices.filter((voice) => /^en(-|_)/i.test(voice.lang));
  const list = preferred.length ? preferred : voices;
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

export function listenForAnswer(generation) {
  return new Promise((resolve, reject) => {
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      reject(new Error('Speech recognition is not supported in this browser. Use current Chrome or Edge.'));
      return;
    }

    const recognition = new Recognition();
    state.recognition = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 5;

    const finalResults = new Map();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      state.recognition = null;
      elements.listeningIndicator.hidden = true;
      resolve(value);
    };

    recognition.onstart = () => {
      setSessionStatus('listening', 'Listening');
      elements.listeningIndicator.hidden = false;
      elements.transcriptCard.hidden = false;
      elements.transcript.textContent = 'Listening…';
    };

    recognition.onresult = (event) => {
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
      if (event.error === 'aborted' && state.status === 'paused') {
        finish({ transcript: '', alternatives: [], paused: true });
        return;
      }
      if (event.error === 'no-speech') {
        finish({ transcript: '', alternatives: [], noSpeech: true });
        return;
      }
      if (event.error === 'not-allowed') {
        reject(new Error('Microphone access was denied. Allow microphone access and try again.'));
        return;
      }
      reject(new Error(`Speech recognition error: ${event.error}`));
    };

    recognition.onend = () => {
      if (settled) return;
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
      reject(error);
    }
  });
}

export function checkBrowserSupport() {
  const issues = [];
  if (!('speechSynthesis' in window)) issues.push('speech synthesis');
  if (!recognitionConstructor()) issues.push('speech recognition for Active Recall');
  if (issues.length) {
    elements.browserWarning.hidden = false;
    elements.browserWarning.textContent = `Limited browser support detected: ${issues.join(' and ')}. Current Chrome or Edge is recommended.`;
  }
}
