// Public browser configuration only.
// NEVER add a service-role key, database password, Postgres URI, or JWT secret here.

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
export const AUTH_SITE_URL = 'https://tutor.gi-jad.com';

export const LEGAL_POLICY_VERSIONS = {
  terms: '2026-08-01',
  privacy: '2026-08-15',
  acceptableUse: '2026-08-01'
};

export function isSupabaseConfigured(url = SUPABASE_URL, anonKey = SUPABASE_ANON_KEY) {
  const trimmedUrl = String(url ?? '').trim();
  const trimmedKey = String(anonKey ?? '').trim();
  if (!trimmedUrl || !trimmedKey) return false;
  if (/YOUR_|REPLACE_|TODO|example\.supabase/i.test(`${trimmedUrl} ${trimmedKey}`)) return false;
  try {
    const parsed = new URL(trimmedUrl);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co') && trimmedKey.length > 20;
  } catch {
    return false;
  }
}

export function getAuthRedirectUrl(locationLike = globalThis.location) {
  const origin = String(locationLike?.origin ?? '').replace(/\/$/, '');
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return `${origin}/`;
  return `${AUTH_SITE_URL}/`;
}
