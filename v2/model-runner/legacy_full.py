"""Preserved Sept20 rules with an explicit, immutable runtime state snapshot. No DB or training."""
import json,subprocess
from pathlib import Path
from datetime import datetime
MODEL_ID='LEGACY_20260920_FULL_RULES_V1'
ROOT=Path(__file__).parents[1]
def predict_legacy_full(job,value):
    f=value.get('comparisonFeatures',{});state=f.get('legacyState')
    if not state:return dict(variant=MODEL_ID,state='BLOCKED',reason='LEGACY_STATE_SNAPSHOT_MISSING',central=None,researchOnly=True)
    cutoff=datetime.fromisoformat(value['cutoffAt'].replace('Z','+00:00')).timestamp()*1000
    kickoff=datetime.fromisoformat(value['kickoffAt'].replace('Z','+00:00')).timestamp()*1000
    if not 600000<=kickoff-cutoff<=86400000:return dict(variant=MODEL_ID,state='BLOCKED',reason='OUTSIDE_ORIGINAL_10MIN_24H_WINDOW',central=None,researchOnly=True)
    form=lambda side:''.join('W' if g['gf']>g['ga'] else 'D' if g['gf']==g['ga'] else 'L' for g in value.get('researchFeatures',{}).get(side,[]))
    for side in ['homeRecent','awayRecent']:
        if any(datetime.fromisoformat(g['at'].replace('Z','+00:00')).timestamp()*1000>=cutoff for g in value.get('researchFeatures',{}).get(side,[])):raise ValueError('FEATURE_LATE')
    goal=f.get('goalStats')
    if goal and (goal['observedAt']>cutoff or any(s['observedAt']>cutoff for s in goal['sourceRefs'])):raise ValueError('FEATURE_LATE')
    match=dict(id=value['fixtureId'],leagueCode=f['competition'],home=f['home'],away=f['away'],date=kickoff,status='soon',detail='',odds=[float(x) for x in value['odds']],providers=['Frozen public reference']*3,homeForm=form('homeRecent'),awayForm=form('awayRecent'),spreadOffers=[],totalOffers=[])
    offers={(o['market'],o['selection']):o for o in f['offers']}
    if ('ASIAN_HANDICAP','HOME') in offers and ('ASIAN_HANDICAP','AWAY') in offers:
        h,a=offers['ASIAN_HANDICAP','HOME'],offers['ASIAN_HANDICAP','AWAY'];match['spreadOffers']=[dict(homeLine=h['lineQ']/4,awayLine=a['lineQ']/4,home=float(h['odds']),away=float(a['odds']),provider='Frozen public reference',phase='current')]
    if ('TOTAL_GOALS','OVER') in offers and ('TOTAL_GOALS','UNDER') in offers:
        h,a=offers['TOTAL_GOALS','OVER'],offers['TOTAL_GOALS','UNDER']
        if h['lineQ']==a['lineQ']:match['totalOffers']=[dict(line=h['lineQ']/4,over=float(h['odds']),under=float(a['odds']),provider='Frozen public reference',phase='current')]
    result=subprocess.run(['node',str(ROOT/'model-runner/legacy-full-bridge.mjs')],input=json.dumps(dict(at=cutoff,evolution=state['evolution'],match=match,goalStats=goal)),text=True,encoding='utf8',capture_output=True,check=True,timeout=15)
    out=json.loads(result.stdout)
    if not out['central']:return dict(variant=MODEL_ID,state='BLOCKED',reason='NO_ORIGINAL_ELIGIBLE_DIRECTION',central=None,researchOnly=True)
    return dict(out,variant=MODEL_ID,state='DONE',reason='ORIGINAL_RULES_WITH_ARCHIVED_STATE',stateRevision=state['revision'],evolution=state['evolution'],researchOnly=True,validation='PRESERVED_SOURCE_NOT_PROVEN_DIRTY_RUNTIME')
