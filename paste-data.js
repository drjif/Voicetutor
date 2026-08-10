function clean(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function stripFence(text) {
  return clean(text)
    .replace(/^```(?:text|txt|markdown|md|csv|tsv)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function splitAlternatives(value) {
  return String(value ?? '')
    .split(/\||;|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeCard(question, answer, acceptedAnswers, sourceRow) {
  return {
    sourceRow,
    question: clean(question),
    answer: clean(answer),
    acceptedAnswers: splitAlternatives(acceptedAnswers)
  };
}

function meaningfulLines(text) {
  return text.split('\n').map((raw, index) => ({
    raw,
    text: raw.trim(),
    line: index + 1
  }));
}

function stripLeadingMarkdown(value) {
  return value
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim();
}

function labeledMatch(value, kind) {
  const cleaned = stripLeadingMarkdown(value)
    .replace(/\*\*/g, '')
    .replace(/__/g, '');
  const patterns = kind === 'question'
    ? [/^(?:q|question)\s*[:.\-]\s*(.+)$/i]
    : kind === 'answer'
      ? [/^(?:a|answer)\s*[:.\-]\s*(.+)$/i]
      : [/^(?:alt|alts|alternative|alternatives|accepted|accepted answers?|synonym|synonyms)\s*[:.\-]\s*(.+)$/i];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function parseLabeled(text) {
  const lines = meaningfulLines(text);
  const cards = [];
  let current = null;
  let labelHits = 0;

  const flush = () => {
    if (current?.question && current?.answer) {
      cards.push(makeCard(
        current.question,
        current.answer,
        current.alternatives.join('|'),
        current.sourceRow
      ));
    }
    current = null;
  };

  for (const line of lines) {
    if (!line.text) continue;

    const question = labeledMatch(line.text, 'question');
    if (question) {
      labelHits += 1;
      flush();
      current = { question, answer: '', alternatives: [], sourceRow: line.line };
      continue;
    }

    const answer = labeledMatch(line.text, 'answer');
    if (answer) {
      labelHits += 1;
      if (!current) current = { question: '', answer: '', alternatives: [], sourceRow: line.line };
      current.answer = answer;
      continue;
    }

    const alternative = labeledMatch(line.text, 'alternative');
    if (alternative) {
      labelHits += 1;
      if (current) current.alternatives.push(alternative);
      continue;
    }

    if (current?.answer) {
      current.answer = `${current.answer} ${line.text}`.trim();
    } else if (current?.question) {
      current.question = `${current.question} ${line.text}`.trim();
    }
  }

  flush();
  return { cards, confidence: labelHits >= 2 ? 0.95 : 0, format: 'Q / A labels' };
}

function headerLike(first, second) {
  const q = clean(first).toLowerCase().replace(/[^a-z]/g, '');
  const a = clean(second).toLowerCase().replace(/[^a-z]/g, '');
  return ['q', 'question', 'questiontext', 'prompt', 'stem'].includes(q)
    && ['a', 'answer', 'correctanswer', 'response'].includes(a);
}

function parseDelimitedLines(text) {
  const nonEmpty = meaningfulLines(text).filter((line) => line.text);
  const delimiters = ['\t', '|'];
  let best = { cards: [], confidence: 0, format: null };

  for (const delimiter of delimiters) {
    const parsed = [];
    let validRows = 0;
    let candidateRows = 0;

    nonEmpty.forEach((line) => {
      if (!line.raw.includes(delimiter)) return;
      candidateRows += 1;
      const parts = line.raw.split(delimiter).map((part) => part.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) return;
      validRows += 1;
      parsed.push({ parts, line: line.line });
    });

    if (!parsed.length) continue;
    if (headerLike(parsed[0].parts[0], parsed[0].parts[1])) parsed.shift();
    const cards = parsed
      .filter(({ parts }) => parts[0] && parts[1])
      .map(({ parts, line }) => makeCard(parts[0], parts[1], parts.slice(2).join('|'), line));

    const ratio = candidateRows ? validRows / candidateRows : 0;
    const confidence = cards.length && ratio >= 0.75 ? 0.9 : cards.length >= 2 ? 0.72 : 0;
    if (confidence > best.confidence) {
      best = {
        cards,
        confidence,
        format: delimiter === '\t' ? 'tab-separated rows' : 'pipe-separated rows'
      };
    }
  }

  return best;
}

function parseBlankBlocks(text) {
  const blocks = text
    .split(/\n\s*\n+/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter(Boolean);

  const cards = [];
  let sourceLine = 1;
  for (const block of blocks) {
    if (block.length !== 2) {
      sourceLine += block.length + 1;
      continue;
    }
    const question = stripLeadingMarkdown(block[0]);
    const answer = stripLeadingMarkdown(block[1]);
    if (question && answer) cards.push(makeCard(question, answer, [], sourceLine));
    sourceLine += block.length + 1;
  }

  const allBlocksPaired = cards.length > 0 && cards.length === blocks.length;
  const confidence = allBlocksPaired ? (cards.length >= 2 ? 0.68 : 0.52) : 0;
  return { cards, confidence, format: 'question / answer blocks' };
}

function parseAlternatingLines(text) {
  const lines = meaningfulLines(text).filter((line) => line.text);
  if (lines.length < 4 || lines.length % 2 !== 0) {
    return { cards: [], confidence: 0, format: null };
  }

  const cards = [];
  for (let index = 0; index < lines.length; index += 2) {
    const question = stripLeadingMarkdown(lines[index].text);
    const answer = stripLeadingMarkdown(lines[index + 1].text);
    if (!question || !answer) return { cards: [], confidence: 0, format: null };
    cards.push(makeCard(question, answer, [], lines[index].line));
  }

  return { cards, confidence: 0.48, format: 'alternating question / answer lines' };
}

export function parsePastedQuestions(input) {
  const text = stripFence(input);
  if (!text) {
    return {
      cards: [],
      format: null,
      confidence: 0,
      message: 'Paste at least one question and answer.'
    };
  }

  const strategies = [
    parseLabeled(text),
    parseDelimitedLines(text),
    parseBlankBlocks(text),
    parseAlternatingLines(text)
  ];
  const best = strategies.sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return right.cards.length - left.cards.length;
  })[0];

  if (!best?.cards?.length || best.confidence < 0.45) {
    return {
      cards: [],
      format: null,
      confidence: 0,
      message: 'I could not reliably find question-answer pairs. Use Q: / A:, one Question | Answer pair per line, or paste two-column rows from a spreadsheet.'
    };
  }

  return {
    cards: best.cards,
    format: best.format,
    confidence: best.confidence,
    message: `Found ${best.cards.length} question${best.cards.length === 1 ? '' : 's'} using ${best.format}.`
  };
}
