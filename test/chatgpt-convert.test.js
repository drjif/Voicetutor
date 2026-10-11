import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAiFlashcards,
  normalizeAiText,
  extractMainBlock,
  splitDelimited,
  clozeToCards,
  toAnkiBasic,
  toAnkiCloze,
  toCsvCards,
  toHandoffText,
  AI_PROMPT
} from '../chatgpt-to-anki/convert.js';
import { parsePastedQuestions } from '../paste-data.js';
import { cardsFromAnkiFields } from '../anki-import.js';

const EXPECTED = [
  ['What is ATP?', 'Adenosine triphosphate'],
  ['What organelle makes ATP?', 'Mitochondria']
];
const pairs = (result) => result.cards.map((card) => [card.question, card.answer]);

const FORMATS = {
  'Q/A labels': 'Q: What is ATP?\nA: Adenosine triphosphate\n\nQ: What organelle makes ATP?\nA: Mitochondria',
  'bold Q/A': '**Q:** What is ATP?\n**A:** Adenosine triphosphate\n\n**Q:** What organelle makes ATP?\n**A:** Mitochondria',
  'numbered Q/A': '1. Q: What is ATP?\n   A: Adenosine triphosphate\n2. Q: What organelle makes ATP?\n   A: Mitochondria',
  'Front/Back labels': 'Front: What is ATP?\nBack: Adenosine triphosphate\n\nFront: What organelle makes ATP?\nBack: Mitochondria',
  'bold Front/Back with Card headings': '**Card 1**\n**Front:** What is ATP?\n**Back:** Adenosine triphosphate\n\n**Card 2**\n**Front:** What organelle makes ATP?\n**Back:** Mitochondria',
  'Card N headings': 'Card 1\nFront: What is ATP?\nBack: Adenosine triphosphate\n\nCard 2\nFront: What organelle makes ATP?\nBack: Mitochondria',
  'Question/Answer words': 'Question: What is ATP?\nAnswer: Adenosine triphosphate\n\nQuestion: What organelle makes ATP?\nAnswer: Mitochondria',
  'Question 1 / Answer 1': 'Question 1: What is ATP?\nAnswer 1: Adenosine triphosphate\n\nQuestion 2: What organelle makes ATP?\nAnswer 2: Mitochondria',
  'Q1 / A1': 'Q1: What is ATP?\nA1: Adenosine triphosphate\nQ2: What organelle makes ATP?\nA2: Mitochondria',
  'pipe lines': 'What is ATP? | Adenosine triphosphate\nWhat organelle makes ATP? | Mitochondria',
  'semicolon lines (Anki style)': 'What is ATP?;Adenosine triphosphate\nWhat organelle makes ATP?;Mitochondria',
  'semicolon with header in a code block plus chatter': 'Here are your Anki cards:\n\n```csv\nFront;Back\nWhat is ATP?;Adenosine triphosphate\nWhat organelle makes ATP?;Mitochondria\n```\n\nImport them with File > Import.',
  'tab lines': 'What is ATP?\tAdenosine triphosphate\nWhat organelle makes ATP?\tMitochondria',
  'markdown table Front/Back': '| Front | Back |\n|---|---|\n| What is ATP? | Adenosine triphosphate |\n| What organelle makes ATP? | Mitochondria |',
  'markdown table Question/Answer': '| Question | Answer |\n| --- | --- |\n| What is ATP? | Adenosine triphosphate |\n| What organelle makes ATP? | Mitochondria |',
  'CSV with header': 'Front,Back\n"What is ATP?","Adenosine triphosphate"\n"What organelle makes ATP?","Mitochondria"',
  'intro + Q/A + outro': 'Sure! Here are 2 flashcards:\n\nQ: What is ATP?\nA: Adenosine triphosphate\n\nQ: What organelle makes ATP?\nA: Mitochondria\n\nLet me know if you want more!'
};

for (const [name, text] of Object.entries(FORMATS)) {
  test(`reads ${name}`, () => {
    assert.deepEqual(pairs(parseAiFlashcards(text)), EXPECTED);
  });
}

test('reads term – definition and term: definition vocabulary lists', () => {
  assert.deepEqual(pairs(parseAiFlashcards('ATP - Adenosine triphosphate\nMitochondria – Organelle that makes ATP')), [
    ['ATP', 'Adenosine triphosphate'],
    ['Mitochondria', 'Organelle that makes ATP']
  ]);
  assert.deepEqual(pairs(parseAiFlashcards('ATP: Adenosine triphosphate\nMitochondria: Organelle that makes ATP')), [
    ['ATP', 'Adenosine triphosphate'],
    ['Mitochondria', 'Organelle that makes ATP']
  ]);
});

