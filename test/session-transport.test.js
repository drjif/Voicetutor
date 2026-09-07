import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampTransportIndex,
  shouldApplySpeechBoundary,
  transportAnchorIndex
} from '../session-transport.js';

test('paused transport uses the index captured at pause even if currentIndex is later corrupted', () => {
  const state = {
    status: 'paused',
    currentIndex: 624,
    pausedIndex: 11
  };
  assert.equal(transportAnchorIndex(state, 625), 11);
});

test('running transport uses the live current index', () => {
  assert.equal(transportAnchorIndex({ status: 'running', currentIndex: 11, pausedIndex: 4 }, 625), 11);
});

test('transport indices are clamped to the deck', () => {
  assert.equal(clampTransportIndex(-100, 625), 0);
  assert.equal(clampTransportIndex(9999, 625), 624);
});

test('speech boundaries are ignored while paused even when the generation matches', () => {
  assert.equal(shouldApplySpeechBoundary({ generation: 7, currentGeneration: 7, status: 'paused' }), false);
  assert.equal(shouldApplySpeechBoundary({ generation: 7, currentGeneration: 7, status: 'running' }), true);
  assert.equal(shouldApplySpeechBoundary({ generation: 6, currentGeneration: 7, status: 'running' }), false);
});
