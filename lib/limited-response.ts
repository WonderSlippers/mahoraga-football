export async function readTextLimited(response: Request | Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    // This branch runs before acquiring a reader: release the rejected body too.
    // A failed cancellation must not replace the original size-limit failure.
    await response.body?.cancel().catch(() => {});
    throw new RangeError('response body exceeds byte limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  // Copy consumed bytes immediately: a producer may reuse its chunk storage.
  // One geometrically grown buffer also avoids retaining millions of tiny views.
  let buffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextBytes = bytes + value.byteLength;
      if (nextBytes > maxBytes) throw new RangeError('response body exceeds byte limit');
      if (nextBytes > buffer.byteLength) {
        const capacity = Math.min(maxBytes, Math.max(nextBytes, buffer.byteLength * 2, 16_384));
        const grown = new Uint8Array(capacity);
        grown.set(buffer.subarray(0, bytes));
        buffer = grown;
      }
      buffer.set(value, bytes);
      bytes = nextBytes;
    }
    return new TextDecoder().decode(buffer.subarray(0, bytes));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonLimited(response: Request | Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readTextLimited(response, maxBytes));
}
