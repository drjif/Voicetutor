export const CAR_AUDIO_MODEL = 'fish-audio/s2.1-pro-free';
export const CAR_AUDIO_VOICE = '933563129e564b19a115bedd57b7406a';
export const CAR_AUDIO_BUCKET = 'car-audio';
export const CAR_AUDIO_VERSION = 'v1';
const SIGNED_URL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

function normalizeSpeechText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function sha256(value) {
  const bytes = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function speechHash(text) {
  return sha256(`${CAR_AUDIO_VERSION}|${CAR_AUDIO_MODEL}|${CAR_AUDIO_VOICE}|${normalizeSpeechText(text)}`);
}

function validSourceRow(value) {
  const row = Number(value);
  return Number.isInteger(row) && row > 0 ? row : null;
}

function objectPath(userId, savedSourceId, sourceRow, kind, hash) {
  return `${userId}/${savedSourceId}/${sourceRow}/${kind}-${hash}.mp3`;
}

function audioError(message, cause) {
  const error = new Error(message);
  if (cause) error.cause = cause;
  return error;
}

function signedUrlMap(data = []) {
  const map = new Map();
  for (const row of data || []) {
    if (row?.path && row?.signedUrl) map.set(row.path, row.signedUrl);
  }
  return map;
}

export function createCarAudioRepository(client, user) {
  if (!client) throw new Error('A Supabase client is required for Car Mode audio.');
  if (!user?.id) throw new Error('Sign in to use Car Mode audio.');

  const inflight = new Map();

  async function sessionToken() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const token = data?.session?.access_token;
    if (!token) throw new Error('Your sign-in session expired. Sign in again to generate Car Mode audio.');
    return token;
  }

  async function createSignedUrls(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return new Map();
    const { data, error } = await client.storage
      .from(CAR_AUDIO_BUCKET)
      .createSignedUrls(unique, SIGNED_URL_SECONDS);
    if (error) throw error;
    return signedUrlMap(data);
  }

  async function expectedHashes(card) {
    return {
      question: await speechHash(card.question),
      answer: await speechHash(card.answer)
    };
  }

  async function listMetadata(savedSourceId) {
    const { data, error } = await client
      .from('car_audio_assets')
      .select('id,user_id,saved_source_id,source_row,question_hash,question_path,answer_hash,answer_path,model,voice,created_at,updated_at')
      .eq('saved_source_id', savedSourceId)
      .order('source_row', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async function loadForSource(savedSourceId, cards) {
    const metadata = await listMetadata(savedSourceId);
    const byRow = new Map(metadata.map((row) => [Number(row.source_row), row]));
    const valid = [];

    await Promise.all((cards ?? []).map(async (card) => {
      const sourceRow = validSourceRow(card.sourceRow);
      const stored = sourceRow ? byRow.get(sourceRow) : null;
      if (!stored) return;
      const hashes = await expectedHashes(card);
      if (
        stored.question_hash === hashes.question
        && stored.answer_hash === hashes.answer
        && stored.model === CAR_AUDIO_MODEL
        && stored.voice === CAR_AUDIO_VOICE
      ) {
        valid.push({ sourceRow, stored, hashes });
      }
    }));

    const urls = await createSignedUrls(valid.flatMap(({ stored }) => [stored.question_path, stored.answer_path]));
    const result = new Map();
    for (const { sourceRow, stored, hashes } of valid) {
      const question = urls.get(stored.question_path);
      const answer = urls.get(stored.answer_path);
      if (!question || !answer) continue;
      result.set(sourceRow, {
        question,
        answer,
        questionHash: hashes.question,
        answerHash: hashes.answer,
        questionPath: stored.question_path,
        answerPath: stored.answer_path
      });
    }
    return result;
  }

  async function generateSpeech(text, savedSourceId) {
    const token = await sessionToken();
    const response = await fetch('../api/car-tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: normalizeSpeechText(text),
        savedSourceId
      })
    });
    if (!response.ok) {
      let message = 'Car Mode audio generation failed.';
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the generic error if the response was not JSON.
      }
      throw audioError(message);
    }
    return response.blob();
  }

  async function upload(path, blob) {
    const { error } = await client.storage
      .from(CAR_AUDIO_BUCKET)
      .upload(path, blob, {
        cacheControl: '31536000',
        contentType: 'audio/mpeg',
        upsert: true
      });
    if (error) throw error;
  }

  async function metadataForRow(savedSourceId, sourceRow) {
    const { data, error } = await client
      .from('car_audio_assets')
      .select('id,user_id,saved_source_id,source_row,question_hash,question_path,answer_hash,answer_path,model,voice,created_at,updated_at')
      .eq('saved_source_id', savedSourceId)
      .eq('source_row', sourceRow)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async function ensureCardUncached(savedSourceId, card) {
    const sourceRow = validSourceRow(card?.sourceRow);
    if (!sourceRow) throw new Error('This question does not have a stable source row for Car Mode.');
    const hashes = await expectedHashes(card);
    const existing = await metadataForRow(savedSourceId, sourceRow);

    if (
      existing
      && existing.question_hash === hashes.question
      && existing.answer_hash === hashes.answer
      && existing.model === CAR_AUDIO_MODEL
      && existing.voice === CAR_AUDIO_VOICE
    ) {
      const urls = await createSignedUrls([existing.question_path, existing.answer_path]);
      const question = urls.get(existing.question_path);
      const answer = urls.get(existing.answer_path);
      if (question && answer) {
        return {
          question,
          answer,
          questionHash: hashes.question,
          answerHash: hashes.answer,
          questionPath: existing.question_path,
          answerPath: existing.answer_path
        };
      }
    }

    const questionPath = objectPath(user.id, savedSourceId, sourceRow, 'q', hashes.question);
    const answerPath = objectPath(user.id, savedSourceId, sourceRow, 'a', hashes.answer);
    const [questionBlob, answerBlob] = await Promise.all([
      generateSpeech(card.question, savedSourceId),
      generateSpeech(card.answer, savedSourceId)
    ]);
    await Promise.all([
      upload(questionPath, questionBlob),
      upload(answerPath, answerBlob)
    ]);

    const payload = {
      user_id: user.id,
      saved_source_id: savedSourceId,
      source_row: sourceRow,
      question_hash: hashes.question,
      question_path: questionPath,
      answer_hash: hashes.answer,
      answer_path: answerPath,
      model: CAR_AUDIO_MODEL,
      voice: CAR_AUDIO_VOICE,
      updated_at: new Date().toISOString()
    };
    const { error: metadataError } = await client
      .from('car_audio_assets')
      .upsert(payload, { onConflict: 'user_id,saved_source_id,source_row' });
    if (metadataError) throw metadataError;

    const stalePaths = [existing?.question_path, existing?.answer_path]
      .filter((path) => path && path !== questionPath && path !== answerPath);
    if (stalePaths.length) {
      client.storage.from(CAR_AUDIO_BUCKET).remove(stalePaths).catch((error) => {
        console.warn('Old Car Mode audio could not be removed', error);
      });
    }

    const urls = await createSignedUrls([questionPath, answerPath]);
    const question = urls.get(questionPath);
    const answer = urls.get(answerPath);
    if (!question || !answer) throw new Error('Car Mode audio was generated but could not be opened.');
    return {
      question,
      answer,
      questionHash: hashes.question,
      answerHash: hashes.answer,
      questionPath,
      answerPath
    };
  }

  async function ensureCard(savedSourceId, card) {
    const sourceRow = validSourceRow(card?.sourceRow);
    if (!sourceRow) throw new Error('This question cannot be prepared for Car Mode.');
    const key = `${savedSourceId}:${sourceRow}`;
    if (inflight.has(key)) return inflight.get(key);
    const promise = ensureCardUncached(savedSourceId, card)
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return {
    loadForSource,
    ensureCard
  };
}
