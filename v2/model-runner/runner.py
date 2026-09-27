"""DEMO-only pull runner. No database access, training, or external fetches."""
import hashlib,json,os,time,uuid,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime
from jsonschema import Draft7Validator,FormatChecker
SCHEMA=json.loads((Path(__file__).parents[1]/'packages/contracts/input.schema.json').read_text())
def validate(value):
    Draft7Validator(SCHEMA,format_checker=FormatChecker()).validate(value)
    if any(float(x)<=1 for x in value['odds']): raise ValueError('ODDS_INVALID')
    at=lambda s:datetime.fromisoformat(s.replace('Z','+00:00'))
    if max(at(value['observedAt']),at(value['ingestedAt']))>at(value['cutoffAt']) or at(value['cutoffAt'])>=at(value['kickoffAt']): raise ValueError('FEATURE_LATE')
    return value
def predict(job):
    raw=job['canonical']; value=validate(json.loads(raw))
    if value['mode']!='DEMO': raise ValueError('NETWORK_DISABLED')
    if hashlib.sha256(raw.encode()).hexdigest()!=job['bundleHash']: raise ValueError('MODEL_HASH_MISMATCH')
    if job['modelId']=='MARKET_PROPORTIONAL_V1':
        q=[1/float(x) for x in value['odds']]; p=[x/sum(q) for x in q]
    elif job['modelId']=='DEMO_FIXED_CENTRAL_V1': p=[0.6,0.25,0.15]
    else: raise ValueError('RESEARCH_FIT_FORBIDDEN')
    return p
def main():
    base=os.environ['V2_API']; token=os.environ['V2_SERVICE_TOKEN']; owner=str(uuid.uuid4())
    if not base.startswith('http://127.0.0.1:'): raise ValueError('HOST_INVALID')
    def post(path,data):
        request=urllib.request.Request(base+path,json.dumps(data).encode(),{'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:return json.load(response)['data']
    while True:
        try:
            job=post('/internal/v2/model-jobs/claim',{'owner':owner})
            if job:
                post('/internal/v2/model-jobs/'+job['id']+'/complete',{'owner':owner,'fencingToken':job['fencingToken'],'bundleHash':job['bundleHash'],'modelHash':job['modelHash'],'central':predict(job),'featureCanonical':job['canonical']})
                print('DEMO_JOB_COMPLETE',job['id'],flush=True)
            else: time.sleep(0.5)
        except (urllib.error.URLError,ValueError,KeyError) as exc:
            print('RUNNER_RETRY',type(exc).__name__,flush=True); time.sleep(1)
if __name__=='__main__':main()
