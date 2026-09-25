// The browser supplies the Site API observation only when it actually
// received that response. Untrusted/old requests retain the full server path.
export function feedSourceMode(headers) {
  return headers.get('x-edge-bounded-feed')==='1'&&headers.get('x-edge-site-available')==='1'?'cdn-only':'full';
}
