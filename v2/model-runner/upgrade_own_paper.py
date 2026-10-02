"""Prepare a checked schema upgrade in a NEW own-state directory.
No old-site connection, no active database replacement, no deletion or moving.
Run only after the nonce-controlled own v2 profile has stopped.
"""
import sys,json,sqlite3,hashlib
from pathlib import Path
ROOT=Path(__file__).parents[1].resolve()
def upgrade(profile):
    if profile not in ['research','demo']:raise ValueError('PROFILE_INVALID')
    source=ROOT/'.runtime-v2'/profile;target=ROOT/'.runtime-v2'/(profile+'-general')
    if target.exists():raise ValueError('DESTINATION_MUST_BE_NEW')
    for p in [source,target.parent]:
        if p.is_symlink() or not p.resolve().is_relative_to((ROOT/'.runtime-v2').resolve()):raise ValueError('OWN_STATE_ONLY')
    if (source/'run.json').exists():
        run=json.loads((source/'run.json').read_text(encoding='utf8'))
        stopped=json.loads((source/'last-stop.json').read_text(encoding='utf8'))
        if run['runId']!=stopped.get('runId') or stopped.get('supervisorPid')!=run['pid']:raise ValueError('STOP_OWN_PROFILE_FIRST')
    manifest=json.loads((source/'manifest.json').read_text(encoding='utf8'))
    expected='LOCAL_RESEARCH' if profile=='research' else 'DEMO'
    if manifest['mode']!=expected:raise ValueError('MODE_MISMATCH')
    selected=None
    for file in (source/'d1').rglob('*.sqlite'):
        if file.is_symlink() or not file.resolve().is_relative_to(source.resolve()):raise ValueError('OWN_STATE_ONLY')
        c=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
        if c.execute("SELECT name FROM sqlite_master WHERE name='installations'").fetchone():
            identity=dict(c.execute('SELECT * FROM installations').fetchone())
            if identity['id']!=manifest['installationId'] or identity['mode']!=expected:raise ValueError('INSTALLATION_MISMATCH')
            selected=(file,c);break
        c.close()
    if not selected:raise ValueError('OWN_DATABASE_NOT_FOUND')
    file,c=selected;destination=target/file.relative_to(source);destination.parent.mkdir(parents=True)
    dest=sqlite3.connect(destination);c.backup(dest);c.close();dest.row_factory=sqlite3.Row
    tables=[r[0] for r in dest.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") if not r[0].startswith('_')]
    def facts():
        result={}
        for t in tables:
            if t=='installations':continue
            digest=hashlib.sha256()
            for r in dest.execute('SELECT * FROM '+t+' ORDER BY rowid'):
                digest.update(json.dumps(dict(r),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode());digest.update(b'\n')
            result[t]=digest.hexdigest()
        return result
    before=facts()
    # Foreign keys are disabled only in this never-started destination copy.
    # All copied records and references must pass FK checks before readiness.
    dest.execute('PRAGMA foreign_keys=OFF');dest.execute('BEGIN IMMEDIATE')
    for table in ['market_definitions','quote_selections','portfolios','tickets']:
        sql=dest.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone()[0]
        related=[r[0] for r in dest.execute("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN('index','trigger') AND sql IS NOT NULL",(table,))]
        definition=sql.replace('CREATE TABLE '+table+'(', 'CREATE TABLE '+table+'_general(').replace("CHECK(type='1X2')","CHECK(type IN('1X2','ASIAN_HANDICAP','TOTAL_GOALS'))").replace("CHECK(selection IN('HOME','DRAW','AWAY'))","CHECK(selection IN('HOME','DRAW','AWAY','OVER','UNDER'))").replace("CHECK(mode='DEMO')","CHECK(mode IN('DEMO','PAPER_RESEARCH'))").replace("CHECK(origin='DEMO')","CHECK(origin IN('DEMO','PAPER_RESEARCH'))")
        if definition==sql:raise ValueError('UPGRADE_DEFINITION_MISMATCH')
        dest.execute(definition);dest.execute('INSERT INTO '+table+'_general SELECT * FROM '+table+' ORDER BY rowid');dest.execute('DROP TABLE '+table);dest.execute('ALTER TABLE '+table+'_general RENAME TO '+table)
        for statement in related:dest.execute(statement)
    dest.execute('UPDATE installations SET schemaVersion=11');dest.commit();dest.execute('PRAGMA foreign_keys=ON')
    if list(dest.execute('PRAGMA foreign_key_check')):raise ValueError('FOREIGN_KEY_INVALID')
    if dest.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('QUICK_CHECK_FAILED')
    after=facts()
    if before!=after:raise ValueError('ORIGINAL_FACT_CHANGED')
    counts={t:dest.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in tables};dest.close()
    # Retain local credentials and installation identity; never emit them.
    manifest.pop('restorationState',None)
    (target/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    report=dict(sourceProfile=profile,destinationProfile=profile+'-general',schemaVersion=11,quickCheck='ok',foreignKeyCheck='ok',originalFactsUnchanged=True,tableCounts=counts,sourceDatabaseConnectedReadOnly=True,oldSiteDatabaseConnected=False)
    (target/'upgrade-proof.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report))
if __name__=='__main__':upgrade(sys.argv[1])
