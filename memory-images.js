export const MEMORY_IMAGE_BUCKET = 'memory-images';
export const MEMORY_IMAGE_TARGET_BYTES = 500 * 1024;
export const MEMORY_IMAGE_HARD_LIMIT_BYTES = 1024 * 1024;
export const MEMORY_IMAGE_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MEMORY_IMAGE_MAX_EDGE = 1600;
export const MEMORY_IMAGE_SIGNED_URL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();
const MEMORY_IMAGE_COLUMNS = 'id,user_id,saved_source_id,source_row,question_hash,question_text,answer_text,image_hash,storage_path,mime_type,byte_size,width,height,created_at,updated_at';

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function fingerprintText(value) {
  return cleanText(value).replace(/\s+/g, ' ');
}

function asPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function asFiniteDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api?.subtle) throw new Error('Secure image hashing is unavailable in this browser.');
  return api;
}

async function sha256Bytes(bytes) {
  const digest = await cryptoApi().subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

export async function sha256Text(value) {
  return sha256Bytes(encoder.encode(String(value ?? '')));
}

export async function sha256Blob(blob) {
  return sha256Bytes(await blob.arrayBuffer());
}

export async function cardFingerprint(card = {}) {
  const question = fingerprintText(card.question);
  const answer = fingerprintText(card.answer);
  return sha256Text(`${question}\u0000${answer}`);
}

export function fitImageDimensions(width, height, maxEdge = MEMORY_IMAGE_MAX_EDGE) {
  const sourceWidth = asFiniteDimension(width);
  const sourceHeight = asFiniteDimension(height);
  const limit = asFiniteDimension(maxEdge);
  if (!sourceWidth || !sourceHeight || !limit) {
    throw new Error('Image dimensions must be positive numbers.');
  }
  const longest = Math.max(sourceWidth, sourceHeight);
  if (longest <= limit) return { width: sourceWidth, height: sourceHeight };
  const scale = limit / longest;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

export function memoryImageExtension(mimeType) {
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg') return 'jpg';
  throw new Error('Memory images must be WebP or JPEG.');
}

export function memoryImageObjectPath(userId, imageHash, mimeType = 'image/webp') {
  const user = String(userId ?? '').trim();
  const hash = String(imageHash ?? '').trim().toLowerCase();
  if (!user) throw new Error('A user id is required for memory-image storage.');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('A valid image hash is required.');
  return `${user}/${hash}.${memoryImageExtension(mimeType)}`;
}

export function normalizeMemoryImageAsset(row = {}) {
  const sourceRow = asPositiveInteger(row.source_row ?? row.sourceRow);
  const savedSourceId = String(row.saved_source_id ?? row.savedSourceId ?? '').trim();
  const imageHash = String(row.image_hash ?? row.imageHash ?? '').trim().toLowerCase();
  const questionHash = String(row.question_hash ?? row.questionHash ?? '').trim().toLowerCase();
  const storagePath = String(row.storage_path ?? row.storagePath ?? '').trim();
  const mimeType = String(row.mime_type ?? row.mimeType ?? '').trim().toLowerCase();
  const byteSize = asPositiveInteger(row.byte_size ?? row.byteSize);
  const width = asPositiveInteger(row.width);
  const height = asPositiveInteger(row.height);

  if (!savedSourceId) throw new Error('A saved deck is required for a memory image.');
  if (!sourceRow) throw new Error('A positive source row is required for a memory image.');
  if (!/^[a-f0-9]{64}$/.test(questionHash)) throw new Error('A valid question fingerprint is required.');
  if (!/^[a-f0-9]{64}$/.test(imageHash)) throw new Error('A valid image hash is required.');
  if (!storagePath) throw new Error('A storage path is required for a memory image.');
  if (!['image/webp', 'image/jpeg'].includes(mimeType)) throw new Error('Unsupported memory-image type.');
  if (!byteSize || byteSize > MEMORY_IMAGE_HARD_LIMIT_BYTES) throw new Error('Memory image exceeds the storage limit.');
  if (!width || !height) throw new Error('Memory image dimensions are required.');

  return {
    id: row.id ?? null,
    user_id: row.user_id ?? row.userId ?? null,
    saved_source_id: savedSourceId,
    source_row: sourceRow,
    question_hash: questionHash,
    question_text: cleanText(row.question_text ?? row.questionText),
    answer_text: cleanText(row.answer_text ?? row.answerText),
    image_hash: imageHash,
    storage_path: storagePath,
    mime_type: mimeType,
    byte_size: byteSize,
    width,
    height,
    created_at: row.created_at ?? row.createdAt ?? null,
    updated_at: row.updated_at ?? row.updatedAt ?? null
  };
}

export function filterMemoryImagesBySource(assets, savedSourceId = '') {
  const target = String(savedSourceId ?? '').trim();
  const normalized = (assets ?? []).map((asset) => normalizeMemoryImageAsset(asset));
  if (!target) return normalized;
  return normalized.filter((asset) => asset.saved_source_id === target);
}

export function reviewImageModel({ assets = [], savedSourceId = '', index = 0, revealQuestion = false, revealAnswer = false } = {}) {
  const filtered = filterMemoryImagesBySource(assets, savedSourceId);
  const safeIndex = filtered.length ? Math.min(Math.max(Number(index) || 0, 0), filtered.length - 1) : 0;
  return {
    assets: filtered,
    index: safeIndex,
    total: filtered.length,
    current: filtered[safeIndex] ?? null,
    canPrevious: safeIndex > 0,
    canNext: safeIndex < filtered.length - 1,
    showQuestion: Boolean(revealQuestion),
    showAnswer: Boolean(revealAnswer)
  };
}

async function loadImageSource(file) {
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await globalThis.createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup() { bitmap.close?.(); }
    };
  }

  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error('This browser cannot decode the selected image.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The selected image could not be decoded.'));
      image.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      cleanup() { URL.revokeObjectURL(objectUrl); }
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function drawCanvas(source, width, height, { whiteBackground = false } = {}) {
  if (typeof document === 'undefined') throw new Error('Image optimization requires a browser canvas.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: !whiteBackground });
  if (!context) throw new Error('Image optimization could not start.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (whiteBackground) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('The image could not be compressed.'));
      else resolve(blob);
    }, type, quality);
  });
}

