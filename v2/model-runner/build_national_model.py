"""Offline research build. Only ordinary men's Friendly rows; cups may include ET.
Shootout fixtures are excluded. No fitting runs in the API or the pull runner.
"""
import csv, hashlib, json, math, urllib.request
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
from scipy.optimize import minimize

ROOT = Path(__file__).parents[1]
DIR = ROOT / '.models-local/universal'
DIR.mkdir(parents=True, exist_ok=True)
if (ROOT/'packages/domain/national-model-pin.json').exists():
    raise ValueError('FROZEN_MODEL_ALREADY_EXISTS_USE_A_NEW_VARIANT')
sources = []
for name in ['results', 'shootouts']:
    url = f'https://raw.githubusercontent.com/martj42/international_results/master/{name}.csv'
    with urllib.request.urlopen(url, timeout=30) as r:
        data = r.read()
    (DIR/f'{name}.csv').write_bytes(data)
    sources.append(dict(url=url, sha256=hashlib.sha256(data).hexdigest(), observedAt=datetime.now(timezone.utc).isoformat(), bytes=len(data)))
shootouts = {(r['date'], r['home_team'], r['away_team']) for r in csv.DictReader((DIR/'shootouts.csv').open(encoding='utf8'))}
rows = [r for r in csv.DictReader((DIR/'results.csv').open(encoding='utf8')) if r['tournament']=='Friendly' and '2010-01-01' <= r['date'] < '2026-10-01' and r['home_score'].isdigit() and r['away_score'].isdigit() and (r['date'],r['home_team'],r['away_team']) not in shootouts]
train = [r for r in rows if r['date'] < '2024-01-01']
calibration = [r for r in rows if '2024-01-01' <= r['date'] < '2025-01-01']
holdout = [r for r in rows if r['date'] >= '2025-01-01']
teams = sorted({r[k] for r in train for k in ['home_team','away_team']})
index = {t:i for i,t in enumerate(teams)}
n = len(teams)
h = np.array([index[r['home_team']] for r in train]); a = np.array([index[r['away_team']] for r in train])
venue = np.array([r['neutral']=='FALSE' for r in train], dtype=float)
yh = np.array([int(r['home_score']) for r in train]); ya = np.array([int(r['away_score']) for r in train])
days = np.array([(datetime(2024,1,1)-datetime.fromisoformat(r['date'])).days for r in train])
weight = np.exp(-math.log(2)*days/(365.25*3))
def objective(x):
    attack, defense = x[2:2+n], x[2+n:]
    eh = x[0]+x[1]*venue+attack[h]-defense[a]; ea = x[0]+attack[a]-defense[h]
    lh,la = np.exp(eh),np.exp(ea)
    loss = np.sum(weight*(lh-yh*eh+la-ya*ea))+10*np.sum(x[2:]**2)
    dh,da = weight*(lh-yh),weight*(la-ya)
    g = np.zeros_like(x); g[0] = np.sum(dh+da); g[1] = np.dot(dh,venue)
    g[2:2+n] = np.bincount(h,dh,minlength=n)+np.bincount(a,da,minlength=n)+20*attack
    g[2+n:] = -np.bincount(a,dh,minlength=n)-np.bincount(h,da,minlength=n)+20*defense
    return float(loss),g
fit = minimize(objective,np.zeros(2+2*n),jac=True,method='L-BFGS-B',options={'maxiter':1000,'ftol':1e-11})
if not fit.success: raise RuntimeError(fit.message)
x = fit.x
def distribution(row,temperature=1):
    if row['home_team'] not in index or row['away_team'] not in index: return None
    i,j = index[row['home_team']],index[row['away_team']]
    lh = min(4,max(.25,math.exp(x[0]+x[1]*(row['neutral']=='FALSE')+x[2+i]-x[2+n+j])))
    la = min(4,max(.25,math.exp(x[0]+x[2+j]-x[2+n+i])))
    pmf = lambda l: np.array([math.exp(-l)*l**k/math.factorial(k) for k in range(21)])
    grid = np.outer(pmf(lh),pmf(la)); grid = grid**(1/temperature); grid /= grid.sum()
    return np.array([np.tril(grid,-1).sum(),np.trace(grid),np.triu(grid,1).sum()])
