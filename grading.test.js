import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeTranscriptAlternatives } from './grading.js';

test('recognizes an acronym-only answer as partial for a multi-part item', () => {
  const result = gradeTranscriptAlternatives(
    [{ transcript: 'EGFR', confidence: 0.9 }],
    'EGFR (epidermal growth factor receptor) overstimulation; causes hypertrophied gastric folds, excess mucus, hypoproteinemia, achlorhydria'
  );

  assert.equal(result.outcome, 'partial');
  assert.equal(result.matchedAnswer, 'EGFR');
});

test('accepts the major concepts of a multi-part answer without exact wording', () => {
  const result = gradeTranscriptAlternatives(
    [{
      transcript: 'EGFR overstimulation with hypertrophied gastric folds, excess mucus, hypoproteinemia and achlorhydria',
      confidence: 0.82
    }],
    'EGFR (epidermal growth factor receptor) overstimulation; causes hypertrophied gastric folds, excess mucus, hypoproteinemia, achlorhydria'
  );

  assert.equal(result.outcome, 'correct');
});

test('uses a lower-ranked recognition alternative when it matches the answer', () => {
  const result = gradeTranscriptAlternatives(
    [
      { transcript: 'Donald catheter', confidence: 0.72 },
      { transcript: 'tunneled catheter', confidence: 0.43 }
    ],
    'Tunneled central venous catheter (fewer lumens preferred)'
  );

  assert.equal(result.outcome, 'correct');
  assert.equal(result.transcript, 'tunneled catheter');
});

test('does not accept a different catheter type merely because catheter overlaps', () => {
  const result = gradeTranscriptAlternatives(
    [{ transcript: 'PICC catheter', confidence: 0.88 }],
    'Tunneled central venous catheter (fewer lumens preferred)'
  );

  assert.equal(result.outcome, 'incorrect');
});

test('explicit accepted alternatives count as complete answers', () => {
  const result = gradeTranscriptAlternatives(
    [{ transcript: 'anti TNF antibody', confidence: 0.78 }],
    'A monoclonal antibody that binds tumor necrosis factor alpha',
    ['anti-TNF antibody']
  );

  assert.equal(result.outcome, 'correct');
});
