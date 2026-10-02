"""Local DEMO / labelled public research pull runner. No DB, training, external fetches."""
import hashlib,json,os,time,uuid,urllib.request,urllib.error,threading,base64,math
from pathlib import Path
from datetime import datetime
from jsonschema import Draft7Validator,FormatChecker
from comparison_models import IDS as COMPARISON_IDS,predict_comparison
from universal_model_v2 import MODEL_ID as UNIVERSAL_ID,predict_universal
SCHEMA=json.loads((Path(__file__).parents[1]/'packages/contracts/input.schema.json').read_text())
def validate(value):
    Draft7Validator(SCHEMA,format_checker=FormatChecker()).validate(value)
    if any(float(x)<=1 for x in value['odds']): raise ValueError('ODDS_INVALID')
    at=lambda s:datetime.fromisoformat(s.replace('Z','+00:00'))
    if max(at(value['observedAt']),at(value['ingestedAt']))>at(value['cutoffAt']) or at(value['cutoffAt'])>=at(value['kickoffAt']): raise ValueError('FEATURE_LATE')
    return value
def predict(job):
    raw=job['canonical']; value=validate(json.loads(raw))
    if value['mode'] not in ['DEMO','LOCAL_RESEARCH']: raise ValueError('NETWORK_DISABLED')
    if value['mode']=='LOCAL_RESEARCH' and job['modelId']=='DEMO_FIXED_CENTRAL_V1': raise ValueError('MODE_MISMATCH')
    if hashlib.sha256(raw.encode()).hexdigest()!=job['bundleHash']: raise ValueError('MODEL_HASH_MISMATCH')
    if job['modelId']=='MARKET_PROPORTIONAL_V1':
        q=[1/float(x) for x in value['odds']]; p=[x/sum(q) for x in q]
    elif job['modelId']=='DEMO_FIXED_CENTRAL_V1': p=[0.6,0.25,0.15]
    elif job['modelId']=='RECENT_FORM_MARKET80_RESEARCH_V1': p=recent_form(value)
    else: raise ValueError('RESEARCH_FIT_FORBIDDEN')
    return p
def recent_form(value):
    features=value['researchFeatures']
    if not isinstance(features.get('neutralSite'),bool): raise ValueError('FEATURE_MISSING_NEUTRAL_SITE')
    cutoff=datetime.fromisoformat(value['cutoffAt'].replace('Z','+00:00'))
    if features['observedAt']>cutoff.timestamp()*1000: raise ValueError('FEATURE_LATE')
    home,away=features['homeRecent'],features['awayRecent']
    for games in [home,away]:
        if len(games)<3 or len({g['id'] for g in games})!=len(games): raise ValueError('FEATURE_MISSING')
        latest=max(datetime.fromisoformat(g['at'].replace('Z','+00:00')) for g in games)
        if latest>=cutoff or (cutoff-latest).days>180: raise ValueError('FEATURE_STALE')
        if any(datetime.fromisoformat(g['at'].replace('Z','+00:00'))>=cutoff for g in games): raise ValueError('FEATURE_LATE')
    mean=lambda games,key:(sum(g[key] for g in games)+3*1.3)/(len(games)+3)
    lh=(mean(home,'gf')+mean(away,'ga'))/2*(1 if features['neutralSite'] else 1.06)
    la=(mean(away,'gf')+mean(home,'ga'))/2
    # Fixed, untrained recent-score heuristic; not V6/V7 and not validated value.
    pmf=lambda lam:[math.exp(-lam)*lam**k/math.factorial(k) for k in range(40)]
    ph,pa=pmf(lh),pmf(la)
    probabilities=[sum(h*a for i,h in enumerate(ph) for j,a in enumerate(pa) if i>j),sum(h*a for i,h in enumerate(ph) for j,a in enumerate(pa) if i==j),sum(h*a for i,h in enumerate(ph) for j,a in enumerate(pa) if i<j)]
    if abs(sum(probabilities)-1)>1e-8: raise ValueError('MODEL_OUTPUT_INVALID')
    q=[1/float(o) for o in value['odds']]; q=[x/sum(q) for x in q]
    return [0.8*m+0.2*f for m,f in zip(q,probabilities)]