async function encodeCandidate(source, dimensions, quality, preferredType) {
  let canvas = drawCanvas(source, dimensions.width, dimensions.height);
  let blob = await canvasBlob(canvas, preferredType, quality);
  let mimeType = blob.type;

  if (preferredType === 'image/webp' && mimeType !== 'image/webp') {
    canvas = drawCanvas(source, dimensions.width, dimensions.height, { whiteBackground: true });
    blob = await canvasBlob(canvas, 'image/jpeg', Math.min(0.9, quality + 0.04));
    mimeType = 'image/jpeg';
  }

  if (!['image/webp', 'image/jpeg'].includes(mimeType)) {
    throw new Error('This browser cannot create a compact WebP or JPEG image.');
  }

  return {
    blob,
    byteSize: blob.size,
    width: dimensions.width,
    height: dimensions.height,
    quality,
    mimeType
  };
}

export async function prepareMemoryImage(file) {
  if (!(file instanceof Blob)) throw new Error('Choose an image file first.');
  if (!file.type?.startsWith('image/')) throw new Error('Choose a screenshot or image file.');
  if (!file.size) throw new Error('That image is empty.');
  if (file.size > MEMORY_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error('That image is too large to process. Choose an image under 25 MB.');
  }

  const decoded = await loadImageSource(file);
  try {
    const originalWidth = asFiniteDimension(decoded.width);
    const originalHeight = asFiniteDimension(decoded.height);
    if (!originalWidth || !originalHeight) throw new Error('The image dimensions could not be read.');

    const tiers = [
      { maxEdge: 1600, qualities: [0.82, 0.76, 0.70] },
      { maxEdge: 1440, qualities: [0.76, 0.70] },
      { maxEdge: 1280, qualities: [0.72, 0.66] },
      { maxEdge: 1120, qualities: [0.68, 0.62] },
      { maxEdge: 960, qualities: [0.62, 0.56] }
    ];

    let firstUnderHardLimit = null;
    let smallestCandidate = null;
    let preferredType = 'image/webp';

    for (const tier of tiers) {
      const dimensions = fitImageDimensions(originalWidth, originalHeight, tier.maxEdge);
      for (const quality of tier.qualities) {
        const candidate = await encodeCandidate(decoded.source, dimensions, quality, preferredType);
        preferredType = candidate.mimeType;
        if (!smallestCandidate || candidate.byteSize < smallestCandidate.byteSize) smallestCandidate = candidate;
        if (!firstUnderHardLimit && candidate.byteSize <= MEMORY_IMAGE_HARD_LIMIT_BYTES) {
          firstUnderHardLimit = candidate;
        }
        if (candidate.byteSize <= MEMORY_IMAGE_TARGET_BYTES) {
          const hash = await sha256Blob(candidate.blob);
          return {
            ...candidate,
            hash,
            extension: memoryImageExtension(candidate.mimeType),
            originalByteSize: file.size,
            originalWidth,
            originalHeight
          };
        }
      }
    }

    const chosen = firstUnderHardLimit || smallestCandidate;
    if (!chosen || chosen.byteSize > MEMORY_IMAGE_HARD_LIMIT_BYTES) {
      throw new Error('This screenshot remains over 1 MB after optimization. Crop it to the useful area and try again.');
    }
    const hash = await sha256Blob(chosen.blob);
    return {
      ...chosen,
      hash,
      extension: memoryImageExtension(chosen.mimeType),
      originalByteSize: file.size,
      originalWidth,
      originalHeight
    };
  } finally {
    decoded.cleanup();
  }
}

