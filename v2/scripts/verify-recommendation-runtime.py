"""Read-only runtime evidence for this isolated installation; never open legacy D1."""
import json, sqlite3, subprocess, sys
from pathlib import Path
from datetime import datetime, timezone

root = Path.cwd().resolve()
profile = root / '.runtime-v2/research-general'
out = root / '.runtime-v2/recommendation-scores-20261004'
manifest = json.loads((profile / 'manifest.json').read_text(encoding='utf-8'))
run = json.loads((profile / 'run.json').read_text(encoding='utf-8'))
matches = []
for file in (profile / 'd1').rglob('*.sqlite'):
    candidate = sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True)
    if candidate.execute("SELECT name FROM sqlite_master WHERE name='installations'").fetchone() and candidate.execute('SELECT id FROM installations').fetchone()[0] == manifest['installationId']:
        matches.append(candidate)
    else:
        candidate.close()
assert len(matches) == 1
db = matches[0]
db.row_factory = sqlite3.Row
automation = [dict(r) for r in db.execute('SELECT enabled,lastSuccessAt,lastAttemptAt,stage,reason FROM automation_state')]
assert automation and automation[0]['enabled'] == 1
assert datetime.now(timezone.utc).timestamp() * 1000 - automation[0]['lastSuccessAt'] < 300000
legacy = json.loads(subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', '$taskLegacyProcess=Get-Process -Id 24644; @{Id=$taskLegacyProcess.Id; StartTime=$taskLegacyProcess.StartTime.ToString("o")} | ConvertTo-Json'], encoding='utf-8-sig'))
before_legacy = json.loads((out / 'legacy-process-before.json').read_text(encoding='utf-8-sig'))
assert legacy == before_legacy, 'Legacy process identity changed'
report = dict(checkedAt=datetime.now(timezone.utc).isoformat(), supervisorPid=run['pid'], startedAt=run['startedAt'], workerCodeSha=manifest['appCodeSha'], workerBuildHash=manifest['workerBuildHash'], automation=automation, legacyProcess=legacy)
phase = sys.argv[1] if len(sys.argv) > 1 else 'current'
if phase == 'after':
    before = json.loads((out / 'runtime-before-final.json').read_text(encoding='utf-8'))
    assert report['supervisorPid'] == before['supervisorPid']
    assert report['startedAt'] == before['startedAt']
    assert automation[0]['lastSuccessAt'] > before['automation'][0]['lastSuccessAt'], 'Automatic success clock did not advance'
(out / ('runtime-' + ('before-final' if phase == 'before' else 'current') + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=True))
db.close()
