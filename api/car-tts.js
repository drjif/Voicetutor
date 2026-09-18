import { experimental_generateSpeech as generateSpeech } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../supabase-config.js';

const MODEL = 'fish-audio/s2.1-pro-free';
const VOICE = '933563129e564b19a115bedd57b7406a'; // Fish Audio English Sarah
const MAX_TEXT_LENGTH = 4000;

export const config = {
  maxDuration: 60
};

function bearerToken(request) {
  const header = String(request.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
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

  const body = request.body && typeof request.body === 'object' ? request.body : {};
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
    const result = await generateSpeech({
      model: gateway.speechModel(MODEL),
      text,
      voice: VOICE
    });

    const bytes = Buffer.from(result.audio.uint8Array);
    response.setHeader('Content-Type', result.audio.mediaType || 'audio/mpeg');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Car-TTS-Model', MODEL);
    response.status(200).send(bytes);
  } catch (error) {
    console.error('Car Mode TTS generation failed', {
      name: error?.name,
      message: error?.message
    });
    response.status(502).json({ error: 'Car Mode audio could not be generated right now.' });
  }
}
