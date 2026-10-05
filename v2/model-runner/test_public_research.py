import unittest
from runner import predict, recent_form
import hashlib,json

class ResearchInferenceTest(unittest.TestCase):
 def value(self):
  games=[dict(id=str(i),at=f'2026-09-{20+i:02}T12:00:00Z',gf=1,ga=1,opponent='Known',competition='Friendly') for i in range(5)]
  return dict(mode='LOCAL_RESEARCH',fixtureId='1',revisionId='r',observedAt='2026-10-01T04:00:00Z',ingestedAt='2026-10-01T04:00:00Z',cutoffAt='2026-10-01T04:00:00Z',kickoffAt='2026-10-01T14:00:00Z',odds=['2.5','3.2','2.8'],missingMask=['PUBLIC_REFERENCE_NOT_EXECUTABLE'],researchFeatures=dict(homeRecent=games,awayRecent=games,neutralSite=True,sourceSnapshotId='raw',observedAt=1790827200000))
 def test_market_research_is_real_market_probability_not_demo(self):
  value=self.value();raw=json.dumps(value,sort_keys=True,separators=(',',':'));p=predict(dict(canonical=raw,bundleHash=hashlib.sha256(raw.encode()).hexdigest(),modelId='MARKET_PROPORTIONAL_V1'));self.assertAlmostEqual(sum(p),1);self.assertAlmostEqual(p[0],(1/2.5)/(1/2.5+1/3.2+1/2.8));self.assertTrue(all(a*float(b)<1 for a,b in zip(p,value['odds'])))
 def test_fixed_recent_form_blend_is_symmetric_and_reproducible(self):
  v=self.value();v['odds']=['3','3','3'];p=recent_form(v);self.assertAlmostEqual(sum(p),1,places=10);self.assertAlmostEqual(p[0],p[2],places=10);self.assertEqual(p,recent_form(v));self.assertGreater(p[0],.8/3)
 def test_late_stale_missing_and_duplicate_histories_refused(self):
  for alter in ['late','stale','short','duplicate']:
   v=self.value();games=v['researchFeatures']['homeRecent'];
   if alter=='late':games[0]['at']='2026-10-01T05:00:00Z'
   if alter=='stale':
    for g in games:g['at']='2025-01-01T12:00:00Z'
   if alter=='short':v['researchFeatures']['homeRecent']=games[:2]
   if alter=='duplicate':games[0]['id']=games[1]['id']
   with self.assertRaises(ValueError):recent_form(v)
 def test_unknown_neutral_site_is_not_filled_as_false(self):
  v=self.value();v['researchFeatures']['neutralSite']=None
  with self.assertRaises(ValueError):recent_form(v)
 def test_research_cannot_use_demo_fixed_central(self):
  v=self.value();raw=json.dumps(v);job=dict(canonical=raw,bundleHash=hashlib.sha256(raw.encode()).hexdigest(),modelId='DEMO_FIXED_CENTRAL_V1')
  with self.assertRaises(ValueError):predict(job)
if __name__=='__main__':unittest.main()
