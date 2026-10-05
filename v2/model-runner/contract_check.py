import sys,json,hashlib
from runner import validate
results=[]
for raw in json.load(sys.stdin):
    try:
        value=json.loads(raw);validate(value)
        results.append({'valid':True,'hash':hashlib.sha256(raw.encode()).hexdigest(),'missingMask':value['missingMask']})
    except Exception:results.append({'valid':False})
print(json.dumps(results))
