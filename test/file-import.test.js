import test from 'node:test';
import assert from 'node:assert/strict';

import { fileExtension, hasQuestionAnswerHeader, stripAnkiTextMetadata } from '../file-import.js';

test('recognizes supported file extensions case-insensitively', () => {
  assert.equal(fileExtension('Deck.APKG'), 'apkg');
  assert.equal(fileExtension('study.XLSX'), 'xlsx');
  assert.equal(fileExtension('questions.tsv'), 'tsv');
});

test('detects common question and answer headers', () => {
  assert.equal(hasQuestionAnswerHeader([
    ['Question', 'Answer'],
    ['Capital of France?', 'Paris']
  ]), true);
  assert.equal(hasQuestionAnswerHeader([
    ['Front', 'Back'],
    ['Capital of France?', 'Paris']
  ]), true);
  assert.equal(hasQuestionAnswerHeader([
    ['Capital of France?', 'Paris']
  ]), false);
});

test('removes Anki text export metadata and creates a header from #columns', () => {
  const parsed = stripAnkiTextMetadata([
    '#separator:tab',
    '#html:true',
    '#columns:Front\tBack',
    'What is ATP?\tAdenosine triphosphate'
  ].join('\n'));

  assert.equal(parsed.isAnkiText, true);
  assert.equal(parsed.hasHeaders, true);
  assert.match(parsed.body, /^Front\tBack\n/);
  assert.doesNotMatch(parsed.body, /#separator/);
});

test('ordinary text is not mislabeled as an Anki export', () => {
  const parsed = stripAnkiTextMetadata('Q: What is ATP?\nA: Adenosine triphosphate');
  assert.equal(parsed.isAnkiText, false);
  assert.equal(parsed.hasHeaders, false);
});