test('keeps separators that sit inside quoted CSV fields', () => {
  assert.deepEqual(splitDelimited('"Paris, France";"capital; largest city"', ';'), ['Paris, France', 'capital; largest city']);
  const result = parseAiFlashcards('Front,Back\n"Paris, France","Capital, largest city"\n"Rome","Italy"');
  assert.deepEqual(pairs(result)[0], ['Paris, France', 'Capital, largest city']);
});

test('prefers the largest code block over surrounding chatter', () => {
  const text = 'Intro text\n```\nA;B\nC;D\n```\nOutro';
  assert.equal(extractMainBlock(text), 'A;B\nC;D\n');
});

test('reports the shape it recognised', () => {
  assert.equal(normalizeAiText('What is ATP?;ATP\nWhy?;Because').shape, 'semicolons');
  assert.equal(parseAiFlashcards(FORMATS['Front/Back labels']).format, 'Q: / A: style labels');
});

test('swap puts the answer on the front', () => {
  assert.deepEqual(pairs(parseAiFlashcards(FORMATS['Q/A labels'], { swap: true }))[0], ['Adenosine triphosphate', 'What is ATP?']);
});

test('returns nothing (instead of guessing) for plain prose', () => {
  const result = parseAiFlashcards('Mitochondria are the powerhouse of the cell and they make most of the ATP a cell uses.');
  assert.equal(result.cards.length, 0);
});

test('cloze mode: one question per cloze number, matching the same3le Anki importer', () => {
  const text = '{{c1::Mitochondria}} make {{c2::ATP}}.\n- The {{c1::nucleus::organelle}} holds DNA.\nThis line is not a card.';
  const result = parseAiFlashcards(text);
  assert.equal(result.mode, 'cloze');
  assert.equal(result.clozeNotes.length, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(pairs(result), [
    ['[…] make ATP.', 'Mitochondria'],
    ['Mitochondria make […].', 'ATP'],
    ['The [organelle] holds DNA.', 'nucleus']
  ]);
  for (const note of result.clozeNotes) {
    const ours = clozeToCards(note.text).map((c) => [c.question, c.answer]);
    const theirs = cardsFromAnkiFields([note.text]).map((c) => [c.question, c.answer]);
    assert.deepEqual(ours, theirs, note.text);
  }
});

test('cloze lines with a Back Extra field keep it separately', () => {
  const result = parseAiFlashcards('{{c1::Paris}} is the capital of France;Geography\n{{c1::Rome}} is the capital of Italy;Geography');
  assert.deepEqual(result.clozeNotes[0], { text: '{{c1::Paris}} is the capital of France', extra: 'Geography' });
});

test('Anki writers: basic and cloze files carry the right headers and escaping', () => {
  const basic = toAnkiBasic([{ question: 'a < b & "c"', answer: 'line 1\nline 2' }], { deck: 'Bio' }).trimEnd().split('\n');
  assert.deepEqual(basic, ['#separator:tab', '#html:true', '#deck:Bio', '"a &lt; b &amp; ""c"""\t"line 1<br>line 2"']);
  const cloze = toAnkiCloze([{ text: '{{c1::ATP}} & energy', extra: '' }]).trimEnd().split('\n');
  assert.deepEqual(cloze, ['#separator:tab', '#html:true', '#notetype:Cloze', '"{{c1::ATP}} &amp; energy"\t""']);
});

test('CSV writer quotes only when needed', () => {
  assert.equal(toCsvCards([{ question: 'café, crème', answer: 'x' }]), 'Front,Back\r\n"café, crème",x\r\n');
});

test('handoff text is read back by the app’s own paste parser, alternatives included', () => {
  const cards = [
    { question: 'What is ATP?', answer: 'Adenosine triphosphate', acceptedAnswers: ['adenosine 5′-triphosphate'] },
    { question: 'Organelle that\nmakes ATP?', answer: 'Mitochondria', acceptedAnswers: [] }
  ];
  const parsed = parsePastedQuestions(toHandoffText(cards));
  assert.equal(parsed.cards.length, 2);
  assert.equal(parsed.cards[0].answer, 'Adenosine triphosphate');
  assert.deepEqual(parsed.cards[0].acceptedAnswers, ['adenosine 5′-triphosphate']);
  assert.equal(parsed.cards[1].question, 'Organelle that makes ATP?');
});

test('the suggested AI prompt’s own example parses as a card', () => {
  const example = AI_PROMPT.split('\n').slice(-2).join('\n');
  assert.deepEqual(pairs(parseAiFlashcards(example)), [['question', 'short answer']]);
});

test('the prompt shown on the page is exactly the one the code knows', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../chatgpt-to-anki/index.html', import.meta.url), 'utf8');
  const shown = html.match(/<pre id="aiPrompt">([\s\S]*?)<\/pre>/)[1]
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  assert.equal(shown, AI_PROMPT);
});
