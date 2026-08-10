# Deck Contract v1

Deck Contract v1 is the stable boundary between question ingestion and the existing samme3le study engine.

The goal is to let new ingestion methods be added without changing speech synthesis, speech recognition, local grading, session controls, wake lock, lock-screen review, or progress behavior.

## Canonical shape

```js
{
  version: 1,
  id: null,
  title: 'Cardiology Basics',
  source: {
    type: 'paste'
  },
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

## Required fields

A loadable deck must contain at least one card. Every card must contain a non-empty `question` and `answer`.

`acceptedAnswers` is optional and is normalized to an array. Duplicate alternatives and alternatives identical to the primary answer are removed.

`sourceRow` is retained when an importer has meaningful row or line numbers. It may be `null` for sources that do not use positions.

## Current source types

- `demo`
- `paste`
- `csv`
- `google-sheet`

Planned importers can add types such as `excel`, `builtin`, or other explicit source names without changing the study engine.

## Loader rule

Importers must call `loadDeck()` from `deck.js` before assigning cards to session state.

```js
const deck = loadDeck({
  title: 'Imported questions',
  source: { type: 'paste' },
  cards: parsedCards
});

state.currentDeck = deck;
state.questions = deck.cards;
```

Do not write a new importer that directly constructs `state.questions` from its own private format.

## Validation behavior

`normalizeDeck()` trims and canonicalizes input but does not silently remove incomplete cards.

`validateDeck()` returns structured errors and warnings. Missing questions or answers are errors. Exact duplicate question-answer pairs remain valid but produce a warning.

`loadDeck()` is strict: it normalizes, validates, and throws `DeckValidationError` if the deck cannot be safely handed to the study engine.

## Current ingestion paths

```text
Paste Q&A
   ↓
parsePastedQuestions()
   ↓
loadDeck()
   ↓
state.questions
   ↓
existing oral-recall engine
```

```text
Google Sheet / CSV
        ↓
parseDelimited()
        ↓
buildQuestionBank()
        ↓
loadDeck()
        ↓
state.questions
        ↓
existing oral-recall engine
```

Question order, source position, primary answers, and accepted alternatives must remain unchanged across this boundary. Regression tests in `test/deck.test.js` and `test/paste-data.test.js` enforce these invariants.

## Future ingestion rule

Every future source should terminate at the same boundary:

```text
Paste Q&A ─────────┐
Excel ─────────────┤
Built-in deck ─────┤
Google Sheet ──────┼→ Deck Contract v1 → existing study engine
CSV ───────────────┤
Future AI import ──┘
```

This makes ingestion replaceable while the study engine remains stable.
