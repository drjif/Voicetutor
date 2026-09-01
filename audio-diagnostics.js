export const AUDIO_TEST_PHRASE = 'same3le audio test';
export const SPEAKER_TEST_SRC = './audio/speaker-test.wav';

export const TTS_UNAVAILABLE_WITH_AUDIO =
  'This browser can play audio but does not provide a usable text-to-speech voice. same3le’s browser voice is unavailable on this device.';
export const WEBSITE_AUDIO_UNAVAILABLE =
  'Website audio is currently unavailable in this browser/device.';

const DEFAULT_TIMEOUT_MS = 3500;
const VOICE_WAIT_MS = 1500;

function asArray(voices) {
  if (!voices) return [];
  return Array.isArray(voices) ? voices : Array.from(voices);
}

export function inspectSpeechSynthesisApi(globalObject = globalThis) {
  const synth = globalObject.speechSynthesis;
  return {
    hasSpeechSynthesis: Boolean(synth) && 'speechSynthesis' in globalObject,
    hasSpeechSynthesisUtterance: typeof globalObject.SpeechSynthesisUtterance === 'function',
    voiceCountImmediate: typeof synth?.getVoices === 'function' ? asArray(synth.getVoices()).length : 0
  };
}

export function waitForSpeechVoices({
  speechSynthesis,
  timeoutMs = VOICE_WAIT_MS
} = {}) {
  const synth = speechSynthesis ?? globalThis.speechSynthesis;
  if (!synth || typeof synth.getVoices !== 'function') {
    return Promise.resolve({
      voices: [],
      voiceCount: 0,
      voiceschangedFired: false
    });
  }

  const immediate = asArray(synth.getVoices());
  if (immediate.length) {
    return Promise.resolve({
      voices: immediate,
      voiceCount: immediate.length,
      voiceschangedFired: false
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const previousHandler = synth.onvoiceschanged;
    const finish = (voiceschangedFired) => {
      if (settled) return;
      settled = true;
      if (typeof synth.removeEventListener === 'function') {
        synth.removeEventListener('voiceschanged', onChange);
      }
      if (synth.onvoiceschanged === wrappedHandler) synth.onvoiceschanged = previousHandler ?? null;
      const voices = asArray(synth.getVoices());
      resolve({ voices, voiceCount: voices.length, voiceschangedFired });
    };

    const onChange = () => finish(true);
    const wrappedHandler = (event) => {
      if (typeof previousHandler === 'function') previousHandler.call(synth, event);
      onChange();
    };

    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', onChange);
    }
    synth.onvoiceschanged = wrappedHandler;

    setTimeout(() => finish(false), timeoutMs);
  });
}

export function playFirstPartyAudio(src, {
  AudioCtor = globalThis.Audio,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof AudioCtor !== 'function') {
    return Promise.resolve({
      played: false,
      error: 'HTML5 Audio is not available'
    });
  }

  let settled = false;
  const audio = new AudioCtor(src);
  audio.preload = 'auto';

  return new Promise((resolve) => {
    const finish = (played, error = null) => {
      if (settled) return;
      settled = true;
      if (!played) {
        try { audio.pause(); } catch {}
      }
      resolve({ played, error });
    };

    const onPlaying = () => finish(true, null);
    const onEnded = () => finish(true, null);
    const onError = () => {
      const mediaError = audio.error;
      const detail = mediaError?.message
        || (mediaError?.code != null ? `MediaError code ${mediaError.code}` : 'HTML5 audio failed to play');
      finish(false, detail);
    };

    if (typeof audio.addEventListener === 'function') {
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
    } else {
      audio.onplaying = onPlaying;
      audio.onended = onEnded;
      audio.onerror = onError;
    }

    let playResult;
    try {
      playResult = audio.play();
    } catch (error) {
      finish(false, error?.message || String(error));
      return;
    }

    if (playResult && typeof playResult.then === 'function') {
      playResult.catch((error) => {
        finish(false, error?.message || String(error));
      });
    }

    setTimeout(() => {
      finish(false, 'HTML5 audio did not start playing');
    }, timeoutMs);
  });
}

