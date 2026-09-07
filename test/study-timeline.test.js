import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceMarkerCursor,
  createLockScreenTrack,
  lockScreenMetadataFields,
  markerForCharacter
} from '../study-timeline.js';

test('lock-screen track creates question and answer markers for every card', () => {
  const track = createLockScreenTrack([
    { question: 'Capital of France?', answer: 'Paris' },
    { question: '2 + 2?', answer: '4' }
  ], 0, 3);

  assert.deepEqual(track.markers.map(({ index, phase }) => ({ index, phase })), [
    { index: 0, phase: 'question' },
    { index: 0, phase: 'answer' },
    { index: 1, phase: 'question' },
    { index: 1, phase: 'answer' }
  ]);

  const firstAnswer = track.markers[1];
  assert.equal(track.text.slice(firstAnswer.charIndex).startsWith('The answer is Paris.'), true);
  const secondAnswer = track.markers[3];
  assert.equal(track.text.slice(secondAnswer.charIndex).startsWith('The answer is 4.'), true);
});

test('markerForCharacter advances from question to answer without revealing early', () => {
  const track = createLockScreenTrack([
    { question: 'Capital of France?', answer: 'Paris' }
  ], 0, 3);
  const [questionMarker, answerMarker] = track.markers;

  assert.equal(markerForCharacter(track.markers, questionMarker.charIndex).phase, 'question');
  assert.equal(markerForCharacter(track.markers, answerMarker.charIndex - 1).phase, 'question');
  assert.equal(markerForCharacter(track.markers, answerMarker.charIndex).phase, 'answer');
});

test('a single bogus end-of-track boundary cannot jump to the last question', () => {
  const track = createLockScreenTrack([
    { question: 'Q1', answer: 'A1' },
    { question: 'Q2', answer: 'A2' },
    { question: 'Q3', answer: 'A3' },
    { question: 'Q4', answer: 'A4' }
  ], 0, 3);

  const marker = markerForCharacter(track.markers, track.text.length);
  assert.deepEqual({ index: marker.index, phase: marker.phase }, { index: 0, phase: 'answer' });

  const duplicate = markerForCharacter(track.markers, track.text.length);
  assert.deepEqual({ index: duplicate.index, phase: duplicate.phase }, { index: 0, phase: 'answer' });
});

test('advanceMarkerCursor advances at most one phase per increasing boundary event', () => {
  const track = createLockScreenTrack([
    { question: 'Q1', answer: 'A1' },
    { question: 'Q2', answer: 'A2' },
    { question: 'Q3', answer: 'A3' }
  ], 0, 2);

  let cursor = 0;
  let lastCharIndex = -1;
  const hugeBoundary = track.text.length;

  let step = advanceMarkerCursor(track.markers, cursor, hugeBoundary, lastCharIndex);
  assert.equal(step.cursor, 1);
  assert.equal(step.marker.phase, 'answer');
  cursor = step.cursor;
  lastCharIndex = step.lastCharIndex;

  step = advanceMarkerCursor(track.markers, cursor, hugeBoundary, lastCharIndex);
  assert.equal(step.cursor, 1);
  assert.equal(step.marker, null);
});

test('lock-screen metadata withholds the answer until answer phase', () => {
  const item = { question: 'Capital of France?', answer: 'Paris' };

  assert.deepEqual(lockScreenMetadataFields(item, 0, 10, 'question'), {
    title: 'Capital of France?',
    artist: 'Think about your answer',
    album: 'same3le · Question 1 of 10'
  });

  assert.deepEqual(lockScreenMetadataFields(item, 0, 10, 'answer'), {
    title: 'Capital of France?',
    artist: 'Answer: Paris',
    album: 'same3le · Question 1 of 10'
  });
});

test('lock-screen track preserves the selected starting index', () => {
  const track = createLockScreenTrack([
    { question: 'Q1', answer: 'A1' },
    { question: 'Q2', answer: 'A2' },
    { question: 'Q3', answer: 'A3' }
  ], 1, 2);

  assert.deepEqual(track.markers.map(({ index, phase }) => ({ index, phase })), [
    { index: 1, phase: 'question' },
    { index: 1, phase: 'answer' },
    { index: 2, phase: 'question' },
    { index: 2, phase: 'answer' }
  ]);
  assert.equal(track.text.includes('Q1'), false);
  assert.equal(track.text.includes('Q2'), true);
  assert.equal(track.text.includes('Q3'), true);
});
