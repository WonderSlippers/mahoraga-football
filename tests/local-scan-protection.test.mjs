import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LOCAL_SCAN_PROTOCOL,SERVER_SCAN_WRITES_ENABLED,localScanWritesAllowed} from '../lib/local-scan-policy.js';

test('v4 protection is enforced by the write route, not only the page or scheduler',async()=>{
  assert.equal(LOCAL_SCAN_PROTOCOL,'prospective-scan-v4');
  assert.equal(SERVER_SCAN_WRITES_ENABLED,false);
  assert.equal(localScanWritesAllowed(),false);
  const route=await readFile(new URL('../app/api/scan/route.ts',import.meta.url),'utf8');
  assert.match(route,/export async function POST\(request: Request\)[\s\S]*?if \(!localScanWritesAllowed\(\)\) return Response\.json/);
});
