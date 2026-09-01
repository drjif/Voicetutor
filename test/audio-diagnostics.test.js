import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIO_TEST_PHRASE,
  TTS_UNAVAILABLE_WITH_AUDIO,
  WEBSITE_AUDIO_UNAVAILABLE,
  diagnoseBrowserAudio,
  formatAudioDiagnosticReport,
  inspectSpeechSynthesisApi,
  isSpeechSynthesisUsable,
  summarizeAudioDiagnostic
} from '../audio-diagnostics.js';

function createFakeAudio({ play = true, playError = null } = {}) {
  return class FakeAudio {
    constructor(src) {
      this.src = src;
      this.preload = '';
      this.error = null;
      this._listeners = new Map();
    }

    addEventListener(type, fn) {
      const list = this._listeners.get(type) ?? [];
      list.push(fn);
      this._listeners.set(type, list);
    }

    pause() {}

    play() {
      if (playError) return Promise.reject(playError);
      if (play) {
        queueMicrotask(() => {
          for (const fn of this._listeners.get('playing') ?? []) fn();
        });
        return Promise.resolve();
      }
      return new Promise(() => {});
    }
  };
}

function createSynth({
  voices = [],
  voicesAfterChange = null,
  speakBehavior = 'success',
  error = 'synthesis-failed'
} = {}) {
  const listeners = new Set();
  const currentVoices = [...voices];
  const synth = {
    onvoiceschanged: null,
    getVoices() {
      return [...currentVoices];
    },
    addEventListener(type, fn) {
      if (type === 'voiceschanged') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'voiceschanged') listeners.delete(fn);
    },
    cancel() {},
    speak(utterance) {
      if (speakBehavior === 'silent') return;
      if (speakBehavior === 'error') {
        queueMicrotask(() => utterance.onerror?.({ error }));
        return;
      }
      queueMicrotask(() => {
        utterance.onstart?.();
        utterance.onend?.();
      });
    },
    emitVoicesChanged() {
      if (voicesAfterChange) {
        currentVoices.splice(0, currentVoices.length, ...voicesAfterChange);
      }
      for (const fn of listeners) fn();
      synth.onvoiceschanged?.();
    }
  };
  return synth;
}

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }
}

test('inspectSpeechSynthesisApi does not treat a missing utterance constructor as usable TTS', () => {
  const api = inspectSpeechSynthesisApi({
    speechSynthesis: { getVoices() { return [{ name: 'Fake' }]; } }
  });
  assert.equal(api.hasSpeechSynthesis, true);
  assert.equal(api.hasSpeechSynthesisUtterance, false);
  assert.equal(api.voiceCountImmediate, 1);
});

test('Chrome-like synthesis: HTML audio plays, voices appear, utterance fires onstart and onend', async () => {
  const synth = createSynth({
    voices: [],
    voicesAfterChange: [{ name: 'Samantha', lang: 'en-US' }],
    speakBehavior: 'success'
  });
  const globalObject = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    Audio: createFakeAudio({ play: true })
  };

  const pending = diagnoseBrowserAudio({
    globalObject,
    timeoutMs: 200,
    voiceWaitMs: 200
  });
  queueMicrotask(() => synth.emitVoicesChanged());
  const result = await pending;

  assert.equal(result.htmlAudioPlayed, true);
  assert.equal(result.utteranceOnStart, true);
  assert.equal(result.utteranceOnEnd, true);
  assert.equal(result.voiceCount, 1);
  assert.equal(result.voiceschangedFired, true);
  assert.equal(isSpeechSynthesisUsable(result), true);
  const report = formatAudioDiagnosticReport(result);
  assert.match(report, /Browser audio works/);
  assert.match(report, /Speech synthesis available/);
  assert.match(report, /Voices detected: 1/);
  assert.doesNotMatch(report, /same3le’s browser voice is unavailable/);
  assert.doesNotMatch(report, /Website audio is currently unavailable/);
});

test('Tesla-like synthesis: speechSynthesis exists but utterance never starts', async () => {
  const synth = createSynth({ voices: [], speakBehavior: 'silent' });
  const result = await diagnoseBrowserAudio({
    globalObject: {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
      Audio: createFakeAudio({ play: true })
    },
    timeoutMs: 40,
    voiceWaitMs: 20
  });

  assert.equal(result.hasSpeechSynthesis, true);
  assert.equal(result.hasSpeechSynthesisUtterance, true);
  assert.equal(result.voiceCount, 0);
  assert.equal(result.utteranceOnStart, false);
  assert.equal(result.utteranceOnEnd, false);
  assert.equal(result.htmlAudioPlayed, true);
  assert.equal(isSpeechSynthesisUsable(result), false);
  assert.equal(result.synthesisError, 'utterance did not fire onstart or onend');
  assert.equal(summarizeAudioDiagnostic(result).summary, TTS_UNAVAILABLE_WITH_AUDIO);
  const report = formatAudioDiagnosticReport(result);
  assert.match(report, /Browser audio works/);
  assert.match(report, /Speech synthesis unavailable/);
  assert.match(report, /Voices detected: 0/);
  assert.match(report, /Synthesis error: utterance did not fire onstart or onend/);
  assert.match(report, new RegExp(TTS_UNAVAILABLE_WITH_AUDIO));
});

test('both audio paths failing reports website audio unavailable', async () => {
  const synth = createSynth({ voices: [], speakBehavior: 'error', error: 'synthesis-unavailable' });
  const result = await diagnoseBrowserAudio({
    globalObject: {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
      Audio: createFakeAudio({ playError: new Error('NotAllowedError') })
    },
    timeoutMs: 40,
    voiceWaitMs: 20
  });

  assert.equal(result.htmlAudioPlayed, false);
  assert.equal(result.utteranceOnError, true);
  assert.equal(result.synthesisError, 'synthesis-unavailable');
  assert.equal(isSpeechSynthesisUsable(result), false);
  assert.equal(summarizeAudioDiagnostic(result).summary, WEBSITE_AUDIO_UNAVAILABLE);
  assert.match(formatAudioDiagnosticReport(result), /Browser audio fails/);
});

test('diagnoseBrowserAudio speaks only the first-party test phrase', async () => {
  let spoken = null;
  const synth = createSynth({ voices: [{ name: 'Alex' }], speakBehavior: 'success' });
  const originalSpeak = synth.speak.bind(synth);
  synth.speak = (utterance) => {
    spoken = utterance.text;
    return originalSpeak(utterance);
  };

  await diagnoseBrowserAudio({
    globalObject: {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
      Audio: createFakeAudio({ play: true })
    },
    timeoutMs: 80,
    voiceWaitMs: 20
  });

  assert.equal(spoken, AUDIO_TEST_PHRASE);
});
