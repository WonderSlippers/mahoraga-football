// The local service may be healthy while write scans remain unsafe. Both the
// visible controls and the server route must honor this switch.
export const LOCAL_SCAN_PROTOCOL = 'prospective-scan-v4';
export const SERVER_SCAN_WRITES_ENABLED = false;

export function localScanWritesAllowed() {
  return SERVER_SCAN_WRITES_ENABLED && LOCAL_SCAN_PROTOCOL === 'prospective-scan-v5';
}