export function createMemoryImageRepository(client) {
  if (!client) throw new Error('A Supabase client is required for memory images.');
  const signedUrlCache = new Map();

  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    const user = data?.user;
    if (!user?.id) throw new Error('Sign in to use memory images.');
    return user;
  }

  async function rowForQuestion(userId, savedSourceId, sourceRow) {
    const { data, error } = await client
      .from('memory_image_assets')
      .select(MEMORY_IMAGE_COLUMNS)
      .eq('user_id', userId)
      .eq('saved_source_id', savedSourceId)
      .eq('source_row', sourceRow)
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeMemoryImageAsset(data) : null;
  }

  async function cleanupPathIfUnused(userId, storagePath) {
    if (!storagePath) return;
    const { data, error } = await client
      .from('memory_image_assets')
      .select('id')
      .eq('user_id', userId)
      .eq('storage_path', storagePath)
      .limit(1);
    if (error) {
      console.warn('Memory-image deduplication cleanup check failed', error);
      return;
    }
    if (data?.length) return;
    const { error: removeError } = await client.storage.from(MEMORY_IMAGE_BUCKET).remove([storagePath]);
    if (removeError) console.warn('Unused memory image could not be removed', removeError);
    signedUrlCache.delete(storagePath);
  }

  async function findDeduplicatedPath(userId, imageHash) {
    const { data, error } = await client
      .from('memory_image_assets')
      .select('storage_path,mime_type')
      .eq('user_id', userId)
      .eq('image_hash', imageHash)
      .limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  }

  return {
    async listAll() {
      const user = await requireUser();
      const { data, error } = await client
        .from('memory_image_assets')
        .select(MEMORY_IMAGE_COLUMNS)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => normalizeMemoryImageAsset(row));
    },

    async listForSource(savedSourceId) {
      const user = await requireUser();
      const sourceId = String(savedSourceId ?? '').trim();
      if (!sourceId) return [];
      const { data, error } = await client
        .from('memory_image_assets')
        .select(MEMORY_IMAGE_COLUMNS)
        .eq('user_id', user.id)
        .eq('saved_source_id', sourceId)
        .order('source_row', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => normalizeMemoryImageAsset(row));
    },

    async getForCard(savedSourceId, card) {
      const user = await requireUser();
      const sourceId = String(savedSourceId ?? '').trim();
      const sourceRow = asPositiveInteger(card?.sourceRow);
      if (!sourceId || !sourceRow) return { asset: null, stale: false };
      const asset = await rowForQuestion(user.id, sourceId, sourceRow);
      if (!asset) return { asset: null, stale: false };
      const expected = await cardFingerprint(card);
      if (asset.question_hash !== expected) return { asset: null, stale: true };
      return { asset, stale: false };
    },

    async attach(savedSourceId, card, preparedImage) {
      const user = await requireUser();
      const sourceId = String(savedSourceId ?? '').trim();
      const sourceRow = asPositiveInteger(card?.sourceRow);
      if (!sourceId || !sourceRow) throw new Error('Open a saved deck before adding a memory image.');
      if (!preparedImage?.blob || !preparedImage?.hash) throw new Error('The optimized image is incomplete.');
      if (preparedImage.byteSize > MEMORY_IMAGE_HARD_LIMIT_BYTES) throw new Error('Memory image exceeds the 1 MB storage limit.');

      const previous = await rowForQuestion(user.id, sourceId, sourceRow);
      const deduplicated = await findDeduplicatedPath(user.id, preparedImage.hash);
      const storagePath = deduplicated?.storage_path
        || memoryImageObjectPath(user.id, preparedImage.hash, preparedImage.mimeType);

      if (!deduplicated) {
        const { error: uploadError } = await client.storage
          .from(MEMORY_IMAGE_BUCKET)
          .upload(storagePath, preparedImage.blob, {
            cacheControl: '31536000',
            contentType: preparedImage.mimeType,
            upsert: true
          });
        if (uploadError) throw uploadError;
      }

      const now = new Date().toISOString();
      const payload = {
        user_id: user.id,
        saved_source_id: sourceId,
        source_row: sourceRow,
        question_hash: await cardFingerprint(card),
        question_text: cleanText(card.question),
        answer_text: cleanText(card.answer),
        image_hash: preparedImage.hash,
        storage_path: storagePath,
        mime_type: preparedImage.mimeType,
        byte_size: preparedImage.byteSize,
        width: preparedImage.width,
        height: preparedImage.height,
        updated_at: now
      };

      const { data, error } = await client
        .from('memory_image_assets')
        .upsert(payload, { onConflict: 'user_id,saved_source_id,source_row' })
        .select(MEMORY_IMAGE_COLUMNS)
        .single();
      if (error) {
        if (!deduplicated) await cleanupPathIfUnused(user.id, storagePath);
        throw error;
      }

      const asset = normalizeMemoryImageAsset(data);
      if (previous?.storage_path && previous.storage_path !== storagePath) {
        await cleanupPathIfUnused(user.id, previous.storage_path);
      }
      return asset;
    },

    async signedUrl(asset) {
      const normalized = normalizeMemoryImageAsset(asset);
      const cached = signedUrlCache.get(normalized.storage_path);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
      const { data, error } = await client.storage
        .from(MEMORY_IMAGE_BUCKET)
        .createSignedUrl(normalized.storage_path, MEMORY_IMAGE_SIGNED_URL_SECONDS);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('The memory image could not be opened.');
      signedUrlCache.set(normalized.storage_path, {
        url: data.signedUrl,
        expiresAt: Date.now() + (MEMORY_IMAGE_SIGNED_URL_SECONDS - 3600) * 1000
      });
      return data.signedUrl;
    },

    async remove(savedSourceId, sourceRow) {
      const user = await requireUser();
      const sourceId = String(savedSourceId ?? '').trim();
      const row = asPositiveInteger(sourceRow);
      if (!sourceId || !row) throw new Error('A saved deck and source row are required.');
      const existing = await rowForQuestion(user.id, sourceId, row);
      if (!existing) return;
      const { error } = await client
        .from('memory_image_assets')
        .delete()
        .eq('id', existing.id)
        .eq('user_id', user.id);
      if (error) throw error;
      await cleanupPathIfUnused(user.id, existing.storage_path);
    },

    async removeById(id) {
      const user = await requireUser();
      const assetId = String(id ?? '').trim();
      if (!assetId) return;
      const { data, error: readError } = await client
        .from('memory_image_assets')
        .select(MEMORY_IMAGE_COLUMNS)
        .eq('id', assetId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (readError) throw readError;
      if (!data) return;
      const asset = normalizeMemoryImageAsset(data);
      const { error } = await client
        .from('memory_image_assets')
        .delete()
        .eq('id', assetId)
        .eq('user_id', user.id);
      if (error) throw error;
      await cleanupPathIfUnused(user.id, asset.storage_path);
    }
  };
}
