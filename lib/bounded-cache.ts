export function putBoundedCache<K, V extends { at: number }>(
  cache: Map<K, V>, key: K, value: V, maxEntries: number, maxAgeMs: number,
  maxBytes = Infinity, sizeOf: (item: V) => number = () => 0,
) {
  for (const [entryKey, entry] of cache) if (value.at - entry.at >= maxAgeMs) cache.delete(entryKey);
  cache.delete(key);
  cache.set(key, value);
  let bytes = 0;
  for (const entry of cache.values()) bytes += sizeOf(entry);
  while (cache.size > maxEntries || bytes > maxBytes) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = cache.get(oldestKey)!;
    bytes -= sizeOf(oldest);
    cache.delete(oldestKey);
  }
}
