"""Real frozen model/feature parity and adversarial input tests; not live return validation."""
import unittest,json,math,copy
from pathlib import Path
import pandas as pd
from comparison_models import assets,v6_shadow,legacy,V6_ID,LEGACY_ID,ROOT
from prepare_comparison_features import build_feature,identity
from research_adapters import v6

class Features(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=pd.read_csv(ROOT/'.models-local/research/mahoraga_v7_lab/inputs/raw.csv',low_memory=False)
        cls.raw.date=pd.to_datetime(cls.raw.date)
        cls.golden=pd.read_csv(ROOT/'.models-local/research/mahoraga_v7_lab/inputs/features.csv',low_memory=False)
    def test_five_league_lagged_feature_golden_parity(self):
        maximum=0;rows=0;values=0
        for league in ['eng.1','ger.1','ita.1','esp.1','fra.1']:
            for _,r in self.golden[(self.golden.competition==league)&(self.golden.season==2026)].tail(2).iterrows():
                target=dict(fixtureId=str(r.fixture_id),competition=league,home=r.home,away=r.away,kickoffAt=pd.Timestamp(r.date).timestamp()*1000)
                out=build_feature(target,self.raw,r.date)
                model=json.loads((ROOT/f'.models-local/frozen/20261001-r1/mahoraga_v6_league_policies/models/HONEST_CANDIDATE_2025_{league}.json').read_text(encoding='utf8'))
                for key in model['features']:
                    if key.startswith('q_') or key=='overround':continue
                    error=abs(out['features'][key]-float(r[key]));maximum=max(maximum,error);values+=1
                    self.assertLess(error,1e-8,(league,r.fixture_id,key,out['features'][key],r[key]))
                self.assertLess(pd.Timestamp(out['historyLastDate']),pd.Timestamp(r.date)-pd.Timedelta(days=2));rows+=1
        report=ROOT/'.runtime-v2/parallel-models/feature-parity.json';report.parent.mkdir(parents=True,exist_ok=True)
        report.write_text(json.dumps(dict(rows=rows,featureValues=values,maxError=maximum,scope='ARCHIVED_REAL_FEATURE_PARITY_NOT_PROSPECTIVE_VALIDATION'),indent=2),encoding='utf8')
    def test_current_results_cannot_enter_same_day_features(self):
        r=self.golden[(self.golden.competition=='eng.1')&(self.golden.season==2026)].iloc[-1]
        target=dict(fixtureId='test',competition=r.competition,home=r.home,away=r.away,kickoffAt=pd.Timestamp(r.date).timestamp()*1000)
        before=build_feature(target,self.raw,r.date)
        poisoned=self.raw.copy();mask=poisoned.date>=pd.Timestamp(r.date)-pd.Timedelta(days=2);poisoned.loc[mask,['hg_result','ag_result','xg_home','xg_away']]=99
        self.assertEqual(before,build_feature(target,poisoned,r.date))
    def test_missing_xg_uses_documented_prior_and_preserves_count(self):
        r=self.golden[(self.golden.competition=='eng.1')&(self.golden.season==2026)].iloc[-1]
        raw=self.raw.copy();raw[['xg_home','xg_away']]=float('nan')
        out=build_feature(dict(fixtureId='test',competition=r.competition,home=r.home,away=r.away,kickoffAt=pd.Timestamp(r.date).timestamp()*1000),raw,r.date)
        self.assertEqual(out['features']['z_h_xgf_n15'],0);self.assertTrue(out['completeness']['fixedPriorsUsed'])
    def test_unknown_team_is_blocked_not_fuzzy_matched(self):
        with self.assertRaisesRegex(ValueError,'TEAM_MAPPING_REQUIRED'):
            build_feature(dict(fixtureId='test',competition='eng.1',home='Made Up Arsenal',away='Everton',kickoffAt=pd.Timestamp('2026-10-02').timestamp()*1000),self.raw,'2026-10-01')
    def test_provider_names_map_exactly_to_historical_teams(self):
        pairs=[('Tottenham Hotspur','Tottenham','eng.1'),('AS Monaco','Monaco','fra.1'),('Alav\u00e9s','Alaves','esp.1'),('Celta Vigo','Celta','esp.1'),('Stade Rennais','Rennes','fra.1'),('AJ Auxerre','Auxerre','fra.1'),('Deportivo','La Coruna','esp.1'),('M\u00e1laga','Malaga','esp.1'),('SV Elversberg','Elversberg','ger.1')]
        for provider,historical,league in pairs:
            d=self.raw[self.raw.competition==league]
            self.assertEqual(identity(provider,set(d.home)|set(d.away)),historical)

class FixedMethods(unittest.TestCase):
    def setUp(self):
        assets();self.v=dict(fixtureId='TEST_ONLY',mode='LOCAL_RESEARCH',cutoffAt='2026-10-01T10:00:00Z',observedAt='2026-10-01T10:00:00Z',kickoffAt='2026-10-01T16:00:00Z',odds=['2','3.2','4'],comparisonFeatures=dict(competition='fifa.friendly',home='Maldives',away='Lebanon',goalStats=None,featureRow=None,featureSources=[],featureHash=None,offers=[dict(market='1X2',selection=s,lineQ=None,odds=o) for s,o in zip(['HOME','DRAW','AWAY'],['2','3.2','4'])]))
    def test_legacy_original_fixed_defaults_numerical_oracle(self):
        # Independently calculate the exact original default market+form recipe.
        self.v['researchFeatures']=dict(homeRecent=[dict(gf=2,ga=0,at='2026-09-20T00:00:00Z')],awayRecent=[dict(gf=0,ga=2,at='2026-09-20T00:00:00Z')])
        out=legacy(self.v);q=[1/float(o) for o in self.v['odds']];q=[x/sum(q) for x in q];raw=[q[0]+.075,q[1],max(.025,q[2]-.075)];p=[x/sum(raw) for x in raw]
        self.assertEqual(out['state'],'DONE')
        for a,b in zip(out['central'],p):self.assertAlmostEqual(a,b,places=14)
        self.assertAlmostEqual(out['actions'][0]['probability'],p[0]-.44*.055,places=14)
        self.assertEqual(out['modelWeight'],.5)
    def test_original_time_window_preserved(self):
        self.v['kickoffAt']='2026-10-03T16:00:00Z';self.assertEqual(legacy(self.v)['state'],'BLOCKED')
    def test_original_v2_goal_formula_and_total_market_are_preserved(self):
        self.v['comparisonFeatures']['goalStats']=dict(home={'games':5,'for':6,'against':6},away={'games':5,'for':6,'against':6},homePrev={'games':38,'for':45.6,'against':45.6},awayPrev={'games':38,'for':45.6,'against':45.6},mean=1.2,meanPrev=1.2,season=2026,observedAt=1790848800000,sourceRefs=[{'observedAt':1790848800000}])
        self.v['comparisonFeatures']['offers']+=[dict(market='TOTAL_GOALS',selection='OVER',lineQ=10,odds='2.2'),dict(market='TOTAL_GOALS',selection='UNDER',lineQ=10,odds='1.9')]
        out=legacy(self.v);g=out['goalModel'];self.assertAlmostEqual(g['expectedHome'],1.2*1.15**2,places=14);self.assertAlmostEqual(g['expectedAway'],1.2*.85**2,places=14)
        self.assertEqual(g['modelVersion'],'poisson-standings-v2');self.assertEqual(g['uncertaintyMargin'],.08)
        for a in out['actions']:self.assertAlmostEqual(a['probability']*float(a['odds'])-1,a['estimatedEV'],places=14)
    def test_v6_scope_and_missing_inputs_explicit(self):
        self.assertEqual(v6_shadow(self.v)['reason'],'UNSUPPORTED_COMPETITION')
        self.v['comparisonFeatures']['competition']='eng.1';self.assertEqual(v6_shadow(self.v)['reason'],'LIVE_RAW_FEATURE_SNAPSHOT_PENDING')
    def test_future_form_rejected(self):
        self.v['researchFeatures']=dict(homeRecent=[dict(gf=5,ga=0,at='2026-10-01T16:00:00Z')])
        with self.assertRaisesRegex(ValueError,'FEATURE_LATE'):legacy(self.v)
if __name__=='__main__':unittest.main()