def metrics(sample,temperature):
    ll=brier=0; accepted=[]; bins=[dict(lower=k/10,N=0,predicted=0,observed=0) for k in range(10)]
    for row in sample:
        p=distribution(row,temperature)
        if p is None: continue
        result=0 if int(row['home_score'])>int(row['away_score']) else 1 if int(row['home_score'])==int(row['away_score']) else 2
        ll-=math.log(max(1e-15,p[result])); brier+=float(np.sum((p-np.eye(3)[result])**2)); accepted.append(row)
        for i,v in enumerate(p):
            b=bins[min(9,int(v*10))];b['N']+=1;b['predicted']+=float(v);b['observed']+=int(i==result)
    count=len(accepted)
    for b in bins:
        b['predicted']=b['predicted']/b['N'] if b['N'] else None;b['observed']=b['observed']/b['N'] if b['N'] else None
    return dict(N=count,totalN=len(sample),coverage=count/len(sample) if sample else None,LogLoss=ll/count if count else None,Brier=brier/count if count else None,fromDate=min((r['date'] for r in accepted),default=None),throughDate=max((r['date'] for r in accepted),default=None),ROI=None,reason='NO_HISTORICAL_ODDS',calibration=bins)
temperatures=[.8,.9,1,1.1,1.2,1.3]
temperature=min(temperatures,key=lambda t:metrics(calibration,t)['LogLoss'])
counts={t:sum(r['home_team']==t or r['away_team']==t for r in train) for t in teams}
last={t:max(r['date'] for r in train if r['home_team']==t or r['away_team']==t) for t in teams}
validation=dict(trainingN=len(train),calibration=metrics(calibration,temperature),holdout=metrics(holdout,temperature),design='2010-2023 training; 2024 calibration; 2025+ holdout. Design selected during 2026 research, not prospective.',scope='Mens senior national Friendly only; competitive transfer unvalidated',limitations=['Cup and shootout scores excluded; not a result adjudication source','No historical prices; no ROI validation','Competitive and club transfer require their own forward evidence'])
artifact=dict(version='NATIONAL_FRIENDLY_RIDGE_POISSON_V1',trainingCutoffAt='2024-01-01T00:00:00Z',calibrationCutoffAt='2025-01-01T00:00:00Z',sourceObservedAt=max(s['observedAt'] for s in sources),sources=sources,intercept=float(x[0]),homeAdvantage=float(x[1]),temperature=temperature,teams={t:dict(attack=float(x[2+i]),defense=float(x[2+n+i]),N=counts[t],lastDate=last[t]) for t,i in index.items()},validation=validation)
encoded=json.dumps(artifact,sort_keys=True,separators=(',',':')).encode()
(DIR/'national-v1.json').write_bytes(encoded)
(ROOT/'model-runner/assets').mkdir(parents=True,exist_ok=True)
(ROOT/'model-runner/assets/national-v1.json').write_bytes(encoded)
pin=dict(artifactSha256=hashlib.sha256(encoded).hexdigest(),file='national-v1.json',validation=validation,sources=sources,trainingCutoffAt=artifact['trainingCutoffAt'],calibrationCutoffAt=artifact['calibrationCutoffAt'])
(ROOT/'packages/domain/national-model-pin.json').write_text(json.dumps(pin,ensure_ascii=False,indent=2),encoding='utf8')
(ROOT/'.runtime-v2/universal/national-build.json').write_text(json.dumps(pin,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(dict(teams=n,temperature=temperature,trainingN=len(train),calibration=validation['calibration'],holdout=validation['holdout'],artifactSha256=pin['artifactSha256'])))
