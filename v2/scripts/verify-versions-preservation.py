"""Read-only comparison against the pre-upgrade backup of the OWN v2 DB."""
import hashlib, json, sqlite3, subprocess
from pathlib import Path
from datetime import datetime, timezone
root=Path.cwd().resolve()
out=root/'.runtime-v2/versions-20261004'
before=json.loads((out/'before.json').read_text(encoding='utf-8'))
profile=root/'.runtime-v2/research-general'
manifest=json.loads((profile/'manifest.json').read_text(encoding='utf-8'))
backup=sqlite3.connect((out/'private-before.sqlite').resolve().as_uri()+'?mode=ro',uri=True)
found=[]
for file in (profile/'d1').rglob('*.sqlite'):
    db=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True)
    if db.execute("SELECT name FROM sqlite_master WHERE name='installations'").fetchone() and db.execute('SELECT id FROM installations').fetchone()[0]==manifest['installationId']:
        found.append((file,db))
    else: db.close()
assert len(found)==1
file,db=found[0]
assert file.resolve().is_relative_to(profile.resolve())
def digest(conn,table,sequence):
    h=hashlib.sha256();n=0
    for row in conn.execute('SELECT * FROM '+table+' WHERE rowid<=? ORDER BY rowid',(sequence,)):
        h.update(json.dumps(row,ensure_ascii=True,separators=(',',':')).encode('utf-8'));n+=1
    return dict(n=n,sha256=h.hexdigest())
facts={}
for table,baseline in before['ownFacts'].items():
    new=digest(db,table,baseline['sequence'])
    assert new['sha256']==baseline['sha256'] and new['n']==baseline['n'],table
    backupSequence=backup.execute('SELECT COALESCE(MAX(rowid),0) FROM '+table).fetchone()[0]
    old=digest(backup,table,backupSequence);fromActive=digest(db,table,backupSequence)
    assert old==fromActive,table
    facts[table]=dict(originalSequence=baseline['sequence'],original=baseline,current=new,preserved=True,backupSequence=backupSequence,backupPreserved=True)
sealed=root/'.models-local/frozen/20261001-r1'
pins=json.loads((sealed/'manifest.json').read_text(encoding='utf-8'))
assets={name:hashlib.sha256((sealed/name).read_bytes()).hexdigest()==expected for name,expected in pins['assets'].items()}
code={name:hashlib.sha256((root/'model-runner'/name).read_bytes()).digest()==hashlib.sha256((sealed/'local-code'/name).read_bytes()).digest() for name in ['comparison_models.py','prepare_comparison_features.py','research_adapters.py','legacy-bridge.mjs']}
assert all(assets.values()) and all(code.values())
legacy=Path('D:/ChatGPT/Projects/2026-09-15/ge/work/site-remote-open-129')
def git(*args):return subprocess.check_output(['git','-C',str(legacy),*args],stderr=subprocess.DEVNULL)
head=git('rev-parse','HEAD').decode().strip()
diff=hashlib.sha256(git('diff','--binary')).hexdigest()
status=hashlib.sha256(git('status','--porcelain','--untracked-files=all')).hexdigest()
assert head==before['legacy']['head'] and diff==before['legacy']['diffSha256'] and status==before['legacy']['statusSha256']
report=dict(checkedAt=datetime.now(timezone.utc).isoformat(),ownReadOnlyPath=str(file),quickCheck=db.execute('PRAGMA quick_check').fetchone()[0],foreignKeyFailures=len(db.execute('PRAGMA foreign_key_check').fetchall()),facts=facts,sealedAssets=assets,sealedCode=code,legacy=dict(head=head,diffSha256=diff,statusSha256=status,unchanged=True,databaseOpened=False,httpCalled=False,processesControlled=False),scope='only the isolated v2 profile; legacy site may continue its own normal writes')
assert report['quickCheck']=='ok' and report['foreignKeyFailures']==0
(out/'preservation-after.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(tablesPreserved=len(facts),assetsPreserved=len(assets),codePreserved=len(code),legacyUnchanged=True,quickCheck=report['quickCheck'],foreignKeyFailures=report['foreignKeyFailures'])))
db.close();backup.close()
