import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const initial = readFileSync(join(root, 'supabase/migrations/202608010001_initial_accounts.sql'), 'utf8');
const savedSources = readFileSync(join(root, 'supabase/migrations/202608270001_saved_sources.sql'), 'utf8');
const revokeDefiner = readFileSync(join(root, 'supabase/migrations/202608290001_revoke_definer_execute.sql'), 'utf8');
const dmlGrants = readFileSync(join(root, 'supabase/migrations/202608290002_grant_authenticated_dml.sql'), 'utf8');

test('saved_sources depends on the existing updated-at helper instead of duplicating it', () => {
  assert.match(initial, /create or replace function public\.set_updated_at\(\)/i);
  assert.match(savedSources, /execute function public\.set_updated_at\(\)/i);
  assert.doesNotMatch(savedSources, /create or replace function public\.set_updated_at/i);
});

test('saved_sources stores only Google Sheet identifiers and lightweight progress', () => {
  const tableBody = savedSources.slice(
    savedSources.indexOf('create table if not exists public.saved_sources'),
    savedSources.indexOf('create index if not exists saved_sources_user_updated_at_idx')
  );
  assert.match(tableBody, /source_type text not null check \(source_type in \('google-sheet'\)\)/);
  assert.match(tableBody, /spreadsheet_id text not null/);
  assert.match(tableBody, /sheet_gid text not null default '0'/);
  assert.match(tableBody, /last_source_row integer/);
  assert.match(tableBody, /last_opened_at timestamptz/);
  assert.match(tableBody, /unique \(user_id, source_type, spreadsheet_id, sheet_gid\)/);
  assert.doesNotMatch(tableBody, /\burl\b/);
  assert.doesNotMatch(tableBody, /question_text|answer_text|audio|transcript|phi/i);
});

test('saved_sources enables RLS with owner-only select insert update delete policies', () => {
  assert.match(savedSources, /alter table public\.saved_sources enable row level security/i);
  for (const action of ['select', 'insert', 'update', 'delete']) {
    assert.match(savedSources, new RegExp(`on public\\.saved_sources for ${action}`, 'i'));
  }
  assert.match(savedSources, /using \(auth\.uid\(\) = user_id\)/);
  assert.match(savedSources, /with check \(auth\.uid\(\) = user_id\)/);
  assert.doesNotMatch(savedSources, /to anon/);
  assert.doesNotMatch(savedSources, /using \(true\)/);
});

test('definer helpers are not executable by anon or authenticated', () => {
  assert.match(revokeDefiner, /revoke execute on function public\.handle_new_user\(\) from public, anon, authenticated/i);
});

test('authenticated receives saved_sources DML grants while anon stays select-only', () => {
  assert.match(dmlGrants, /grant select, insert, update, delete on table public\.saved_sources to authenticated/i);
  assert.match(dmlGrants, /grant select on table public\.saved_sources to anon/i);
  assert.doesNotMatch(dmlGrants, /grant (select, )?(insert|update|delete).*on table public\.saved_sources to anon/i);
  assert.match(dmlGrants, /grant select on table public\.subscription_entitlements to authenticated/i);
  assert.doesNotMatch(
    dmlGrants,
    /grant select, insert on table public\.subscription_entitlements to authenticated/i
  );
});

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

test('frontend config and source files do not commit secrets', () => {
  const files = [
    'supabase-config.js',
    'auth.js',
    'saved-sources.js',
    'account-ui.js',
    'app.js',
    'index.html'
  ];
  const secretPattern = /service_role\s*[:=]|service_role_key|"role"\s*:\s*"service_role"|postgres(ql)?:\/\/[^:]+:[^@]+@|DATABASE_PASSWORD\s*[:=]|JWT_SECRET\s*[:=]/i;
  const jwtPattern = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  for (const relativePath of files) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.equal(secretPattern.test(source), false, `${relativePath} appears to contain a secret`);
    const tokens = source.match(jwtPattern) ?? [];
    for (const token of tokens) {
      assert.equal(relativePath, 'supabase-config.js', `${relativePath} must not contain a JWT`);
      const payload = decodeJwtPayload(token);
      assert.equal(payload?.role, 'anon', 'supabase-config.js may only embed the anon JWT');
    }
  }
});
