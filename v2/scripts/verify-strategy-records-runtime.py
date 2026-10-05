"""Inspect the isolated live runtime; do not connect to legacy D1 or write either database."""
import hashlib, json, sqlite3, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

root = Path.cwd().resolve()
profile = root / '.runtime-v2/research-general'
out = root / '.runtime-v2/strategy-records-20261004'
out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((profile / 'manifest.json').read_text(encoding='utf-8'))
run = json.loads((profile / 'run.json').read_text(encoding='utf-8'))
matches = []
for file in (profile / 'd1').rglob('*.sqlite'):
    db = sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True)
    if db.execute("SELECT name FROM sqlite_master WHERE name='installations'").fetchone() and db.execute('SELECT id FROM installations').fetchone()[0] == manifest['installationId']:
        matches.append(db)
    else:
        db.close()
assert len(matches) == 1
db = matches[0]
db.row_factory = sqlite3.Row
def rows(sql):
    return [dict(r) for r in db.execute(sql)]
legacy = Path('D:/ChatGPT/Projects/2026-09-15/ge/work/site-remote-open-129')
def git(*args):
    return subprocess.check_output(['git', '-C', str(legacy), *args], stderr=subprocess.DEVNULL)
report = dict(
    checkedAt=datetime.now(timezone.utc).isoformat(),
    supervisorPid=run['pid'], startedAt=run['startedAt'],
    automation=rows('SELECT enabled,lastSuccessAt,lastAttemptAt,stage,reason FROM automation_state'),
    paper=rows('SELECT pp.id,pp.enabled,COUNT(t.id) total FROM paper_policies pp LEFT JOIN tickets t ON t.portfolioId=pp.portfolioId GROUP BY pp.id'),
    observations=rows('SELECT modelId,state,COUNT(*) n,COUNT(DISTINCT fixtureRevisionId) fixtureRevisionN,MAX(calculatedAt) lastAt FROM version_observations GROUP BY modelId,state'),
    legacyHead=git('rev-parse', 'HEAD').decode().strip(),
    legacyDiffSHA256=hashlib.sha256(git('diff', '--binary', 'HEAD')).hexdigest(),
    legacyStatusSHA256=hashlib.sha256(git('status', '--porcelain=v1', '--untracked-files=all')).hexdigest(),
)
assert report['automation'] and report['automation'][0]['enabled'] == 1
age = datetime.now(timezone.utc).timestamp()*1000 - report['automation'][0]['lastSuccessAt']
assert age < 300000, f'Automatic success stale by {age}ms'
if len(sys.argv)>1 and sys.argv[1] == 'after':
    before = json.loads((out/'runtime-before.json').read_text(encoding='utf-8'))
    for key in ['supervisorPid', 'startedAt', 'legacyHead', 'legacyDiffSHA256', 'legacyStatusSHA256']:
        assert report[key] == before[key], key
    assert report['automation'][0]['lastSuccessAt'] > before['automation'][0]['lastSuccessAt'], 'Automatic success did not advance'
(out / ('runtime-' + (sys.argv[1] if len(sys.argv)>1 else 'current') + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
db.close()
