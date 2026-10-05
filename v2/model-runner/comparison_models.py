"""Frozen shadow inference. No fetching, fitting, database access or promotion."""
from __future__ import annotations
import hashlib,json,subprocess
from pathlib import Path
from datetime import datetime,timedelta
from functools import lru_cache
from research_adapters import v6,LEAGUES,SIDES

ROOT=Path(__file__).parents[1]
SEALED=ROOT/'.models-local/frozen/20261001-r1'
V6_ID='V6_C388_FROZEN_20261001'
LEGACY_ID='LEGACY_20260920_FROZEN_V2'
IDS={V6_ID,LEGACY_ID}

@lru_cache(maxsize=1)
def assets():
    pins=json.loads((ROOT/'model-runner/comparison-assets-r1.json').read_text(encoding='utf8'))
    for name,expected in pins['assets'].items():
        if hashlib.sha256((SEALED/name).read_bytes()).hexdigest()!=expected:raise ValueError('FROZEN_ASSET_CHANGED:'+name)
    code=json.loads((ROOT/'model-runner/comparison-code-pins.json').read_text(encoding='utf8'))
    for name,expected in code.items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=expected:raise ValueError('FROZEN_CODE_CHANGED:'+name)
    return pins

def blocked(variant,reason,**extra):
    return dict(variant=variant,state='BLOCKED',reason=reason,central=None,actions=[],researchOnly=True,**extra)

def timestamp(value):return datetime.fromisoformat(value.replace('Z','+00:00'))
def form(games):return ''.join('W' if g['gf']>g['ga'] else 'D' if g['gf']==g['ga'] else 'L' for g in games)

def legacy(value):
    f=value.get('comparisonFeatures',{});offers=f.get('offers',[])
    cutoff=timestamp(value['cutoffAt']); kickoff=timestamp(value['kickoffAt'])
    if not 600<=(kickoff-cutoff).total_seconds()<=86400:return blocked(LEGACY_ID,'OUTSIDE_ORIGINAL_10MIN_24H_WINDOW')
    features=value.get('researchFeatures',{})
    if any(timestamp(g['at'])>=cutoff for side in ['homeRecent','awayRecent'] for g in features.get(side,[])):raise ValueError('FEATURE_LATE')
    goal=f.get('goalStats')
    if goal and (goal['observedAt']>cutoff.timestamp()*1000 or any(s['observedAt']>cutoff.timestamp()*1000 for s in goal['sourceRefs'])):raise ValueError('FEATURE_LATE')
    if not any(o['market'] in ['ASIAN_HANDICAP','TOTAL_GOALS'] for o in offers):goal=None
    match=dict(id=value['fixtureId'],leagueCode=f['competition'],home=f['home'],away=f['away'],date=kickoff.timestamp()*1000,
        status='soon',detail='',odds=[float(x) for x in value['odds']],providers=['Frozen public reference']*3,
        homeForm=form(features.get('homeRecent',[])),awayForm=form(features.get('awayRecent',[])),spreadOffers=[],totalOffers=[])
    by={(o['market'],o['selection']):o for o in offers}
    if ('ASIAN_HANDICAP','HOME') in by and ('ASIAN_HANDICAP','AWAY') in by:
        h,a=by['ASIAN_HANDICAP','HOME'],by['ASIAN_HANDICAP','AWAY']
        match['spreadOffers']=[dict(homeLine=h['lineQ']/4,awayLine=a['lineQ']/4,home=float(h['odds']),away=float(a['odds']),provider='Frozen public reference',phase='current')]
    if ('TOTAL_GOALS','OVER') in by and ('TOTAL_GOALS','UNDER') in by:
        h,a=by['TOTAL_GOALS','OVER'],by['TOTAL_GOALS','UNDER']
        if h['lineQ']==a['lineQ']:match['totalOffers']=[dict(line=h['lineQ']/4,over=float(h['odds']),under=float(a['odds']),provider='Frozen public reference',phase='current')]
    result=subprocess.run(['node',str(ROOT/'model-runner/legacy-bridge.mjs')],input=json.dumps([dict(at=cutoff.timestamp()*1000,match=match,goalStats=goal)]),text=True,encoding='utf8',capture_output=True,check=True,timeout=15)
    computed=json.loads(result.stdout)[0];broad=computed['broad'];best=computed['featured']
    if not broad:return blocked(LEGACY_ID,'NO_ORIGINAL_ELIGIBLE_DIRECTION')
    actions=[]
    for candidate,strategy in [(broad,'BROAD_1X2'),(best,'FEATURED_BEST_MARKET')]:
        if not candidate:continue
        leg=candidate['leg'];market={'spread':'ASIAN_HANDICAP','total':'TOTAL_GOALS'}.get(leg.get('market'),'1X2')
        selection=SIDES[leg['pick']] if market=='1X2' else leg['side'].upper()
        line=None if market=='1X2' else round(leg['line']*4)
        offer=next((o for o in offers if o['market']==market and o['selection']==selection and o['lineQ']==line),None)
        if not offer:raise ValueError('QUOTE_MISMATCH')
        actions.append(dict(strategy=strategy,market=market,selection=selection,lineQ=line,odds=offer['odds'],probability=leg['probability'],estimatedEV=candidate['edge']))
    return dict(variant=LEGACY_ID,state='DONE',central=broad['leg']['evidence']['adjustedProbabilities'],actions=actions,
        reason='ORIGINAL_FIXED_DEFAULTS_RESEARCH',evidence=broad['leg']['evidence'],goalModel=computed['goalModel'],
        modelWeight=.5,evolutionMarginShift=0,validation='UNVALIDATED_FORWARD_RESEARCH',researchOnly=True,
        limitations=['Old source defaults; exact dirty runtime unknown','Public reference quote, not execution price','Per-fixture best-market recording; original daily top-10 and portfolio limits are separate policies'])

