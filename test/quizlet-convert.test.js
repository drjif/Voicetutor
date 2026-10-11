import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuizletExport,
  detectTermSeparator,
  detectRowSeparator,
  toAnkiText,
  toCsv,
  toSame3lePaste,
  fileSlug
} from '../quizlet-to-anki/convert.js';
import { parsePastedQuestions } from '../paste-data.js';

const TAB_EXPORT = 'mitochondria\tpowerhouse of the cell\nribosome\tmakes proteins\nnucleus\tholds DNA';

test('parses the default Quizlet export (tab + new line)', () => {
  const result = parseQuizletExport(TAB_EXPORT);
  assert.equal(result.termSeparator, 'tab');
  assert.equal(result.rowSeparator, 'newline');
  assert.deepEqual(result.cards, [
    { term: 'mitochondria', definition: 'powerhouse of the cell' },
    { term: 'ribosome', definition: 'makes proteins' },
    { term: 'nucleus', definition: 'holds DNA' }
  ]);
  assert.equal(result.skipped.length, 0);
});

test('handles Windows line endings, a BOM and blank lines', () => {
  const result = parseQuizletExport('﻿a\tb\r\n\r\nc\td\r\n');
  assert.deepEqual(result.cards.map((c) => c.term), ['a', 'c']);
});

test('keeps commas inside a tab export', () => {
  const result = parseQuizletExport('Paris, France\tcapital, largest city\nRome\tItaly');
  assert.equal(result.termSeparator, 'tab');
  assert.deepEqual(result.cards[0], { term: 'Paris, France', definition: 'capital, largest city' });
});

test('detects comma and dash exports', () => {
  assert.equal(detectTermSeparator('hola,hello\nadios,goodbye'), 'comma');
  assert.equal(detectTermSeparator('hola - hello\nadios - goodbye'), 'dash');
  const result = parseQuizletExport('hola,hello, hi\nadios,goodbye');
  assert.deepEqual(result.cards[0], { term: 'hola', definition: 'hello, hi' });
});

test('treats a following line without a separator as part of the definition', () => {
  const result = parseQuizletExport('Krebs cycle\tstep one\nstep two\nGlycolysis\tsplits glucose');
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].definition, 'step one\nstep two');
  assert.equal(result.skipped.length, 0);
});

test('reports lines it cannot use instead of guessing', () => {
  const result = parseQuizletExport('just a heading\n\nterm\tdefinition\n\torphan definition');
  assert.equal(result.cards.length, 1);
  assert.deepEqual(result.skipped.map((s) => s.row), [1, 4]);
});

test('supports semicolon rows and custom separators', () => {
  assert.equal(detectRowSeparator('a\tb;c\td'), 'semicolon');
  const semi = parseQuizletExport('a\tb;c\td');
  assert.equal(semi.cards.length, 2);
  const custom = parseQuizletExport('a::b||c::d', {
    termSeparator: 'custom', customTerm: '::', rowSeparator: 'custom', customRow: '||'
  });
  assert.deepEqual(custom.cards, [{ term: 'a', definition: 'b' }, { term: 'c', definition: 'd' }]);
  const escaped = parseQuizletExport('a\tb\n\nc\td', { rowSeparator: 'custom', customRow: '\\n\\n' });
  assert.equal(escaped.cards.length, 2);
});

test('keeps line breaks inside a card when rows use a custom separator', () => {
  const result = parseQuizletExport('a\tline one\nline two;;b\tc', { rowSeparator: 'custom', customRow: ';;' });
  assert.deepEqual(result.cards[0], { term: 'a', definition: 'line one\nline two' });
});

test('swap puts the definition on the front', () => {
  const result = parseQuizletExport('dog\tperro', { swap: true });
  assert.deepEqual(result.cards[0], { term: 'perro', definition: 'dog' });
});

test('Anki file has headers, escapes HTML and quotes every field', () => {
  const text = toAnkiText([
    { term: '"Hola" & <b>', definition: 'line 1\nline\t2' }
  ], { deck: 'Spanish\t1' });
  const lines = text.trimEnd().split('\n');
  assert.equal(lines[0], '#separator:tab');
  assert.equal(lines[1], '#html:true');
  assert.equal(lines[2], '#deck:Spanish 1');
  assert.equal(lines[3], '"""Hola"" &amp; &lt;b&gt;"\t"line 1<br>line 2"');
  assert.equal(lines.length, 4);
});

test('Anki file omits the deck header when no deck is given', () => {
  assert.ok(!toAnkiText([{ term: 'a', definition: 'b' }]).includes('#deck'));
});

test('CSV quotes only when needed and keeps accents', () => {
  const csv = toCsv([{ term: 'café', definition: 'coffee, or a coffee shop' }, { term: 'say "hi"', definition: 'x' }]);
  assert.equal(csv, 'Term,Definition\r\ncafé,"coffee, or a coffee shop"\r\n"say ""hi""",x\r\n');
});

test('same3le paste output is understood by the existing paste parser', () => {
  const { cards } = parseQuizletExport('Krebs cycle\tstep one\nstep two\nGlycolysis\tsplits glucose\nATP\tadenosine triphosphate');
  const parsed = parsePastedQuestions(toSame3lePaste(cards));
  const parsedCards = parsed.cards ?? parsed;
  assert.equal(parsedCards.length, 3);
  assert.equal(parsedCards[0].question, 'Krebs cycle');
  assert.equal(parsedCards[0].answer, 'step one step two');
  assert.equal(parsedCards[2].answer, 'adenosine triphosphate');
});

test('file names are safe slugs', () => {
  assert.equal(fileSlug('Bio 101: Cells & Énergie'), 'bio-101-cells-energie');
  assert.equal(fileSlug(''), 'quizlet-to-anki');
});
