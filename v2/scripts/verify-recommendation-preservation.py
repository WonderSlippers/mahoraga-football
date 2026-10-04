"""Read-only hashes at fixed append watermarks. Never open legacy D1."""
import hashlib, json, sqlite3, subprocess, sys
from pathlib import Path
from datetime import datetime,timezone
root=Path.cwd().resolve();out=root/'.runtime-v2/recommendation-scores-20261004';out.mkdir(parents=True,exist_ok=True)
profile=root/'.runtime-v2/research-general';manifest=json.loads((profile/'manifest.json').read_text(encoding='utf-8'))
connections=[]
for file in (profile/'d1').rglob('*.sqlite'):
    candidate=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True)
    if candidate.execute("SELECT name FROM sqlite_master WHERE name='installations'").fetchone() and candidate.execute('SELECT id FROM installations').fetchone()[0]==manifest['installationId']:connections.append(candidate)
    else:candidate.close()
assert len(connections)==1
db=connections[0]
legacy='D:/ChatGPT/Projects/2026-09-15/ge/work/site-remote-open-129'
def git(*args):return subprocess.check_output(['git','-C',legacy,*args],stderr=subprocess.DEVNULL)
def digest(table,watermark):
    h=hashlib.sha256();n=0
    for row in db.execute('SELECT * FROM '+table+' WHERE rowid<=? ORDER BY rowid',(watermark,)):
        h.update(json.dumps(row,ensure_ascii=True,separators=(',',':')).encode());n+=1
    return dict(n=n,sha256=h.hexdigest(),watermark=watermark)
phase=sys.argv[1]
before=json.loads((out/'preservation-before.json').read_text(encoding='utf-8')) if phase=='after' else None
facts={}
for table in ['predictions','tickets','ticket_legs','universal_observations','version_observations']:
    watermark=before['facts'][table]['watermark'] if before else db.execute('SELECT COALESCE(MAX(rowid),0) FROM '+table).fetchone()[0]
    facts[table]=digest(table,watermark)
    if before:assert facts[table]==before['facts'][table],table
report=dict(checkedAt=datetime.now(timezone.utc).isoformat(),facts=facts,legacyHead=git('rev-parse','HEAD').decode().strip(),legacyDiffSHA256=hashlib.sha256(git('diff','--binary','HEAD')).hexdigest(),legacyStatusSHA256=hashlib.sha256(git('status','--porcelain=v1','--untracked-files=all')).hexdigest())
if before:
    for key in ['legacyHead','legacyDiffSHA256','legacyStatusSHA256']:assert report[key]==before[key],key
(out/('preservation-'+phase+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False));db.close()
