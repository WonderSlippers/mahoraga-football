"""Fixed archived inference for the user-visible lab. No fit/training/network.

The blended candidate is a separate fixed model from the unblended adapter.
Historical replay does not establish contemporaneous source capture.
"""
import importlib.util,json,sys,hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from research_adapters import v6,v7,load_artifact,digest,canonical,LEAGUES
ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'.models-local/research'
PINS=json.loads((ROOT/'model-runner/research-assets.json').read_text())
def checked(relative):
    p=ASSETS/relative
    if digest(p.read_bytes())!=PINS[relative]:raise ValueError('REFERENCE_HASH_MISMATCH')
    return p
spec=importlib.util.spec_from_file_location('reviewed_v7_reference',checked('mahoraga_v7_lab/code/model.py'))
ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
frame=pd.read_csv(checked('mahoraga_v7_lab/inputs/features.csv'))
population=frame[frame.season.eq(2026)].copy()
frame=population[population.common_eligible.eq(True)].copy()
if len(frame)<100:raise ValueError('INSUFFICIENT_REAL_ARCHIVED_INPUTS')
m7=load_artifact(checked('mahoraga_v7_lab/models/return_partial_2026.json'),PINS['mahoraga_v7_lab/models/return_partial_2026.json'])
original=ref.predict(m7,frame)
models=[dict(id='MARKET_PROPORTIONAL_V1',label='Market baseline',kind='CENTRAL_1X2',samples=[]),dict(id='V6_C388_STRESS_REFERENCE',label='V6 configuration 388',kind='SELECTION_STRESS_ONLY',samples=[]),dict(id='V7_RETURN_PARTIAL_QUOTE_WEIGHTED_FIXED',label='V7 fixed quote-weighted candidate',kind='CENTRAL_1X2',samples=[])]
maximum=0
for i,(_,row) in enumerate(frame.iterrows()):
    d=row.to_dict();d['odds']=[row.oh,row.od,row.oa]
    odds=np.array(d['odds']);q=1/odds;q=q/q.sum()
    m6path=f'mahoraga_v6_league_policies/models/HONEST_CANDIDATE_2025_{row.competition}.json'
    m6=load_artifact(checked(m6path),PINS[m6path])
    stress=v6(m6,d);raw=np.array(v7(m7,d,row.competition)['central'])
    alpha=m7['blend']['league_alpha'].get(row.competition,m7['blend']['global_alpha'])
    blended=q+alpha*(raw-q)
    error=float(np.max(abs(blended-original[i])));maximum=max(maximum,error)
    if error>1e-8:raise ValueError('FIXED_CANDIDATE_PARITY_FAILED')
    for model,central in zip(models,[q,None,blended]):
        if central is None:action=stress['action'];side=['HOME','DRAW','AWAY'].index(action) if action!='NO_ACTION' else -1;ev=stress['estimatedEV']
        else:
            evs=central*odds-1;eligible=(odds>=1.8)&(odds<=2.5)&(evs>=.02);side=int(np.where(eligible,evs,-np.inf).argmax()) if eligible.any() else -1;action=['HOME','DRAW','AWAY'][side] if side>=0 else 'NO_ACTION';ev=float(evs[side]) if side>=0 else None
        model['samples'].append(dict(fixtureId=row.fixture_id,date=row.date,season=int(row.season),competition=row.competition,home=row.home,away=row.away,outcome=int(row.outcome),central=None if central is None else central.tolist(),stressBySelection=stress['stressBySelection'] if central is None else None,marketOdds=odds.tolist(),action=action,odds=float(odds[side]) if side>=0 else None,pnl=float(odds[side]-1 if side==row.outcome else -1) if side>=0 else None,estimatedEV=ev,priceSource=row.odds_source if isinstance(row.odds_source,str) else None))
for m in models:m.update(sampleManifestHash=digest(canonical(frame.fixture_id.tolist()).encode()),scope='2026_COMMON_ELIGIBLE_ARCHIVED_REPLAY',trainCutoff=m7.get('last_train_date') if m['id'].startswith('V7') else None,calibrationCutoff=m7['blend']['last_calibration_date'] if m['id'].startswith('V7') else None,validation='HISTORICAL_REPLAY_NOT_PROSPECTIVE')
models[2]['artifactHash']=PINS['mahoraga_v7_lab/models/return_partial_2026.json']
models[2]['fixedBlend']=m7['blend']
models[1]['artifactEvidence']=[dict(competition=league,artifactHash=PINS[f'mahoraga_v6_league_policies/models/HONEST_CANDIDATE_2025_{league}.json'],trainingAudit=json.loads(checked(f'mahoraga_v6_league_policies/models/HONEST_CANDIDATE_2025_{league}.json').read_text()).get('training_audit'),config388Posthoc=True) for league in LEAGUES]
models[1]['validation']='POSTHOC_CONFIG_388_HISTORICAL_NOT_PROSPECTIVE'
reports=[]
for relative in ['mahoraga_v7_lab/outputs/return_annual.csv','mahoraga_v6_league_policies/outputs/honest_candidate_annual_final.csv']:
    p=ASSETS/relative
    if p.exists():reports.append(dict(source=relative,hash=digest(p.read_bytes()),scope='ORIGINAL_ARCHIVED_REPORT_NOT_RECOMPUTED_NOT_LIVE',rows=pd.read_csv(p).replace({np.nan:None}).to_dict('records')))
excluded=population[~population.common_eligible.eq(True)]
population_info=dict(originalN=len(population),eligibleN=len(frame),excludedN=len(excluded),eligibilityBasis='Original common_eligible flag, not reselected by results',excluded=[dict(fixtureId=r.fixture_id,date=r.date,competition=r.competition,reason='ORIGINAL_COMMON_ELIGIBLE_FALSE',missingFeatures=[k for k in ['oh','od','oa','z_diff_xgf5','z_diff_xga5','z_diff_xgf15','z_diff_xga15','z_diff_sot5','z_diff_sota5'] if k in r.index and pd.isna(r[k])]) for _,r in excluded.iterrows()],sampleCutoff=frame.date.max(),replayGeneratedAt=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat())
population_info['originalRows']=[dict(fixtureId=r.fixture_id,date=r.date,season=int(r.season),competition=r.competition,marketOdds=[None if pd.isna(r[k]) else float(r[k]) for k in ['oh','od','oa']],eligible=bool(r.common_eligible)) for _,r in population.iterrows()]
out=dict(models=models,population=population_info,originalSeasonReports=reports,scope='HISTORICAL_REPLAY_NON_PROSPECTIVE',limitations=['原始捕获时间缺失；不是严格前瞻成绩','Market基准无正EV动作时N=0、ROI=null','V6配置388为事后选出的探索性配置，不能当作前瞻验证','V6压力输出不进入三分类LogLoss/Brier','融合与raw是不同固定变体；没有自动晋升','跨季原报告与本次共同样本重放分开展示'],sourceHashes=PINS)
target=ROOT/'.runtime-v2/workspace-study.json';target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(out,ensure_ascii=False,allow_nan=False),encoding='utf-8')
proof=dict(command='python model-runner/build_workspace_study.py',rows=len(frame),fixedQuoteWeightedReferenceMaxError=maximum,actions={m['id']:sum(s['action']!='NO_ACTION' for s in m['samples']) for m in models},outputHash=digest(target.read_bytes()),status='HISTORICAL_FIXED_CANDIDATE_PARITY_PASS',prospective=False)
(ROOT/'.runtime-v2/feature-parity/fixed-candidate-parity.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
print(json.dumps(proof))
