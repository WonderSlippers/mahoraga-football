"""Bounded paper-research calibration. Fits training only; API owns forward validation."""
import hashlib,json,math
from pathlib import Path
from functools import lru_cache
from universal_model_v2 import predict_universal as fixed_predict,MODEL_ID as FIXED_ID,coherent_grid
from universal_model import at

ROOT=Path(__file__).parents[1]
MODEL_ID='GENERAL_FOOTBALL_ADAPTIVE_RESEARCH_V1'
PROTOCOL='GENERAL_PREQUENTIAL_CALIBRATION_V1'
@lru_cache(maxsize=1)
def check_code():
    for path,expected in json.loads((ROOT/'packages/domain/general-adaptation-code-pins.json').read_text(encoding='utf8')).items():
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest()!=expected:raise ValueError('MODEL_CODE_CHANGED')
def valid(p):
    if set(p)!={'modelTrust','temperature'} or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in p.values()) or not .6<=p['modelTrust']<=1 or not .8<=p['temperature']<=1.4:raise ValueError('CALIBRATION_INVALID')
def calibrate(base,market,p):
    valid(p)
    if any(len(v)!=3 or any(not math.isfinite(x) or x<0 or x>1 for x in v) or abs(sum(v)-1)>1e-8 for v in [base,market]):raise ValueError('MODEL_OUTPUT_INVALID')
    if p==dict(modelTrust=1,temperature=1):return list(base)
    powers=[max(1e-12,p['modelTrust']*x+(1-p['modelTrust'])*q)**(1/p['temperature']) for x,q in zip(base,market)]
    return [x/sum(powers) for x in powers]
def loss(samples,p):
    return -sum(math.log(max(1e-12,calibrate(s['base'],s['market'],p)[s['outcome']])) for s in samples)/len(samples)
def fit(job):
    check_code()
    if job['protocol']!=PROTOCOL:raise ValueError('PROTOCOL_MISMATCH')
    samples=job['training'];current=job['parameters'];valid(current)
    if len(samples)<60 or len({s['fixtureId'] for s in samples})!=len(samples):raise ValueError('TRAINING_SAMPLE_INVALID')
    # Stable tie-break keeps incumbent. No holdout labels are sent to this process.
    best=dict(current);best_loss=loss(samples,best)
    for dw in [0,-.05,.05]:
        for dt in [0,-.05,.05]:
            p=dict(modelTrust=round(current['modelTrust']+dw,8),temperature=round(current['temperature']+dt,8))
            if not .6<=p['modelTrust']<=1 or not .8<=p['temperature']<=1.4:continue
            candidate_loss=loss(samples,p)
            if candidate_loss<best_loss-1e-12:best,best_loss=p,candidate_loss
    return best
def predict_universal(job,value):
    check_code()
    if job['modelId']!=MODEL_ID:raise ValueError('MODE_MISMATCH')
    snapshot=value.get('generalCalibration')
    if not snapshot or snapshot['protocol']!=PROTOCOL:raise ValueError('CALIBRATION_SNAPSHOT_MISSING')
    if snapshot['effectiveAt']>at(value['cutoffAt']):raise ValueError('FEATURE_LATE')
    output=fixed_predict({**job,'modelId':FIXED_ID},value);output['variant']=MODEL_ID
    if output['state']!='DONE':return output
    base=list(output['central']);p=dict(modelTrust=snapshot['modelTrust'],temperature=snapshot['temperature'])
    output['central']=calibrate(base,output['marketProbabilities'],p)
    if output['grid'] and output['central']!=base:
        output['grid']=coherent_grid(output['grid'],output['central'])
        output['goal']['expectedHome']=sum(i*x for i,row in enumerate(output['grid']) for x in row)
        output['goal']['expectedAway']=sum(j*x for row in output['grid'] for j,x in enumerate(row))
    output['adaptation']=dict(snapshot=snapshot,baseCentral=base,baseVariant=FIXED_ID)
    output['assumptions'].append('通用概率校准：只使用此前已冻结参数；不改旧预测、评级门槛或纸面仓位')
    return output
