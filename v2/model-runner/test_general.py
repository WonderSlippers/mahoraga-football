"""Actual saved weights and public historical data; contract fixtures are labelled."""
import unittest,json,hashlib,math,csv
from pathlib import Path
from universal_model import national,center
from universal_model_v2 import predict_universal,coherent_grid,MODEL_ID
ROOT=Path(__file__).parents[1]
class GeneralModel(unittest.TestCase):
    def value(self,competition='uefa.nations',neutral=False):
        return dict(mode='LOCAL_RESEARCH',fixtureId='CONTRACT_TEST_NOT_A_LIVE_MATCH',cutoffAt='2026-10-03T00:00:00Z',odds=['2.5','3.3','2.8'],comparisonFeatures=dict(competition=competition,home='France',away='Italy',goalStats=None),researchFeatures=dict(neutralSite=neutral,observedAt=1790899200000,homeRecent=[],awayRecent=[]))
    def predict(self,value):return predict_universal(dict(modelId=MODEL_ID),value)
    def test_actual_weights_match_pin_and_sources(self):
        a=national();pin=json.loads((ROOT/'packages/domain/national-model-pin.json').read_text(encoding='utf8'))
        self.assertEqual(len(a['teams']),270)
        self.assertEqual(hashlib.sha256((ROOT/'model-runner/assets/national-v1.json').read_bytes()).hexdigest(),pin['artifactSha256'])
        for source in pin['sources']:
            file=ROOT/'.models-local/universal'/source['url'].rsplit('/',1)[1]
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),source['sha256'])
    def test_actual_saved_model_works_outside_five_leagues(self):
        for competition in ['uefa.nations','fifa.worldq.afc','concacaf.nations.league','fifa.friendly']:
            o=self.predict(self.value(competition));self.assertEqual(o['state'],'DONE');self.assertEqual(o['basis'],'NATIONAL_OPPONENT_ADJUSTED_POISSON')
            self.assertAlmostEqual(sum(o['central']),1,places=12)
    def test_all_markets_share_same_frozen_distribution(self):
        o=self.predict(self.value())
        for p,q in zip(o['central'],center(o['grid'])):self.assertAlmostEqual(p,q,places=12)
        self.assertAlmostEqual(sum(map(sum,o['grid'])),1,places=12)
        self.assertEqual(len(o['grid']),21)
    def test_no_mens_weights_for_womens_or_youth_teams(self):
        for competition in ['fifa.friendly.w','fifa.world.u20','uefa.under21']:
            o=self.predict(self.value(competition));self.assertIsNone(o['grid']);self.assertNotEqual(o['basis'],'NATIONAL_OPPONENT_ADJUSTED_POISSON')
    def test_missing_neutral_venue_is_not_filled_as_home(self):
        o=self.predict(self.value(neutral=None));self.assertEqual(o['state'],'BLOCKED');self.assertIsNone(o['central']);self.assertIsNone(o['grid'])
        h=self.predict(self.value());n=self.predict(self.value(neutral=True));self.assertNotEqual(h['central'],n['central'])
    def test_no_future_source_or_result_can_enter_model(self):
        v=self.value();v['cutoffAt']='2026-09-01T00:00:00Z'
        with self.assertRaisesRegex(ValueError,'FEATURE_LATE'):self.predict(v)
        v=self.value();v['researchFeatures']['homeRecent']=[dict(at='2026-10-04T00:00:00Z',gf=1,ga=0)]
        with self.assertRaisesRegex(ValueError,'FEATURE_LATE'):self.predict(v)
    def test_heldout_metrics_recomputed_from_real_source(self):
        a=national()
        with (ROOT/'.models-local/universal/results.csv').open(encoding='utf8') as source: rows=list(csv.DictReader(source))
        with (ROOT/'.models-local/universal/shootouts.csv').open(encoding='utf8') as source: excluded={(r['date'],r['home_team'],r['away_team']) for r in csv.DictReader(source)}
        ll=bs=0;n=0;dates=[]
        for r in rows:
            if not ('2025-01-01'<=r['date']<'2026-10-01' and r['tournament']=='Friendly' and r['home_score'].isdigit() and r['away_score'].isdigit()):continue
            if (r['date'],r['home_team'],r['away_team']) in excluded:continue
            h=a['teams'].get(r['home_team']);away=a['teams'].get(r['away_team'])
            if not h or not away:continue
            lh=min(4,max(.25,math.exp(a['intercept']+a['homeAdvantage']*(r['neutral']=='FALSE')+h['attack']-away['defense'])))
            la=min(4,max(.25,math.exp(a['intercept']+away['attack']-h['defense'])))
            pmf=lambda l:[math.exp(-l)*l**k/math.factorial(k) for k in range(21)]
            g=[[(x*y)**(1/a['temperature']) for y in pmf(la)] for x in pmf(lh)];total=sum(map(sum,g));g=[[p/total for p in row] for row in g]
            p=center(g);result=0 if int(r['home_score'])>int(r['away_score']) else 1 if int(r['home_score'])==int(r['away_score']) else 2
            ll-=math.log(p[result]);bs+=sum((v-int(i==result))**2 for i,v in enumerate(p));n+=1;dates.append(r['date'])
        metrics=a['validation']['holdout'];self.assertEqual(n,427);self.assertEqual(n,metrics['N']);self.assertAlmostEqual(ll/n,metrics['LogLoss'],places=12);self.assertAlmostEqual(bs/n,metrics['Brier'],places=12)
        self.assertEqual(max(dates),metrics['throughDate']);self.assertIsNone(metrics['ROI'])
if __name__=='__main__':unittest.main()
