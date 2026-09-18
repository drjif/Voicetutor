import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../supabase-config.js';

const MODEL = 'fish-audio/s2.1-pro-free';
const VOICE = '933563129e564b19a115bedd57b7406a'; // Fish Audio English Sarah
const MAX_TEXT_LENGTH = 4000;
const AI_GATEWAY_SPEECH_URL = 'https://ai-gateway.vercel.sh/v4/ai/speech-model';

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
  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) {
    const error = new Error('AI Gateway authentication is not configured for this deployment.');
    error.code = 'GATEWAY_AUTH_MISSING';
    throw error;
  }

  const response = await fetch(AI_GATEWAY_SPEECH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      'Content-Type': 'application/json',
      'ai-model-id': MODEL
    },
    body: JSON.stringify({
      text,
      voice: VOICE,
      outputFormat: 'mp3'
    })
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    console.error('AI Gateway speech request failed', {
      status: response.status,
      detail
    });
    const error = new Error(`AI Gateway returned HTTP ${response.status}`);
    error.code = 'GATEWAY_REQUEST_FAILED';
    throw error;
  }

  const payload = await response.json();
  if (!payload?.audio || typeof payload.audio !== 'string') {
    const error = new Error('AI Gateway speech response did not contain audio.');
    error.code = 'GATEWAY_AUDIO_MISSING';
    throw error;
  }
  return Buffer.from(payload.audio, 'base64');
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
      message: error?.message
    });
    if (error?.code === 'GATEWAY_AUTH_MISSING') {
      response.status(503).json({ error: 'Car Mode audio generation is not configured on this deployment yet.' });
      return;
    }
    response.status(502).json({ error: 'Car Mode audio could not be generated right now.' });
  }
}
