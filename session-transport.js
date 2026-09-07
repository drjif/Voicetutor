export const ACTIVE_SESSION_STATUSES = ['running', 'listening', 'waiting', 'paused'];

export function clampTransportIndex(index, questionCount) {
  const maxIndex = Math.max(0, Number(questionCount) - 1);
  const numeric = Number(index);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(maxIndex, Math.max(0, Math.trunc(numeric)));
}

export function transportAnchorIndex(sessionState, questionCount) {
  if (sessionState?.status === 'paused' && Number.isInteger(sessionState?.pausedIndex)) {
    return clampTransportIndex(sessionState.pausedIndex, questionCount);
  }
  return clampTransportIndex(sessionState?.currentIndex, questionCount);
}

export function shouldApplySpeechBoundary({ generation, currentGeneration, status }) {
  return generation === currentGeneration && status === 'running';
}