def v6_shadow(value):
    f=value.get('comparisonFeatures',{});league=f.get('competition')
    if league not in LEAGUES:return blocked(V6_ID,'UNSUPPORTED_COMPETITION')
    feature=f.get('featureRow')
    if not feature:return blocked(V6_ID,'LIVE_RAW_FEATURE_SNAPSHOT_PENDING')
    decision=timestamp(value['cutoffAt']);quote=timestamp(value['observedAt'])
    if decision-quote>timedelta(minutes=10):return blocked(V6_ID,'QUOTE_STALE')
    if datetime.fromisoformat(feature['historyLastDate']).date()>=decision.date()-timedelta(days=2):return blocked(V6_ID,'HISTORY_EMBARGO')
    if any(s['observedAt']>decision.timestamp()*1000 for s in f['featureSources']):raise ValueError('FEATURE_LATE')
    model=json.loads((SEALED/f'mahoraga_v6_league_policies/models/HONEST_CANDIDATE_2025_{league}.json').read_text(encoding='utf8'));audit=model['training_audit']
    if any(datetime.fromisoformat(audit[k]).date()>=decision.date() for k in ['last_discovery_date','last_calibration_date']):return blocked(V6_ID,'MODEL_TIME_LEAKAGE')
    row=dict(feature['features']);odds=[float(x) for x in value['odds']];q=[1/o for o in odds];total=sum(q)
    row.update(odds=odds,overround=total,**dict(zip(['q_home','q_draw','q_away'],[x/total for x in q])))
    try:out=v6(model,row)
    except ValueError as exc:return blocked(V6_ID,str(exc))
    out.update(variant=V6_ID,state='DONE',actions=[],featureHash=f['featureHash'],historyLastDate=feature['historyLastDate'],dataCompleteness=feature['completeness'],validation='POSTHOC_CONFIG_FROZEN_FORWARD_RESEARCH')
    if out['action']!='NO_ACTION':
        offer=next(o for o in f['offers'] if o['market']=='1X2' and o['selection']==out['action'])
        out['actions']=[dict(strategy='V6_NATIVE',**offer,probability=out['stressBySelection'][out['action']],estimatedEV=out['estimatedEV'])]
    return out

def predict_comparison(job,value):
    if value['mode']!='LOCAL_RESEARCH':raise ValueError('MODE_MISMATCH')
    assets()
    if job['modelId']==V6_ID:return v6_shadow(value)
    if job['modelId']==LEGACY_ID:return legacy(value)
    raise ValueError('VARIANT_UNKNOWN')
