// In-memory cache pra signed URLs do Storage.
// Persiste enquanto a edge function instance estiver warm — minutos a horas.
// Cuts repeated createSignedUrl() calls em listings frequentes (manutenções,
// impressões, atestados).
//
// TTL real do signed URL é ttlSec (default 1h). Cache retorna URL se ainda
// faltam >5min até expirar; caso contrário regenera. Cap em 5000 entries
// (LRU simples por ordem de inserção do Map).

type CacheEntry = { url: string; exp: number };

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_SEC = 3600;
const SAFETY_MARGIN_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5000;

export async function getCachedSignedUrl(
  storage: any,
  bucket: string,
  path: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<string | null> {
  if (!path) return null;
  const now = Date.now();
  const key = `${bucket}:${path}`;
  const cached = cache.get(key);
  if (cached && cached.exp > now + SAFETY_MARGIN_MS) {
    return cached.url;
  }
  const { data: signed } = await storage.from(bucket).createSignedUrl(path, ttlSec);
  const url = signed?.signedUrl;
  if (!url) return null;
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { url, exp: now + ttlSec * 1000 });
  return url;
}

export async function refreshSignedUrls<T extends Record<string, any>>(
  storage: any,
  bucket: string,
  rows: T[],
  pathField = "arquivo_path",
  urlField = "arquivo_url",
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => {
      const path = r[pathField];
      if (path) {
        const url = await getCachedSignedUrl(storage, bucket, path, ttlSec);
        if (url) r[urlField] = url;
      }
      return r;
    }),
  );
}