def main():
    base=os.environ['V2_API']; token=os.environ['V2_SERVICE_TOKEN']; owner=str(uuid.uuid4())
    if not base.startswith('http://127.0.0.1:'): raise ValueError('HOST_INVALID')
    def post(path,data=None):
        request=urllib.request.Request(base+path,json.dumps(data).encode() if data is not None else None,{'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:return json.load(response)['data']
    last_tick=0
    last_paper=0
    while True:
        job=None
        try:
            try:export=post('/internal/v2/export-jobs/step',{})
            except Exception:
                export={'active':False};print('EXPORT_STEP_RETRY',flush=True)
            if time.monotonic()-last_tick>30:
                post('/internal/v2/scheduler/tick',{})
                last_tick=time.monotonic()
            if time.monotonic()-last_paper>15:
                try:post('/internal/v2/paper/step',{})
                except Exception as exc:print('PAPER_STEP_RETRY',type(exc).__name__,flush=True)
                last_paper=time.monotonic()
            job=post('/internal/v2/model-jobs/claim',{'owner':owner})
            if job:
                stop=threading.Event()
                lease={'owner':owner,'fencingToken':job['fencingToken']}
                def beat():
                    while not stop.wait(10):
                        try:post('/internal/v2/model-jobs/'+job['id']+'/heartbeat',lease)
                        except Exception: return # complete is still fenced by the API
                thread=threading.Thread(target=beat,daemon=True);thread.start()
                try:
                    offset=0;parts=[];size=0
                    while offset is not None:
                        chunk=post('/internal/v2/input-bundles/'+job['bundleId']+'/chunks?offset='+str(offset))
                        if chunk['manifestHash']!=job['bundleHash'] or chunk['offset']!=offset:raise ValueError('MODEL_HASH_MISMATCH')
                        part=base64.b64decode(chunk['contentBase64'],validate=True);size+=len(part)
                        if size>8388608:raise ValueError('PAYLOAD_LIMIT')
                        next_offset=chunk['nextOffset']
                        if next_offset is not None and (not part or next_offset!=offset+len(part)):raise ValueError('INVALID_CHUNK_CURSOR')
                        parts.append(part);offset=next_offset
                    job['canonical']=b''.join(parts).decode('utf-8')
                    if job['modelId']==UNIVERSAL_ID:
                        value=validate(json.loads(job['canonical']))
                        if hashlib.sha256(job['canonical'].encode()).hexdigest()!=job['bundleHash']:raise ValueError('MODEL_HASH_MISMATCH')
                        output=predict_universal(job,value)
                        post('/internal/v2/model-jobs/'+job['id']+'/complete-universal',dict(lease,bundleHash=job['bundleHash'],modelHash=job['modelHash'],output=output,featureCanonical=job['canonical']))
                        print('GENERAL_JOB_'+output['state'],job['id'],output['reason'],flush=True)
                    elif job['modelId'] in COMPARISON_IDS:
                        value=validate(json.loads(job['canonical']))
                        if hashlib.sha256(job['canonical'].encode()).hexdigest()!=job['bundleHash']:raise ValueError('MODEL_HASH_MISMATCH')
                        output=predict_comparison(job,value)
                        post('/internal/v2/model-jobs/'+job['id']+'/complete-comparison',dict(lease,bundleHash=job['bundleHash'],modelHash=job['modelHash'],output=output,featureCanonical=job['canonical']))
                        print('COMPARISON_JOB_'+output['state'],job['modelId'],job['id'],output['reason'],flush=True)
                    else:
                        post('/internal/v2/model-jobs/'+job['id']+'/complete',dict(lease,bundleHash=job['bundleHash'],modelHash=job['modelHash'],central=predict(job),featureCanonical=job['canonical']))
                        print('MODEL_JOB_COMPLETE',job['modelId'],job['id'],flush=True)
                finally:stop.set();thread.join(timeout=11)
            else: time.sleep(0.05 if export['active'] else 1)
        except Exception as exc:
            if job:
                try:post('/internal/v2/model-jobs/'+job['id']+'/fail',{'owner':owner,'fencingToken':job['fencingToken'],'reason':'MODEL_RUNNER_ERROR','retryable':isinstance(exc,urllib.error.URLError)})
                except Exception:pass
            print('RUNNER_RETRY',type(exc).__name__,flush=True); time.sleep(1)
if __name__=='__main__':main()
