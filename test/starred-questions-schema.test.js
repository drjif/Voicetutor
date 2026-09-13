import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/202609120001_starred_questions.sql', import.meta.url);

test('starred questions migration uses minimal references and RLS', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /create table if not exists public\.starred_questions/i);
  assert.match(sql, /saved_source_id uuid not null references public\.saved_sources\(id\) on delete cascade/i);
  assert.match(sql, /source_row integer not null/i);
  assert.match(sql, /unique \(user_id, saved_source_id, source_row\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /auth\.uid\(\) = user_id/i);
  assert.match(sql, /source\.user_id = auth\.uid\(\)/i);
  assert.match(sql, /grant select, insert, delete on table public\.starred_questions to authenticated/i);

  assert.doesNotMatch(sql, /question_text|answer_text|transcript|raw_sheet_url|spreadsheet_id\s+text|audio\s+/i);
});
