import { gateway } from '@ai-sdk/gateway';
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../supabase-config.js';

const MODEL = 'fish-audio/s2.1-pro-free';
const VOICE = '933563129e564b19a115bedd57b7406a'; // Fish Audio English Sarah
const MAX_TEXT_LENGTH = 4000;

export const config = {
  maxDuration: 60
};

function bearerToken(request) {
  const header = String(request.headers?.authorization || request.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function requestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body !== 'string') return {};
  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

async function authenticatedUser(token) {
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

async function ownsSavedSource(token, savedSourceId) {
  if (!savedSourceId) return false;
  const url = new URL(`${SUPABASE_URL}/rest/v1/saved_sources`);
  url.searchParams.set('id', `eq.${savedSourceId}`);
  url.searchParams.set('select', 'id');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) return false;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function synthesize(text) {
  try {
    const result = await generateSpeech({
      model: gateway.speechModel(MODEL),
      text,
      voice: VOICE
    });

    const bytes = result?.audio?.uint8Array;
    if (!bytes?.length) {
      const error = new Error('AI Gateway speech response did not contain audio.');
      error.code = 'GATEWAY_AUDIO_MISSING';
      throw error;
    }
    return Buffer.from(bytes);
  } catch (error) {
    console.error('AI Gateway speech generation failed', {
      name: error?.name,
      message: error?.message,
      cause: error?.cause?.message
    });
    const wrapped = new Error('AI Gateway speech generation failed.');
    wrapped.code = 'GATEWAY_REQUEST_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = bearerToken(request);
  const user = await authenticatedUser(token);
  if (!user?.id) {
    response.status(401).json({ error: 'Sign in to generate Car Mode audio.' });
    return;
  }

  const body = requestBody(request);
  const text = String(body.text || '').replace(/\s+/g, ' ').trim();
  const savedSourceId = String(body.savedSourceId || '').trim();

  if (!text) {
    response.status(400).json({ error: 'Text is required.' });
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    response.status(400).json({ error: `Audio text is limited to ${MAX_TEXT_LENGTH} characters per segment.` });
    return;
  }
  if (!await ownsSavedSource(token, savedSourceId)) {
    response.status(403).json({ error: 'That saved deck is not available to this account.' });
    return;
  }

  try {
    const bytes = await synthesize(text);
    response.setHeader('Content-Type', 'audio/mpeg');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Car-TTS-Model', MODEL);
    response.status(200).send(bytes);
  } catch (error) {
    console.error('Car Mode TTS generation failed', {
      code: error?.code,
      name: error?.name,
      message: error?.message,
      cause: error?.cause?.message
    });
    response.status(502).json({ error: 'Car Mode audio could not be generated right now.' });
  }
}
