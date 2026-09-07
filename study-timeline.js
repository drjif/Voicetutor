function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function thinkingPause(seconds) {
  const beats = Math.max(1, Math.min(10, Math.round(Number(seconds) / 1.5)));
  return Array.from({ length: beats }, () => ' ...').join('');
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

export function markerForCharacter(markers, charIndex) {
  let matched = markers[0] ?? null;
  for (const marker of markers) {
    if (marker.charIndex > charIndex) break;
    matched = marker;
  }
  return matched;
}

// SpeechSynthesis boundary events are browser/OS supplied and are not perfectly
// consistent. Some engines can emit a late or end-of-utterance charIndex after a
// cancel/restart. Never let one boundary event skip across multiple study phases
// or questions. The caller advances at most one marker per strictly increasing
// boundary event; normal word-boundary streams catch up naturally on later events.
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