export function probeSpeechUtterance(text, {
  speechSynthesis,
  SpeechSynthesisUtterance,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const synth = speechSynthesis ?? globalThis.speechSynthesis;
  const Utterance = SpeechSynthesisUtterance ?? globalThis.SpeechSynthesisUtterance;

  if (!synth || typeof Utterance !== 'function' || typeof synth.speak !== 'function') {
    return Promise.resolve({
      onStart: false,
      onEnd: false,
      onError: false,
      error: 'SpeechSynthesisUtterance is not available'
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const result = {
      onStart: false,
      onEnd: false,
      onError: false,
      error: null
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      try { synth.cancel(); } catch {}
      resolve(result);
    };

    const utterance = new Utterance(text);
    utterance.volume = 1;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      result.onStart = true;
    };
    utterance.onend = () => {
      result.onEnd = true;
      finish();
    };
    utterance.onerror = (event) => {
      result.onError = true;
      const code = event?.error;
      result.error = code ? String(code) : 'unknown';
      if (!result.onStart && !result.onEnd) finish();
    };

    try {
      synth.cancel();
    } catch {}

    try {
      synth.speak(utterance);
    } catch (error) {
      result.onError = true;
      result.error = error?.message || String(error);
      finish();
      return;
    }

    setTimeout(() => {
      if (!result.onStart && !result.onEnd && !result.onError) {
        result.error = 'utterance did not fire onstart or onend';
      }
      finish();
    }, timeoutMs);
  });
}

export function isSpeechSynthesisUsable(diagnostic) {
  if (!diagnostic?.hasSpeechSynthesis || !diagnostic?.hasSpeechSynthesisUtterance) return false;
  if (diagnostic.utteranceOnStart || diagnostic.utteranceOnEnd) return true;
  return false;
}

export function summarizeAudioDiagnostic(diagnostic) {
  const browserAudioWorks = Boolean(diagnostic.htmlAudioPlayed);
  const speechUsable = isSpeechSynthesisUsable(diagnostic);
  let summary = null;
  if (!browserAudioWorks && !speechUsable) summary = WEBSITE_AUDIO_UNAVAILABLE;
  else if (browserAudioWorks && !speechUsable) summary = TTS_UNAVAILABLE_WITH_AUDIO;

  return {
    browserAudioLabel: browserAudioWorks ? 'Browser audio works' : 'Browser audio fails',
    speechSynthesisLabel: speechUsable ? 'Speech synthesis available' : 'Speech synthesis unavailable',
    voiceCount: Number(diagnostic.voiceCount) || 0,
    synthesisError: diagnostic.synthesisError || null,
    summary
  };
}

export function formatAudioDiagnosticReport(diagnostic) {
  const view = summarizeAudioDiagnostic(diagnostic);
  const lines = [
    view.browserAudioLabel,
    view.speechSynthesisLabel,
    `Voices detected: ${view.voiceCount}`
  ];
  if (view.synthesisError) lines.push(`Synthesis error: ${view.synthesisError}`);
  if (view.summary) lines.push(view.summary);
  return lines.join('\n');
}

/**
 * Starts HTML5 audio and SpeechSynthesis immediately so both inherit the user gesture.
 * Does not send microphone, audio, or question content anywhere.
 */
export function diagnoseBrowserAudio({
  audioSrc = SPEAKER_TEST_SRC,
  phrase = AUDIO_TEST_PHRASE,
  globalObject = globalThis,
  AudioCtor,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  voiceWaitMs = VOICE_WAIT_MS
} = {}) {
  const api = inspectSpeechSynthesisApi(globalObject);
  const synth = globalObject.speechSynthesis;
  const htmlPromise = playFirstPartyAudio(audioSrc, {
    AudioCtor: AudioCtor ?? globalObject.Audio,
    timeoutMs
  });
  const speechPromise = probeSpeechUtterance(phrase, {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: globalObject.SpeechSynthesisUtterance,
    timeoutMs
  });
  const voicesPromise = waitForSpeechVoices({
    speechSynthesis: synth,
    timeoutMs: voiceWaitMs
  });

  return Promise.all([htmlPromise, speechPromise, voicesPromise]).then(([html, speech, voices]) => ({
    hasSpeechSynthesis: api.hasSpeechSynthesis,
    hasSpeechSynthesisUtterance: api.hasSpeechSynthesisUtterance,
    voiceCountImmediate: api.voiceCountImmediate,
    voiceCount: Math.max(api.voiceCountImmediate, voices.voiceCount),
    voiceschangedFired: voices.voiceschangedFired,
    utteranceOnStart: speech.onStart,
    utteranceOnEnd: speech.onEnd,
    utteranceOnError: speech.onError,
    synthesisError: speech.error,
    htmlAudioPlayed: html.played,
    htmlAudioError: html.error
  }));
}
