import type { ResponseStore } from "../../src/cache/responseStore";

interface CacheEntry {
  body: ArrayBuffer | null;
  headers: [string, string][];
  status: number;
  statusText: string;
  expiresAt: number;
  size: number;
}

/** Cache only response data so hits do not depend on another request's I/O context. */
export function createMemoryCache(
  maxBytes = 24 * 1024 * 1024,
  maxEntries = 512,
  now: () => number = Date.now,
): ResponseStore {
  const entries = new Map<string, CacheEntry>();
  let usedBytes = 0;

  function remove(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    usedBytes -= entry.size;
  }

  return {
    async match(request) {
      const entry = entries.get(request.url);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        remove(request.url);
        return undefined;
      }
      entries.delete(request.url);
      entries.set(request.url, entry);
      return new Response(entry.body?.slice(0) ?? null, {
        status: entry.status,
        statusText: entry.statusText,
        headers: entry.headers,
      });
    },
    async put(request, response) {
      const seconds = Number(response.headers.get("Cache-Control")?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]);
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      const expiresAt = now() + seconds * 1000;
      const body = response.body ? await response.arrayBuffer() : null;
      const headers = [...response.headers];
      const size = (body?.byteLength ?? 0) + 512 + 2 * (request.url.length +
        headers.reduce((length, [name, value]) => length + name.length + value.length, 0));
      if (size > maxBytes || maxEntries < 1) return;

      remove(request.url);
      while (entries.size >= maxEntries || usedBytes + size > maxBytes) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        remove(oldest);
      }
      entries.set(request.url, { body, headers, status: response.status, statusText: response.statusText, expiresAt, size });
      usedBytes += size;
    },
  };
}
