import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerSimilarity,
  buildQuestionBank,
  detectColumns,
  gradeAnswer,
  parseCsv,
  parseGoogleSheetUrl
} from '../lib.js';

test('converts a Google Sheets URL into a CSV endpoint', () => {
  const parsed = parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=987');
  assert.equal(parsed.spreadsheetId, 'abc_DEF-123');
  assert.equal(parsed.gid, '987');
  assert.match(parsed.csvUrl, /gviz\/tq\?tqx=out:csv&gid=987$/);
});

test('parses quoted CSV fields and embedded commas', () => {
  const rows = parseCsv('Question,Answer\n"A, B?","Yes, both"\n');
  assert.deepEqual(rows, [['Question', 'Answer'], ['A, B?', 'Yes, both']]);
});

test('detects question, answer, and accepted alternative columns', () => {
  const rows = [['Topic', 'Question', 'Correct Answer', 'Accepted Alternatives']];
  const detection = detectColumns(rows, true);
  assert.equal(detection.questionIndex, 1);
  assert.equal(detection.answerIndex, 2);
  assert.equal(detection.acceptedIndex, 3);
});

test('builds question records with source rows preserved', () => {
  const rows = [
    ['Question', 'Answer', 'Accepted'],
    ['Q1', 'A1', 'Alt 1|Alt 2'],
    ['', 'A2', '']
  ];
  const bank = buildQuestionBank(rows, { hasHeaders: true, questionIndex: 0, answerIndex: 1, acceptedIndex: 2 });
  assert.equal(bank.length, 1);
  assert.equal(bank[0].sourceRow, 2);
  assert.deepEqual(bank[0].acceptedAnswers, ['Alt 1', 'Alt 2']);
});

test('matches accepted alternatives', () => {
  const result = gradeAnswer('It blocks TNF alpha', 'A monoclonal antibody against tumor necrosis factor alpha', ['TNF alpha inhibitor']);
  assert.equal(result.correct, true);
});

test('rejects explicit give-up answers', () => {
  const result = gradeAnswer("I don't know", 'N-acetylcysteine');
  assert.equal(result.correct, false);
  assert.equal(result.score, 0);
});

test('produces higher similarity for related answers', () => {
  const related = answerSimilarity('N acetylcysteine', 'N-acetylcysteine');
  const unrelated = answerSimilarity('insulin', 'N-acetylcysteine');
  assert.ok(related > unrelated);
});
