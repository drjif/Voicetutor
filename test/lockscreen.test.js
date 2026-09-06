import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

const { createLockScreenTrack } = await import('../lockscreen.js');

test('lock-screen track marks question and answer phases separately', () => {
  const questions = [
    { question: 'First question?', answer: 'First answer' },
    { question: 'Second question?', answer: 'Second answer' },
    { question: 'Third question?', answer: 'Third answer' }
  ];

  const track = createLockScreenTrack(questions, 1, 3);

  assert.deepEqual(
    track.markers.map(({ index, phase }) => ({ index, phase })),
    [
      { index: 1, phase: 'question' },
      { index: 1, phase: 'answer' },
      { index: 2, phase: 'question' },
      { index: 2, phase: 'answer' }
    ]
  );

  for (let i = 1; i < track.markers.length; i += 1) {
    assert.ok(track.markers[i].charIndex > track.markers[i - 1].charIndex);
  }

  const firstQuestionMarker = track.markers[0];
  const firstAnswerMarker = track.markers[1];
  assert.match(track.text.slice(firstQuestionMarker.charIndex), /^Question 2\./);
  assert.match(track.text.slice(firstAnswerMarker.charIndex), /^The answer is Second answer\./);
});
