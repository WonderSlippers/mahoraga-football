"""Actual pinned inference + calibration invariants, not profitability validation."""
import unittest,copy
import test_general
from general_adaptation import predict_universal,MODEL_ID,PROTOCOL
from universal_model import center

class Adaptation(unittest.TestCase):
    def value(self):
        v=test_general.GeneralModel().value()
        v['generalCalibration']=dict(protocol=PROTOCOL,revision=0,modelTrust=1,temperature=1,effectiveAt=0)
        return v
    def test_neutral_calibration_preserves_pinned_fixed_inference(self):
        v=self.value();fixed=test_general.GeneralModel().predict(v);o=predict_universal(dict(modelId=MODEL_ID),v)
        self.assertEqual(o['central'],fixed['central']);self.assertEqual(o['grid'],fixed['grid'])
        self.assertEqual(o['adaptation']['baseCentral'],fixed['central']);self.assertNotEqual(o['variant'],fixed['variant'])
    def test_adjusted_grid_remains_coherent_and_deterministic(self):
        v=self.value();v['generalCalibration'].update(revision=1,modelTrust=.95,temperature=1.05)
        first=predict_universal(dict(modelId=MODEL_ID),v);second=predict_universal(dict(modelId=MODEL_ID),copy.deepcopy(v))
        self.assertEqual(first,second)
        for p,q in zip(first['central'],center(first['grid'])):self.assertAlmostEqual(p,q,places=12)
        self.assertAlmostEqual(sum(map(sum,first['grid'])),1,places=12)
        self.assertAlmostEqual(first['goal']['expectedHome'],sum(i*p for i,row in enumerate(first['grid']) for p in row),places=12)
        self.assertNotEqual(first['central'],first['adaptation']['baseCentral'])
    def test_late_or_missing_parameter_snapshot_is_blocked(self):
        v=self.value();v['generalCalibration']['effectiveAt']=1791072000001
        with self.assertRaisesRegex(ValueError,'FEATURE_LATE'):predict_universal(dict(modelId=MODEL_ID),v)
        v=self.value();del v['generalCalibration']
        with self.assertRaisesRegex(ValueError,'SNAPSHOT_MISSING'):predict_universal(dict(modelId=MODEL_ID),v)
    def test_unknown_venue_remains_blocked_no_calibration_can_invent_data(self):
        v=self.value();v['researchFeatures']['neutralSite']=None
        o=predict_universal(dict(modelId=MODEL_ID),v);self.assertEqual(o['state'],'BLOCKED');self.assertIsNone(o['central']);self.assertIsNone(o['grid'])
if __name__=='__main__':unittest.main()
