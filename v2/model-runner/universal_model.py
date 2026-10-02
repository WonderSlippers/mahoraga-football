"""General fixed research recipe, distinct from the saved V2/V6/V7 variants."""
import hashlib,json,math,subprocess
from pathlib import Path
from functools import lru_cache
from datetime import datetime
from comparison_models import assets

ROOT=Path(__file__).parents[1]
MODEL_ID='GENERAL_FOOTBALL_RESEARCH_V1'
SIDES=['HOME','DRAW','AWAY']
ALIASES={'United States':'United States','USA':'United States','United States of America':'United States','Korea Republic':'South Korea','Republic of Korea':'South Korea','Korea DPR':'North Korea','Congo DR':'DR Congo','Congo Democratic Republic':'DR Congo','Ivory Coast':"Ivory Coast",'Côte d’Ivoire':'Ivory Coast','Cote d Ivoire':'Ivory Coast','Türkiye':'Turkey','Turkiye':'Turkey','Czechia':'Czech Republic','Cape Verde Islands':'Cape Verde','Republic of Ireland':'Republic of Ireland','China PR':'China','IR Iran':'Iran','Chinese Taipei':'Taiwan','UAE':'United Arab Emirates','Kyrgyz Republic':'Kyrgyzstan'}
def at(s):return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000
@lru_cache(maxsize=1)
def national():
    pins=json.loads((ROOT/'packages/domain/universal-code-pins.json').read_text(encoding='utf8'))
    for file,expected in pins.items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest()!=expected:raise ValueError('MODEL_CODE_CHANGED')
    pin=json.loads((ROOT/'packages/domain/national-model-pin.json').read_text(encoding='utf8'))
    raw=(ROOT/'model-runner/assets/national-v1.json').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=pin['artifactSha256']:raise ValueError('MODEL_HASH_MISMATCH')
    return json.loads(raw)
def center(grid):
    return [sum(p for i,row in enumerate(grid) for j,p in enumerate(row) if i>j),sum(row[i] for i,row in enumerate(grid)),sum(p for i,row in enumerate(grid) for j,p in enumerate(row) if i<j)]
def pmf(l):return [math.exp(-l)*l**k/math.factorial(k) for k in range(21)]
def predict_universal(job,value):
    assets()
    if value['mode']!='LOCAL_RESEARCH' or job['modelId']!=MODEL_ID:raise ValueError('MODE_MISMATCH')
    cutoff=at(value['cutoffAt']); features=value.get('researchFeatures',{}); f=value['comparisonFeatures']
    if features and features['observedAt']>cutoff:raise ValueError('FEATURE_LATE')
    neutral=features.get('neutralSite')
    if neutral not in [True,False]:
        return dict(state='BLOCKED',reason='NEUTRAL_VENUE_UNKNOWN',central=None,grid=None,researchOnly=True,variant=MODEL_ID)
    q=[1/float(o) for o in value['odds']];q=[p/sum(q) for p in q]
    form=[]
    for side in ['homeRecent','awayRecent']:
        games=features.get(side,[])
        if any(at(g['at'])>=cutoff for g in games):raise ValueError('FEATURE_LATE')
        games=[g for g in games if cutoff-at(g['at'])<=180*86400000]
        form.append(sum(3 if g['gf']>g['ga'] else 1 if g['gf']==g['ga'] else 0 for g in games)/len(games) if games else None)
    delta=max(-.08,min(.08,(form[0]-form[1])*.025)) if None not in form else 0
    raw=[max(.025,q[0]+delta),q[1],max(.025,q[2]-delta)];raw=[p/sum(raw) for p in raw]
    grid=None; goal=None; basis='MARKET_FORM_ONLY'; margin=.02805; sampleN=None; assumptions=[]
    artifact=national();h=artifact['teams'].get(ALIASES.get(f['home'],f['home']));a=artifact['teams'].get(ALIASES.get(f['away'],f['away']))
    # Exact senior-team names only; no fuzzy club/U21/women mapping.
    national_competition=f['competition'] in {'fifa.friendly','fifa.world','uefa.nations','uefa.euro','uefa.euroq','afc.cupq','caf.nations_qual','concacaf.nations.league','fifa.worldq.uefa','fifa.worldq.afc','fifa.worldq.caf','fifa.worldq.concacaf','fifa.worldq.conmebol','fifa.worldq.ofc'}
    if national_competition and h and a and min(h['N'],a['N'])>=10:
        if max(at(artifact['sourceObservedAt']),at(artifact['calibrationCutoffAt']))>cutoff:raise ValueError('FEATURE_LATE')
        lh=min(4,max(.25,math.exp(artifact['intercept']+(0 if neutral else artifact['homeAdvantage'])+h['attack']-a['defense'])))
        la=min(4,max(.25,math.exp(artifact['intercept']+a['attack']-h['defense'])))
        grid=[[(hp*ap)**(1/artifact['temperature']) for ap in pmf(la)] for hp in pmf(lh)]
        total=sum(map(sum,grid));grid=[[p/total for p in row] for row in grid]
        basis='NATIONAL_OPPONENT_ADJUSTED_POISSON';margin=.08;sampleN=min(h['N'],a['N'])
        goal=dict(expectedHome=sum(i*p for i,row in enumerate(grid) for p in row),expectedAway=sum(j*p for row in grid for j,p in enumerate(row)),fittedLambdaHome=lh,fittedLambdaAway=la,artifactHash=hashlib.sha256((ROOT/'model-runner/assets/national-v1.json').read_bytes()).hexdigest(),trainingCutoffAt=artifact['trainingCutoffAt'],validation=artifact['validation']['scope'])
        assumptions=['国家队对手强度攻防模型；仅友谊赛训练和时间外验证','用于正式国家队赛事的迁移尚未验证；不等于V6','首发和伤停未量化，原模型权重固定']
    elif f.get('goalStats'):
        g=f['goalStats']
        if g['observedAt']>cutoff or any(s['observedAt']>cutoff for s in g['sourceRefs']):raise ValueError('FEATURE_LATE')
        run=subprocess.run(['node',str(ROOT/'model-runner/universal-goals.mjs')],input=json.dumps(dict(goalStats=g,neutral=neutral,at=cutoff)),capture_output=True,text=True,encoding='utf8',check=True,timeout=15)
        result=json.loads(run.stdout)
        if result:
            grid=result['grid'];goal=result['evidence'];basis='CLUB_STANDINGS_POISSON';margin=goal['uncertaintyMargin'];sampleN=min(g['home']['games'],g['away']['games'])
            assumptions=['恢复旧版积分榜收缩进球模型；不限五大联赛','同一赛事统计，不拿跨赛事积分榜硬套','缺伤停、首发的影响未量化']
    if grid:
        pg=center(grid);raw=[.5*r+.5*p for r,p in zip(raw,pg)];raw=[p/sum(raw) for p in raw]
    if all(v is None for v in form) and not grid:basis='MARKET_ONLY'
    return dict(variant=MODEL_ID,state='DONE',reason=basis,central=raw,grid=grid,uncertaintyMargin=margin,basis=basis,sampleN=sampleN,goal=goal,formDelta=delta,marketProbabilities=q,neutralSite=neutral,assumptions=assumptions,validation='UNVALIDATED_FORWARD_RESEARCH',researchOnly=True)
