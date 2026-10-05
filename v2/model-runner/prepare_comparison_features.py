"""Offline lagged-feature preparation. Source data only; never writes a database.

Model weights remain frozen. Monthly historical Poisson fitting is the original
feature recipe, run only in this separate collector, never in the web request.
"""
from __future__ import annotations
import sys,json,math,hashlib,subprocess,urllib.request,os,importlib.util,time
from pathlib import Path
from collections import defaultdict,deque
from functools import lru_cache
from datetime import datetime,timezone
import numpy as np
import pandas as pd
from comparison_models import assets,ROOT,SEALED

assets()
spec=importlib.util.spec_from_file_location('original_build',SEALED/'upstream/build_features.py')
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
ALIASES=json.loads((ROOT/'packages/display/team-names.json').read_text(encoding='utf8'))
EXPLICIT={'Paris Saint-Germain':'Paris SG','Espanyol':'Espanol','Atlético Madrid':'Ath Madrid','Athletic Club':'Ath Bilbao',
    'Real Sociedad':'Sociedad','Rayo Vallecano':'Vallecano','Real Betis':'Betis','Deportivo La Coruña':'La Coruna',
    'Racing Santander':'Santander','VfL Wolfsburg':'Wolfsburg','FC St. Pauli':'St Pauli','Borussia Mönchengladbach':'Borussia Monchengladbach',
    'Köln':'FC Cologne','1. FC Köln':'FC Cologne','Stuttgart':'VfB Stuttgart','Freiburg':'SC Freiburg',
    'Union Berlin':'1. FC Union Berlin','Paderborn':'SC Paderborn 07','Hamburger SV':'Hamburg SV','Internazionale':'Inter',
    'Manchester City':'Man City','Manchester United':'Man United','Nottingham Forest':"Nott'm Forest",'Newcastle United':'Newcastle',
    'Brighton & Hove Albion':'Brighton','AFC Bournemouth':'Bournemouth','Ipswich Town':'Ipswich','Hull City':'Hull','Coventry City':'Coventry'}

def digest(data):return hashlib.sha256(data).hexdigest()
def identity(name,known):
    if name in known:return name
    if EXPLICIT.get(name) in known:return EXPLICIT[name]
    chinese=ALIASES.get(name)
    matches=[n for n in known if chinese and ALIASES.get(n)==chinese]
    if len(matches)==1:return matches[0]
    raise ValueError('TEAM_MAPPING_REQUIRED:'+name)

def history_inputs():
    raw=ROOT/'.models-local/research/mahoraga_v7_lab/inputs/raw.csv'
    before=raw.read_bytes();d=pd.read_csv(raw,low_memory=False)
    source=[dict(url='USER_PROVIDED_MODEL_PACKAGE:mahoraga_v7_lab/inputs/raw.csv',sha256=digest(before),observedAt=int(time.time()*1000))]
    cache=ROOT/'.runtime-v2/research/features/source-manifest.json'
    if cache.exists():
        captures=json.loads(cache.read_text(encoding='utf8'))
        new=[]
        for s in captures:
            file=ROOT/s['file'];data=file.read_bytes()
            if digest(data)!=s['sha256']:raise ValueError('SOURCE_HASH_MISMATCH')
            f=pd.read_csv(file);league=s['competition']
            valid=f.FTHG.notna()&f.FTAG.notna()
            for r in f[valid].to_dict('records'):
                date=pd.to_datetime(r['Date'],dayfirst=True).strftime('%Y-%m-%d')
                row=dict(date=date,competition=league,season=s['season'],home=r['HomeTeam'],away=r['AwayTeam'],hg_result=r['FTHG'],ag_result=r['FTAG'])
                for key,csv in [('home_shots','HS'),('away_shots','AS'),('home_sot','HST'),('away_sot','AST'),('xg_home','HxG'),('xg_away','AxG')]:row[key]=r.get(csv,np.nan)
                # Historical residual features use the same declared pre-match average source; never substitute live odds here.
                for key,csv in [('oh','AvgH'),('od','AvgD'),('oa','AvgA')]:row[key]=r.get(csv,np.nan)
                new.append(row)
            source.append({k:s[k] for k in ['url','sha256','observedAt']})
        if new:d=pd.concat([d,pd.DataFrame(new)],ignore_index=True)
    d=d[d.competition.isin(original.LEAGUES)].copy();d.date=pd.to_datetime(d.date).dt.normalize()
    if not (d[['hg_result','ag_result']].ge(0)&d[['hg_result','ag_result']].mod(1).eq(0)).all().all():raise ValueError('RESULT_REVIEW')
    d=d.sort_values(['competition','date','home','away'],kind='stable').drop_duplicates(['competition','date','home','away'],keep='last')
    return d,source

