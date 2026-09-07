function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function thinkingPause(seconds) {
  const beats = Math.max(1, Math.min(10, Math.round(Number(seconds) / 1.5)));
  return Array.from({ length: beats }, () => ' ...').join('');
}

export function createLockScreenCardTrack(item, index, thinkSeconds) {
  const pause = thinkingPause(thinkSeconds);
  let text = `Question ${index + 1}. ${cleanText(item?.question)}. Think about your answer.${pause} `;
  const answerCharIndex = text.length;
  text += `The answer is ${cleanText(item?.answer)}.`;
  return { text, answerCharIndex };
}

export function lockScreenCardPhase(answerCharIndex, charIndex) {
  if (!Number.isFinite(charIndex) || charIndex < 0) return 'question';
  return charIndex >= answerCharIndex ? 'answer' : 'question';
}

export function createLockScreenTrack(questions, startIndex, thinkSeconds) {
  let text = 'Lock-screen review starting. ';
  const markers = [];
  const pause = thinkingPause(thinkSeconds);

  questions.slice(startIndex).forEach((item, offset) => {
    const index = startIndex + offset;
    markers.push({ index, phase: 'question', charIndex: text.length });
    text += `Question ${index + 1}. ${cleanText(item.question)}. Think about your answer.${pause} `;
    markers.push({ index, phase: 'answer', charIndex: text.length });
    text += `The answer is ${cleanText(item.answer)}. `;
    if (index < questions.length - 1) text += 'Next question. ';
  });

  text += 'Review complete.';
  return { text, markers };
}

// Accept only the immediately expected phase marker, and only when the browser's
// charIndex lands inside that phase's own text window. A bogus end-of-utterance
// charIndex therefore cannot be interpreted as hundreds of completed questions.
export function advanceExpectedMarker(markers, cursor, charIndex) {
  if (!Array.isArray(markers) || !markers.length || !Number.isFinite(charIndex) || charIndex < 0) {
    return { cursor, marker: null };
  }

  const nextCursor = cursor + 1;
  const nextMarker = markers[nextCursor] ?? null;
  if (!nextMarker || charIndex < nextMarker.charIndex) {
    return { cursor, marker: null };
  }

  const followingMarker = markers[nextCursor + 1] ?? null;
  if (followingMarker && charIndex >= followingMarker.charIndex) {
    return { cursor, marker: null };
  }

  return { cursor: nextCursor, marker: nextMarker };
}

const markerCursorState = new WeakMap();

export function advanceMarkerCursor(markers, cursor, charIndex, previousCharIndex = -1) {
  if (!markers.length || !Number.isFinite(charIndex) || charIndex < 0) {
    return { cursor, marker: null, lastCharIndex: previousCharIndex };
  }

  if (charIndex <= previousCharIndex) {
    return { cursor, marker: null, lastCharIndex: previousCharIndex };
  }

  const nextCursor = cursor + 1;
  const nextMarker = markers[nextCursor] ?? null;
  if (!nextMarker || charIndex < nextMarker.charIndex) {
    return { cursor, marker: null, lastCharIndex: charIndex };
  }

  return {
    cursor: nextCursor,
    marker: nextMarker,
    lastCharIndex: charIndex
  };
}

export function markerForCharacter(markers, charIndex) {
  if (!Array.isArray(markers) || !markers.length) return null;

  const current = markerCursorState.get(markers) ?? {
    cursor: 0,
    lastCharIndex: -1
  };
  const next = advanceMarkerCursor(
    markers,
    current.cursor,
    charIndex,
    current.lastCharIndex
  );

  markerCursorState.set(markers, {
    cursor: next.cursor,
    lastCharIndex: next.lastCharIndex
  });

  return markers[next.cursor] ?? markers[0] ?? null;
}

export function lockScreenMetadataFields(item, index, total, phase = 'question') {
  const question = cleanText(item?.question) || `Question ${index + 1}`;
  const answer = cleanText(item?.answer);
  const showingAnswer = phase === 'answer' || phase === 'feedback';

  return {
    title: question,
    artist: showingAnswer && answer ? `Answer: ${answer}` : 'Think about your answer',
    album: `same3le · Question ${index + 1} of ${total}`
  };
}
