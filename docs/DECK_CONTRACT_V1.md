# Deck Contract v1

Deck Contract v1 is the stable boundary between question ingestion and the existing samme3le study engine.

The goal is to add ingestion methods without changing speech synthesis, speech recognition, local grading, session controls, wake lock, lock-screen review, or progress behavior.

## Canonical shape

```js
{
  version: 1,
  id: null,
  title: 'Cardiology Basics',
  source: { type: 'paste' },
  cards: [
    {
      id: 'card-1',
      sourceRow: 1,
      question: 'What chamber pumps blood to the lungs?',
      answer: 'Right ventricle',
      acceptedAnswers: ['RV']
    }
  ]
}
```

A loadable deck must contain at least one card, and every card must contain non-empty `question` and `answer` fields. `acceptedAnswers` is optional. `sourceRow` may represent a spreadsheet row, text line, or source-note position.

## Current source types

Current importers use explicit source types including:

- `demo`
- `paste`
- `google-sheet`
- `csv` for the legacy gated CSV path
- `local-csv`
- `local-tsv`
- `local-text`
- `anki-text`
- `xlsx`
- `anki`

Additional source types can be added without changing the study engine.

## Loader rule

Every importer must call `loadDeck()` from `deck.js` before assigning cards to session state.

```js
const deck = loadDeck({
  title: 'Imported questions',
  source: { type: 'xlsx' },
  cards: parsedCards
});

state.currentDeck = deck;
state.questions = deck.cards;
```

Do not write a new importer that bypasses this boundary.

## Validation behavior

`normalizeDeck()` trims and canonicalizes input but does not silently remove incomplete cards. `validateDeck()` reports missing questions or answers as errors and exact duplicate Q&A pairs as warnings. `loadDeck()` is strict and throws `DeckValidationError` if a deck cannot safely reach the study engine.

## Current ingestion architecture

```text
Built-in demo ───────────┐
Paste Q&A ───────────────┤
Excel .xlsx ─────────────┤
Anki .apkg ──────────────┤
CSV / TSV / TXT ─────────┼→ normalize / validate → Deck Contract v1
Anki text export ────────┤                         ↓
Google Sheet ────────────┘                   state.questions
                                                   ↓
                                      existing oral-recall engine
```

Row-based sources first pass through `buildQuestionBank()` after column detection. Direct-card sources such as pasted Q&A and Anki packages create ordinary card records and then pass them through `loadDeck()`.

Question order, source position, primary answers, and accepted alternatives must remain stable across the contract. Regression tests under `test/` enforce the core invariants.

This makes ingestion replaceable while the spoken study engine remains stable.
