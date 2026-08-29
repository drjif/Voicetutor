import { reconstructGoogleSheetUrls } from './sheet-data.js';

export const SAVED_SOURCE_TYPE = 'google-sheet';
export const SOURCE_TYPE_LABEL = 'Google Sheet';

function asPositiveInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

export function inferDeckDisplayName(input = {}) {
  const trimmed = String(input.displayName ?? input.display_name ?? '').replace(/\s+/g, ' ').trim();
  if (trimmed) return trimmed.slice(0, 120);
  return 'Google Sheet';
}

export function normalizeSavedSource(row = {}) {
  const spreadsheetId = String(row.spreadsheet_id ?? row.spreadsheetId ?? '').trim();
  const sheetGid = String(row.sheet_gid ?? row.sheetGid ?? row.gid ?? '0').trim() || '0';
  const sourceType = row.source_type ?? row.sourceType ?? SAVED_SOURCE_TYPE;
  const displayName = inferDeckDisplayName(row);

  if (sourceType !== SAVED_SOURCE_TYPE) {
    throw new Error('Account Sync v1 can only save Google Sheets.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) {
    throw new Error('A valid spreadsheet id is required.');
  }
  if (!/^[0-9]+$/.test(sheetGid)) {
    throw new Error('A valid sheet tab id is required.');
  }
  if (!displayName) {
    throw new Error('A deck name is required.');
  }

  return {
    id: row.id ?? null,
    user_id: row.user_id ?? row.userId ?? null,
    display_name: displayName,
    source_type: SAVED_SOURCE_TYPE,
    spreadsheet_id: spreadsheetId,
    sheet_gid: sheetGid,
    last_source_row: asPositiveInteger(row.last_source_row ?? row.lastSourceRow),
    last_opened_at: row.last_opened_at ?? row.lastOpenedAt ?? null,
    created_at: row.created_at ?? row.createdAt ?? null,
    updated_at: row.updated_at ?? row.updatedAt ?? null
  };
}

export function savedSourceIdentity(source) {
  const normalized = normalizeSavedSource(source);
  return `${normalized.source_type}:${normalized.spreadsheet_id}:${normalized.sheet_gid}`;
}

export function findDuplicateSavedSource(existing, incoming) {
  const target = savedSourceIdentity(incoming);
  return (existing ?? []).find((row) => {
    try {
      return savedSourceIdentity(row) === target;
    } catch {
      return false;
    }
  }) ?? null;
}

export function mergeSavedSource(existing, incoming) {
  const current = existing ? normalizeSavedSource(existing) : null;
  const next = normalizeSavedSource(incoming);
  if (current && savedSourceIdentity(current) !== savedSourceIdentity(next)) {
    throw new Error('Cannot merge different Google Sheets.');
  }
  return {
    ...current,
    ...next,
    id: current?.id ?? next.id,
    user_id: current?.user_id ?? next.user_id,
    created_at: current?.created_at ?? next.created_at,
    last_source_row: next.last_source_row ?? current?.last_source_row ?? null,
    last_opened_at: next.last_opened_at ?? current?.last_opened_at ?? null
  };
}

export function upsertSavedSources(existing, incoming) {
  const list = [...(existing ?? [])];
  const duplicate = findDuplicateSavedSource(list, incoming);
  if (duplicate) {
    const merged = mergeSavedSource(duplicate, incoming);
    return {
      action: 'update',
      record: merged,
      list: list.map((row) => (row === duplicate || row.id === duplicate.id ? merged : row))
    };
  }
  const record = normalizeSavedSource(incoming);
  return {
    action: 'insert',
    record,
    list: [record, ...list]
  };
}

export function toSavedSourceWritePayload(source, userId) {
  if (!userId) {
    throw new Error('Sign in to save this deck to your account.');
  }
  const normalized = normalizeSavedSource({ ...source, user_id: userId });
  return {
    user_id: userId,
    display_name: normalized.display_name,
    source_type: normalized.source_type,
    spreadsheet_id: normalized.spreadsheet_id,
    sheet_gid: normalized.sheet_gid,
    last_source_row: normalized.last_source_row,
    last_opened_at: normalized.last_opened_at ?? new Date().toISOString()
  };
}

export function reconstructSavedSourceRequest(source) {
  const normalized = normalizeSavedSource(source);
  const urls = reconstructGoogleSheetUrls(normalized.spreadsheet_id, normalized.sheet_gid);
  if (!urls) throw new Error('That saved sheet reference is incomplete.');
  return {
    ...normalized,
    ...urls,
    sourceLabel: SOURCE_TYPE_LABEL
  };
}

export function sortSavedSources(list) {
  return [...(list ?? [])].sort((left, right) => {
    const leftTime = Date.parse(left.last_opened_at || left.updated_at || left.created_at || 0) || 0;
    const rightTime = Date.parse(right.last_opened_at || right.updated_at || right.created_at || 0) || 0;
    return rightTime - leftTime;
  });
}

export function createSavedSourceRepository(client) {
  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    const user = data?.user;
    if (!user?.id) throw new Error('Sign in to use saved decks.');
    return user;
  }

  return {
    async list() {
      const user = await requireUser();
      const { data, error } = await client
        .from('saved_sources')
        .select('id,user_id,display_name,source_type,spreadsheet_id,sheet_gid,last_source_row,last_opened_at,created_at,updated_at')
        .eq('user_id', user.id)
        .order('last_opened_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return sortSavedSources((data ?? []).map((row) => normalizeSavedSource(row)));
    },

    async upsert(source) {
      const user = await requireUser();
      const existing = await this.list();
      const payload = toSavedSourceWritePayload(source, user.id);
      const duplicate = findDuplicateSavedSource(existing, payload);
      if (duplicate?.id) {
        const { data, error } = await client
          .from('saved_sources')
          .update({
            display_name: payload.display_name,
            last_source_row: payload.last_source_row,
            last_opened_at: payload.last_opened_at
          })
          .eq('id', duplicate.id)
          .eq('user_id', user.id)
          .select('id,user_id,display_name,source_type,spreadsheet_id,sheet_gid,last_source_row,last_opened_at,created_at,updated_at')
          .single();
        if (error) throw error;
        return { action: 'update', record: normalizeSavedSource(data) };
      }

      const { data, error } = await client
        .from('saved_sources')
        .insert(payload)
        .select('id,user_id,display_name,source_type,spreadsheet_id,sheet_gid,last_source_row,last_opened_at,created_at,updated_at')
        .single();
      if (error) throw error;
      return { action: 'insert', record: normalizeSavedSource(data) };
    },

    async rename(id, displayName) {
      const user = await requireUser();
      const payload = { display_name: inferDeckDisplayName({ displayName }) };
      const { data, error } = await client
        .from('saved_sources')
        .update(payload)
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id,user_id,display_name,source_type,spreadsheet_id,sheet_gid,last_source_row,last_opened_at,created_at,updated_at')
        .single();
      if (error) throw error;
      return normalizeSavedSource(data);
    },

    async remove(id) {
      const user = await requireUser();
      const { error } = await client
        .from('saved_sources')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },

    async touchProgress(id, patch = {}) {
      const user = await requireUser();
      const updates = {
        last_opened_at: patch.last_opened_at ?? new Date().toISOString()
      };
      if (patch.last_source_row != null) updates.last_source_row = asPositiveInteger(patch.last_source_row);
      const { data, error } = await client
        .from('saved_sources')
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id,user_id,display_name,source_type,spreadsheet_id,sheet_gid,last_source_row,last_opened_at,created_at,updated_at')
        .single();
      if (error) throw error;
      return normalizeSavedSource(data);
    }
  };
}
