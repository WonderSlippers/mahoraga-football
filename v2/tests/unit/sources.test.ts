import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeOpenLiga, boundedBody, evidenceChunks, sourceUrl, allowedSourceUrl, adjudicateEvidence, capabilities } from '../../packages/sources/index';
const recorded = JSON.parse(fs.readFileSync('tests/fixtures/openliga-recorded.json', 'utf8'));
test('A41 A42 actual recorded OpenLiga fixture/result and five league capabilities', () => {
  const result = normalizeOpenLiga(recorded, 2026);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].regulation, [5,1]);
  assert.equal(result[0].providerUpdatedAt, null);
  assert.equal(result[1].regulation, null);
  assert.equal(capabilities.length, 5);
  assert.equal(capabilities.filter(x=>x.fixtures).length, 1);
  assert.ok(capabilities.every(x=>!x.quotes));
});
test('A12 A59 missing regulation, conflicting score, AET and PEN are review', () => {
  for (const results of [[], [{resultTypeKind:'AfterExtraTime',pointsTeam1:5,pointsTeam2:1}], [{resultTypeKind:'After90Minutes',pointsTeam1:null,pointsTeam2:0}], [{resultTypeKind:'PenaltyShootout',pointsTeam1:5,pointsTeam2:4}]]) {
    const p = structuredClone(recorded); p[0].matchResults = results;
    assert.equal(normalizeOpenLiga(p,2026)[0].regulation, null);
  }
  const p = structuredClone(recorded); p[0].matchResults.push({resultTypeKind:'After90Minutes',pointsTeam1:1,pointsTeam2:1});
  assert.equal(normalizeOpenLiga(p,2026)[0].resultReason,'RESULT_CONFLICT');
});
test('A60 evidence order never resolves conflicts silently', () => {
  const a = {id:'a',status:'FINISHED',regulation:[1,0] as [number,number]}, b={id:'b',status:'FINISHED',regulation:[0,1] as [number,number]};
  assert.deepEqual(adjudicateEvidence([a,b]),adjudicateEvidence([b,a]));
  assert.equal(adjudicateEvidence([a,b]).state,'REVIEW');
  assert.equal(adjudicateEvidence([a]).state,'CONFIRMED');
});
test('A44 capture body refuses decompressed overflow including unknown content length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024));},cancel(){cancelled=true;}});
  await assert.rejects(boundedBody(new Response(stream),2048), /PAYLOAD_LIMIT/);
  assert.equal(cancelled,true);
  await assert.rejects(boundedBody(new Response('bad',{status:503})),/SOURCE_HTTP_503/);
});
test('A43 evidence chunks exactly preserve UTF8 bytes and BOM', () => {
  const original='\uFEFF'+ '中😀'.repeat(50000);
  const bytes=new TextEncoder().encode(original);
  const chunks=evidenceChunks(bytes);
  assert.equal(chunks.join(''),original);
  assert.ok(chunks.every(x=>new TextEncoder().encode(x).length<=65540));
  assert.throws(()=>evidenceChunks(new Uint8Array([255])), /encoded data/);
});
test('A79 SSRF and source identity reject unregistered hosts redirects and leagues', () => {
  assert.equal(allowedSourceUrl(sourceUrl('OPENLIGADB_V1','ger.1',2026)),true);
  for (const u of ['http://api.openligadb.de/getmatchdata/bl1/2026','https://127.0.0.1/','https://api.openligadb.de.evil.test/getmatchdata/bl1/2026','https://x@api.openligadb.de/getmatchdata/bl1/2026','https://api.openligadb.de/getmatchdata/bl1/2026?url=http://localhost']) assert.equal(allowedSourceUrl(u),false);
  assert.throws(()=>sourceUrl('OPENLIGADB_V1','eng.1',2026));
  assert.throws(()=>normalizeOpenLiga(recorded,2025));
  assert.throws(()=>normalizeOpenLiga([...recorded,recorded[0]],2026));
});
