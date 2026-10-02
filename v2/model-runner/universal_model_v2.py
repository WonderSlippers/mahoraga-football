"""Coherent score distribution; initial general recipe remains frozen separately."""
import hashlib,json
from pathlib import Path
from functools import lru_cache
from universal_model import predict_universal as initial, MODEL_ID as INITIAL_ID, center
ROOT=Path(__file__).parents[1]
MODEL_ID='GENERAL_FOOTBALL_RESEARCH_V2'
@lru_cache(maxsize=1)
def check_code():
    for path,expected in json.loads((ROOT/'packages/domain/general-v2-code-pins.json').read_text(encoding='utf8')).items():
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest()!=expected:raise ValueError('MODEL_CODE_CHANGED')
def coherent_grid(grid,central):
    mass=center(grid)
    if any(p<=0 for p in mass):raise ValueError('MODEL_OUTPUT_INVALID')
    # Preserve within-outcome score ratios while matching the blended 1X2.
    result=[[p*central[0 if i>j else 1 if i==j else 2]/mass[0 if i>j else 1 if i==j else 2] for j,p in enumerate(row)] for i,row in enumerate(grid)]
    if max(abs(a-b) for a,b in zip(center(result),central))>1e-10:raise ValueError('MODEL_OUTPUT_INVALID')
    return result
def predict_universal(job,value):
    check_code()
    if job['modelId']!=MODEL_ID:raise ValueError('MODE_MISMATCH')
    output=initial({**job,'modelId':INITIAL_ID},value)
    output['variant']=MODEL_ID
    if output['state']=='DONE' and output['grid']:
        output['grid']=coherent_grid(output['grid'],output['central'])
        output['goal']['expectedHome']=sum(i*p for i,row in enumerate(output['grid']) for p in row)
        output['goal']['expectedAway']=sum(j*p for row in output['grid'] for j,p in enumerate(row))
        output['assumptions'].append('完整比分分布与市场融合后的胜平负一致；所有玩法使用同一预测')
    return output
