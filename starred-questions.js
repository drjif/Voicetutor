function asPositiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

export function normalizeStarredQuestion(row = {}) {
  const sourceRow = asPositiveInteger(row.source_row ?? row.sourceRow);
  const savedSourceId = String(row.saved_source_id ?? row.savedSourceId ?? '').trim();
  if (!savedSourceId) throw new Error('A saved deck is required for a starred question.');
  if (!sourceRow) throw new Error('A positive source row is required for a starred question.');

  return {
    id: row.id ?? null,
    user_id: row.user_id ?? row.userId ?? null,
    saved_source_id: savedSourceId,
    source_row: sourceRow,
    created_at: row.created_at ?? row.createdAt ?? null
  };
}

export function starredRowsForSource(rows, savedSourceId) {
  const target = String(savedSourceId ?? '').trim();
  if (!target) return [];
  return [...new Set((rows ?? [])
    .filter((row) => String(row.saved_source_id ?? row.savedSourceId ?? '') === target)
    .map((row) => asPositiveInteger(row.source_row ?? row.sourceRow))
    .filter(Boolean))]
    .sort((left, right) => left - right);
}

export function starredCountsBySource(rows) {
  const counts = new Map();
  (rows ?? []).forEach((row) => {
    try {
      const normalized = normalizeStarredQuestion(row);
      counts.set(normalized.saved_source_id, (counts.get(normalized.saved_source_id) ?? 0) + 1);
    } catch {
      // Ignore malformed rows rather than breaking the rest of My decks.
    }
  });
  return counts;
}

export function createStarredQuestionRepository(client) {
  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    const user = data?.user;
    if (!user?.id) throw new Error('Sign in to use starred questions.');
    return user;
  }

  return {
    async listAll() {
      const user = await requireUser();
      const { data, error } = await client
        .from('starred_questions')
        .select('id,user_id,saved_source_id,source_row,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => normalizeStarredQuestion(row));
    },

    async listForSource(savedSourceId) {
      const user = await requireUser();
      const sourceId = String(savedSourceId ?? '').trim();
      if (!sourceId) return [];
      const { data, error } = await client
        .from('starred_questions')
        .select('id,user_id,saved_source_id,source_row,created_at')
        .eq('user_id', user.id)
        .eq('saved_source_id', sourceId)
        .order('source_row', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => normalizeStarredQuestion(row));
    },

    async add(savedSourceId, sourceRow) {
      const user = await requireUser();
      const payload = normalizeStarredQuestion({
        user_id: user.id,
        saved_source_id: savedSourceId,
        source_row: sourceRow
      });
      const { data, error } = await client
        .from('starred_questions')
        .insert({
          user_id: user.id,
          saved_source_id: payload.saved_source_id,
          source_row: payload.source_row
        })
        .select('id,user_id,saved_source_id,source_row,created_at')
        .single();
      if (error && error.code !== '23505') throw error;
      return error?.code === '23505' ? payload : normalizeStarredQuestion(data);
    },

    async remove(savedSourceId, sourceRow) {
      const user = await requireUser();
      const sourceId = String(savedSourceId ?? '').trim();
      const row = asPositiveInteger(sourceRow);
      if (!sourceId || !row) throw new Error('A saved deck and source row are required.');
      const { error } = await client
        .from('starred_questions')
        .delete()
        .eq('user_id', user.id)
        .eq('saved_source_id', sourceId)
        .eq('source_row', row);
      if (error) throw error;
    }
  };
}
