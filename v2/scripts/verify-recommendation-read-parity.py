"""Compare exact old/new read rows using own installation in a read-only transaction."""
import json, re, sqlite3, subprocess, time
from pathlib import Path
root = Path.cwd().resolve()
profile = root / '.runtime-v2/research-general'
manifest = json.loads((profile / 'manifest.json').read_text(encoding='utf-8'))
matches = []
for file in (profile / 'd1').rglob('*.sqlite'):
    db = sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True)
    if db.execute("SELECT name FROM sqlite_master WHERE name='installations'").fetchone() and db.execute('SELECT id FROM installations').fetchone()[0] == manifest['installationId']:
        matches.append(db)
    else:
        db.close()
assert len(matches) == 1
db = matches[0]
db.execute('BEGIN')
old = subprocess.check_output(['git', 'show', 'dcaefed:v2/apps/api/src/services/universal.ts'], encoding='utf-8')
new = (root / 'apps/api/src/services/universal.ts').read_text(encoding='utf-8')
old_sql = re.search(r'"(WITH newest AS MATERIALIZED.+)"', old).group(1)
new_sql = re.search(r'`(WITH newest AS MATERIALIZED.+)`', new).group(1)
new_sql = re.sub(r'\$\{matchingRevisions[^}]*\}', '', new_sql)
params = ('GENERAL_FOOTBALL_RESEARCH_V2', '', '')
start = time.perf_counter()
before = db.execute(old_sql, params).fetchall()
old_seconds = time.perf_counter() - start
start = time.perf_counter()
after = db.execute(new_sql, params).fetchall()
new_seconds = time.perf_counter() - start
assert before == after, 'Read optimization changed frozen observations'
report = dict(rows=len(after), sameRows=True, oldSeconds=old_seconds, newSeconds=new_seconds, method='OWN_INSTALLATION_READ_ONLY_SINGLE_SNAPSHOT_NOT_MODEL_VALIDATION')
(root / '.runtime-v2/recommendation-scores-20261004/universal-query-parity.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
db.close()
