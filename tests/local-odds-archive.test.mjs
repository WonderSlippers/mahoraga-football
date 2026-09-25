import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {archiveOdds,verifyArchive,restoreArchive,queryArchive,previousMonthWindow} from '../scripts/local-odds-archive.mjs';

test('monthly archive window follows Shanghai calendar including year rollover',()=>{
  assert.deepEqual(previousMonthWindow(Date.parse('2026-09-30T19:15:00Z')),{from:Date.parse('2026-08-31T16:00:00Z'),to:Date.parse('2026-09-30T16:00:00Z'),mode:'month-202609'});
  assert.deepEqual(previousMonthWindow(Date.parse('2026-12-31T19:15:00Z')),{from:Date.parse('2026-11-30T16:00:00Z'),to:Date.parse('2026-12-31T16:00:00Z'),mode:'month-202612'});
});

test('quote archive preserves every row and restores into a separate SQLite database',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'edge-odds-archive-'));
  const source=path.join(dir,'source.sqlite');
  try{
    let db=new DatabaseSync(source);
    for(const migration of ['0001_unusual_iron_lad.sql','0002_bent_junta.sql','0003_sloppy_cable.sql'])
      db.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
    db.prepare('INSERT INTO odds_snapshots(match_id,league_code,captured_at,home_odds,draw_odds,away_odds,provider) VALUES (?,?,?,?,?,?,?)').run('123','eng.1',1000,2.1,3.2,3.8,'source');
    db.prepare('INSERT INTO market_quotes(id,match_id,league_code,home,away,kickoff_at,captured_at,market,line,over_odds,under_odds,provider,phase,source_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('q1','123','eng.1','Home','Away',2000,1000,'total-ft',2.5,1.9,1.9,'source','current','https://example.test');
    db.prepare('INSERT INTO market_results(id,match_id,league_code,observed_at,state,home_score,away_score,detail,source_url,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?)').run('r1','123','eng.1',1500,'final',2,1,'FT','https://example.test','fingerprint');
    db.close();
    db=new DatabaseSync(source,{readOnly:true});
    const {manifestFile}=archiveOdds(db,source,'baseline',0,2000,2_000,dir);
    db.close();
    const verified=verifyArchive(manifestFile,dir);
    assert.deepEqual(verified.manifest.counts,{odds_snapshots:1,market_quotes:1,market_results:1});
    assert.equal(queryArchive(manifestFile,'eng.1','123',360,dir).length,3);
    const restored=restoreArchive(manifestFile,dir);
    assert.equal(restored.sourceHash,restored.restoredHash);
    const copy=new DatabaseSync(restored.file,{readOnly:true});
    assert.equal(copy.prepare('SELECT home_odds FROM odds_snapshots WHERE match_id=?').get('123').home_odds,2.1);
    copy.close();
    appendFileSync(path.join(dir,verified.manifest.dataFile),'corrupt');
    assert.throws(()=>verifyArchive(manifestFile,dir),/SHA256/);
  }finally{
    if(path.dirname(dir)===tmpdir())rmSync(dir,{recursive:true,force:true});
  }
});
