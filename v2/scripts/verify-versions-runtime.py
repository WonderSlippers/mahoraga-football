"""Read-only runtime evidence of independently appended observations and paper accounts."""
import json, sqlite3
from pathlib import Path
from datetime import datetime, timezone
root=Path.cwd().resolve();profile=root/'.runtime-v2/research-general';out=root/'.runtime-v2/versions-20261004'
manifest=json.loads((profile/'manifest.json').read_text(encoding='utf-8'))
run=json.loads((profile/'run.json').read_text(encoding='utf-8'))
found=[]
for file in (profile/'d1').rglob('*.sqlite'):
    candidate=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True)
    if candidate.execute("SELECT name FROM sqlite_master WHERE name='installations'").fetchone() and candidate.execute('SELECT id FROM installations').fetchone()[0]==manifest['installationId']:
        found.append(candidate)
    else: candidate.close()
assert len(found)==1
db=found[0];db.row_factory=sqlite3.Row
def rows(sql):return [dict(r) for r in db.execute(sql)]
report=dict(checkedAt=datetime.now(timezone.utc).isoformat(),installationId=manifest['installationId'],mode=manifest['mode'],appCodeSha=manifest['appCodeSha'],workerBuildHash=manifest.get('workerBuildHash'),supervisorPid=run['pid'],startedAt=run['startedAt'],schemaVersion=db.execute('SELECT schemaVersion FROM installations').fetchone()[0],observations=rows('SELECT modelId,state,COUNT(*) n,COUNT(DISTINCT fixtureRevisionId) fixtureRevisionN,MAX(calculatedAt) lastAt FROM version_observations GROUP BY modelId,state'),paper=rows("SELECT pp.id,pp.enabled,p.available,p.openStake,p.realized,p.initial,COUNT(t.id) n FROM paper_policies pp JOIN portfolios p ON p.id=pp.portfolioId LEFT JOIN tickets t ON t.portfolioId=p.id WHERE pp.id LIKE 'september20:%' OR pp.id='v6-native' GROUP BY pp.id"),evolution=rows('SELECT * FROM version_state'),rejections=rows('SELECT policyId,reason,COUNT(*) n FROM version_execution_rejections GROUP BY policyId,reason'),automation=rows('SELECT enabled,lastSuccessAt,lastAttemptAt,stage FROM automation_state'),moneyInvariantFailures=db.execute('SELECT COUNT(*) FROM portfolios WHERE available+openStake<>initial+realized').fetchone()[0])
assert report['schemaVersion']==13 and report['moneyInvariantFailures']==0
assert any(r['state']=='DONE' and r['modelId']=='LEGACY_20260920_FULL_RULES_V1' for r in report['observations'])
assert len(report['paper'])==11 and any(r['n']>0 for r in report['paper'] if r['id'].startswith('september20:'))
(out/'runtime-current.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(schemaVersion=report['schemaVersion'],observations=report['observations'],accounts=len(report['paper']),legacyPaperN=sum(r['n'] for r in report['paper'] if r['id'].startswith('september20:')),moneyInvariantFailures=0)))
db.close()
