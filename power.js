import { elements, state } from './dom.js';

const ACTIVE_SESSION_STATUSES = ['running', 'listening', 'waiting', 'paused'];

function wakeLockSupported() {
  return Boolean(navigator.wakeLock?.request);
}

function activeRecallOwnsWakeLock() {
  return state.mode === 'active'
    && ACTIVE_SESSION_STATUSES.includes(state.status)
    && state.wakeLockRequested
    && elements.keepScreenAwake.checked;
}

function setWakeLockStatus(message, type = 'neutral') {
  if (!elements.wakeLockStatus) return;
  elements.wakeLockStatus.textContent = message;
  elements.wakeLockStatus.dataset.type = type;
}

export async function requestSessionWakeLock() {
  state.wakeLockRequested = state.mode === 'active' && elements.keepScreenAwake.checked;
  if (!state.wakeLockRequested) return false;

  if (!wakeLockSupported()) {
    setWakeLockStatus('This browser does not support keeping the screen awake. The session still works, but the phone may lock.', 'warning');
    return false;
  }

  if (state.wakeLock && !state.wakeLock.released) return true;

  try {
    const lock = await navigator.wakeLock.request('screen');
    state.wakeLock = lock;
    setWakeLockStatus('Screen will stay awake during this Answer out loud session.', 'success');
    lock.addEventListener('release', () => {
      if (state.wakeLock === lock) state.wakeLock = null;
      if (state.wakeLockRequested && document.visibilityState === 'visible') {
        setWakeLockStatus('Screen-awake mode was interrupted. It will be requested again when the app is active.', 'warning');
      } else {
        setWakeLockStatus('Screen-awake mode is off.', 'neutral');
      }
    });
    return true;
  } catch (error) {
    console.warn('Screen Wake Lock request failed', error);
    setWakeLockStatus('The phone did not allow screen-awake mode. Check browser or battery settings.', 'warning');
    return false;
  }
}

export async function releaseSessionWakeLock({ preserveIntent = false, force = false } = {}) {
  // A cancelled session can finish after Repeat/Previous/Next has already started
  // a replacement session. Do not let that stale cleanup release the new run's lock.
  if (!force && !preserveIntent && activeRecallOwnsWakeLock()) return false;

  if (!preserveIntent) state.wakeLockRequested = false;
  const lock = state.wakeLock;
  state.wakeLock = null;
  if (lock && !lock.released) {
    try {
      await lock.release();
    } catch (error) {
      console.warn('Screen Wake Lock release failed', error);
    }
  }
  if (!state.wakeLockRequested) {
    setWakeLockStatus('The screen stays awake only while an active-recall session is running.', 'neutral');
  }
  return true;
}

export function handleWakeLockPreferenceChange() {
  if (!elements.keepScreenAwake.checked) {
    releaseSessionWakeLock();
    return;
  }
  if (state.mode === 'active' && ACTIVE_SESSION_STATUSES.includes(state.status)) {
    requestSessionWakeLock();
  }
}

export function setupPowerManagement() {
  if (!wakeLockSupported()) {
    setWakeLockStatus('Screen-awake mode is not supported in this browser. Current Chrome, Edge, or a recent installed iPhone web app is recommended.', 'warning');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible'
        && state.wakeLockRequested
        && state.mode === 'active'
        && ACTIVE_SESSION_STATUSES.includes(state.status)) {
      requestSessionWakeLock();
    }
  });
}