def build_feature(target,d,decision_date=None):
    day=pd.Timestamp(target['kickoffAt'],unit='ms').normalize()
    asof=pd.Timestamp(decision_date).normalize() if decision_date else pd.Timestamp.now(tz='UTC').tz_localize(None).normalize()
    cutoff=min(day,asof)-pd.Timedelta(days=2)
    league=target['competition'];hist=d[(d.competition==league)&(d.date<cutoff)].sort_values(['date','home','away'])
    if hist.empty:raise ValueError('RAW_HISTORY_MISSING')
    known=set(hist.home)|set(hist.away);home=identity(target['home'],known);away=identity(target['away'],known)
    # The same known identities are used throughout ratings, splits and recent history.
    elo={k:defaultdict(lambda:1500.) for k in [20,16,40]};rec=defaultdict(lambda:deque(maxlen=25));stats={};season_goals=defaultdict(float);season_matches=defaultdict(int)
    for r in hist.itertuples():
        s=stats.setdefault(int(r.season),{});original.add(s,r);season_goals[int(r.season)]+=r.hg_result+r.ag_result;season_matches[int(r.season)]+=1
        o=np.array([r.oh,r.od,r.oa],float);q=(1/o)/(1/o).sum() if np.isfinite(o).all() and (o>1).all() else np.ones(3)/3
        result=float(r.hg_result>r.ag_result)+.5*float(r.hg_result==r.ag_result)
        for k,R in elo.items():
            e=1/(1+10**(-(R[r.home]+65-R[r.away])/400));delta=k*(result-e);R[r.home]+=delta;R[r.away]-=delta
        for tm,own,opp,xown,xopp,sot,sota,side in [(r.home,r.hg_result,r.ag_result,r.xg_home,r.xg_away,r.home_sot,r.away_sot,0),(r.away,r.ag_result,r.hg_result,r.xg_away,r.xg_home,r.away_sot,r.home_sot,2)]:
            rec[tm].append(dict(date=r.date,gf=own,ga=opp,resid=3*(own>opp)+(own==opp)-(3*q[side]+q[1]),xgf=xown,xga=xopp,sot=sot,sota=sota,goal_luck=own-xown if np.isfinite(xown) else np.nan))
    f={'elo_diff':(elo[20][home]+65-elo[20][away])/400,'z_elo16':(elo[16][home]+65-elo[16][away])/400,'z_elo40':(elo[40][home]+65-elo[40][away])/400}
    f['z_elo_momentum']=f['z_elo40']-f['z_elo16'];means={};counts={}
    for side,tm,zside in [('home',home,'h'),('away',away,'a')]:
        games=list(rec[tm]);f[side+'_rest']=min(30,(day-games[-1]['date']).days);f['z_'+zside+'_n']=len(games)
        for n in [5,10]:
            for key,prior in [('gf',1.35),('ga',1.35),('resid',0)]:f[f'{side}_{key}_{n}']=(sum(g[key] for g in games[-n:])+prior*3)/(min(n,len(games))+3)
        for n in [5,15]:
            for key,prior in [('xgf',1.35),('xga',1.35),('sot',4),('sota',4),('goal_luck',0)]:
                values=[float(g[key]) for g in games[-n:] if np.isfinite(g[key])]
                means[side,key,n]=(sum(values)+prior*3)/(len(values)+3);counts[side,key,n]=len(values)
        f[f'z_{zside}_xgf_n15']=counts[side,'xgf',15]
    for n in [5,15]:
        for key in ['xgf','xga','goal_luck','sot','sota']:f[f'z_diff_{key}{n}']=means['home',key,n]-means['away',key,n]
    fc=min(day,asof).replace(day=1)-pd.Timedelta(days=2)
    fit_hist=hist[(hist.date<fc)&(hist.date>=fc-pd.Timedelta(days=730))]
    fit=original.fit_poisson(fit_hist,fc);lh,la=original.pois_predict(fit,home,away);p=original.scoregrid(lh,la)
    f.update(opp_ph=float(p[0]),opp_pd=float(p[1]))
    season=day.year if day.month>=7 else day.year-1;s=stats.get(season,{})
    if home not in s or away not in s:raise ValueError('CURRENT_SEASON_SPLIT_MISSING')
    goal=dict(home=s[home],away=s[away],mean=season_goals[season]/(2*season_matches[season]),season=season,operation='current')
    prev=stats.get(season-1,{})
    if home in prev and away in prev and min(prev[home]['games'],prev[away]['games'])>=15:goal.update(operation='previous',homePrev=prev[home],awayPrev=prev[away],meanPrev=season_goals[season-1]/(2*season_matches[season-1]))
    bridge="import fs from 'node:fs';import {makeGoalEvidence,makeCurrentOnlyGoalEvidence,dcScoreGrid} from './.models-local/frozen/20261001-r1/upstream/goal-core.mjs';const v=JSON.parse(fs.readFileSync(0,'utf8'));const g=v.operation==='previous'?makeGoalEvidence(v.home,v.away,v.homePrev,v.awayPrev,v.mean,v.meanPrev,[],[],0):makeCurrentOnlyGoalEvidence(v.home,v.away,v.mean,'',v.season,0);let ph=0,pd=0;for(const [i,row]of dcScoreGrid(g.expectedHome,g.expectedAway).entries())for(const[j,p]of row.entries()){if(i>j)ph+=p;if(i===j)pd+=p;}process.stdout.write(JSON.stringify({old_ph:ph,old_pd:pd,old_margin:g.uncertaintyMargin}));"
    result=subprocess.run(['node','--input-type=module','-e',bridge],cwd=ROOT,input=json.dumps(goal),text=True,encoding='utf8',capture_output=True,check=True,timeout=15)
    f.update(json.loads(result.stdout))
    if any(not math.isfinite(float(v)) for v in f.values()):raise ValueError('NONFINITE_FEATURE')
    return dict(fixtureId=target['fixtureId'],competition=league,homeMapped=home,awayMapped=away,historyLastDate=hist.date.max().strftime('%Y-%m-%d'),cutoffExclusive=cutoff.strftime('%Y-%m-%d'),features=f,
        recipe='ORIGINAL_V6_LAGGED_RECIPE_V1',completeness=dict(homeHistory=len(rec[home]),awayHistory=len(rec[away]),homeXgN15=counts['home','xgf',15],awayXgN15=counts['away','xgf',15],fixedPriorsUsed=counts['home','xgf',15]<min(15,len(rec[home])) or counts['away','xgf',15]<min(15,len(rec[away])),historyOddsFallback='UNIFORM_PRIOR_WHEN_MISSING'))

def main():
    base=os.environ['V2_API'];token=os.environ['V2_SERVICE_TOKEN']
    if not base.startswith('http://127.0.0.1:'):raise ValueError('HOST_INVALID')
    def call(route,payload=None):
        req=urllib.request.Request(base+route,json.dumps(payload,allow_nan=False).encode() if payload else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)['data']
    d,sources=history_inputs();sources.append(dict(url='FROZEN_SOURCE:upstream/build_features.py',sha256=assets()['assets']['upstream/build_features.py'],observedAt=int(time.time()*1000)))
    targets=call('/internal/v2/comparison/targets');done=0;failures=[]
    for target in targets:
        try:
            value=build_feature(target,d);call('/internal/v2/comparison/features',dict(fixtureId=target['fixtureId'],payload=value,sources=sources));done+=1
        except Exception as exc:failures.append(dict(fixtureId=target['fixtureId'],reason=str(exc)[:180]))
    result=dict(at=datetime.now(timezone.utc).isoformat(),targets=len(targets),prepared=done,failures=failures,historyLastDate=d.date.max().strftime('%Y-%m-%d'))
    out=ROOT/'.runtime-v2/research/features/status.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result),flush=True)

if __name__=='__main__':main()
