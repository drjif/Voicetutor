import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { libraryWorkspaceModel } from '../library-workspace.js';
import { answerPresentationModel } from '../study-presentation.js';

test('signed-in users get the library instead of homepage onboarding', () => {
  assert.deepEqual(libraryWorkspaceModel({ authenticated: true, hasQuestions: false, creatorOpen: false }), {
    showLibrary: true,
    showMarketing: false,
    showCreator: false,
    showStudySetup: false
  });

  assert.deepEqual(libraryWorkspaceModel({ authenticated: true, hasQuestions: false, creatorOpen: true }), {
    showLibrary: true,
    showMarketing: false,
    showCreator: true,
    showStudySetup: false
  });
});

test('loaded decks expose study setup while keeping the authenticated library', () => {
  const model = libraryWorkspaceModel({ authenticated: true, hasQuestions: true, creatorOpen: false });
  assert.equal(model.showLibrary, true);
  assert.equal(model.showMarketing, false);
  assert.equal(model.showCreator, false);
  assert.equal(model.showStudySetup, true);
});

test('signed-out visitors retain the public homepage and creator', () => {
  const model = libraryWorkspaceModel({ authenticated: false, hasQuestions: false, creatorOpen: false });
  assert.equal(model.showLibrary, false);
  assert.equal(model.showMarketing, true);
  assert.equal(model.showCreator, true);
  assert.equal(model.showStudySetup, true);
});

test('manual answer reveal is available outside automatic answer phases', () => {
  assert.deepEqual(answerPresentationModel({ phase: 'question', manualAnswerVisible: false }), {
    showAnswer: false,
    showRevealControl: true,
    revealLabel: 'Show answer'
  });

  assert.deepEqual(answerPresentationModel({ phase: 'question', manualAnswerVisible: true }), {
    showAnswer: true,
    showRevealControl: true,
    revealLabel: 'Hide answer'
  });
});

test('automatic answer phases keep the answer visible without redundant reveal control', () => {
  const feedback = answerPresentationModel({ phase: 'feedback', manualAnswerVisible: false });
  assert.equal(feedback.showAnswer, true);
  assert.equal(feedback.showRevealControl, false);

  const answer = answerPresentationModel({ phase: 'answer', manualAnswerVisible: false });
  assert.equal(answer.showAnswer, true);
  assert.equal(answer.showRevealControl, false);
});

test('Car Mode loads the layout layer that moves reveal and navigation controls', () => {
  const html = readFileSync(new URL('../car/index.html', import.meta.url), 'utf8');
  const presentation = readFileSync(new URL('../car/car-presentation.js', import.meta.url), 'utf8');

  assert.match(html, /car-presentation\.js/);
  assert.match(presentation, /questionCard\.insertAdjacentElement\('afterend', revealControls\)/);
  assert.match(presentation, /answerCard\.insertAdjacentElement\('afterend', transportGrid\)/);
  assert.match(presentation, /transportGrid\.append\(previousButton, nextButton\)/);
});
