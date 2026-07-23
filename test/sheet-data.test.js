import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuestionBank,
  detectColumns,
  parseDelimited,
  parseGoogleSheetUrl
} from '../sheet-data.js';

test('Google Sheet links provide export and gviz fallback URLs', () => {
  const parsed = parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/abc_123/edit?gid=456#gid=456');
  assert.equal(parsed.gid, '456');
  assert.match(parsed.exportCsvUrl, /export\?format=csv&gid=456$/);
  assert.match(parsed.csvUrl, /gviz\/tq\?tqx=out:csv&gid=456$/);
});

test('parser supports CR-only rows and preserves internal blank rows', () => {
  const rows = parseDelimited('QuestionID,Stem,CorrectAnswer\rQ1,First question,First answer\r,,\rQ2,Second question,Second answer\r');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], ['QuestionID', 'Stem', 'CorrectAnswer']);
  assert.deepEqual(rows[2], ['', '', '']);
});

test('parser supports tab-delimited exports', () => {
  const rows = parseDelimited('QuestionID\tStem\tCorrectAnswer\nQ1\tQuestion text\tAnswer text');
  assert.deepEqual(rows[1], ['Q1', 'Question text', 'Answer text']);
});

test('column detection prefers Stem over QuestionID and CorrectAnswer for answer', () => {
  const rows = [
    ['QuestionID', 'Stem', 'CorrectAnswer'],
    ['Q1', 'What is the diagnosis?', 'Celiac disease']
  ];
  const result = detectColumns(rows, true);
  assert.equal(result.questionIndex, 1);
  assert.equal(result.answerIndex, 2);
  assert.equal(result.acceptedIndex, -1);
  assert.equal(result.headerRowIndex, 0);
});

test('question bank retains true source row numbers across blank rows', () => {
  const rows = [
    ['QuestionID', 'Stem', 'CorrectAnswer'],
    ['', '', ''],
    ['', '', ''],
    ['Q1', 'Question on row four', 'Answer']
  ];
  const detection = detectColumns(rows, true);
  const bank = buildQuestionBank(rows, { ...detection, hasHeaders: true });
  assert.equal(bank.length, 1);
  assert.equal(bank[0].sourceRow, 4);
  assert.equal(bank[0].question, 'Question on row four');
});
