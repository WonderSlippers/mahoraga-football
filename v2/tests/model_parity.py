"""Compare real archived inputs with reviewed original functions, without training.

Historical files have no verified original capture timestamps: timing guard cases
are explicitly synthetic and are reported separately from numerical parity rows.
"""
import copy
import importlib.util
import json
import platform
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'model-runner'))
from research_adapters import v6, v7, validate_context, digest, canonical, load_artifact, LEAGUES
ASSETS = ROOT / '.models-local/research'
PINS = json.loads((ROOT / 'model-runner/research-assets.json').read_text())
EVIDENCE = dict(startedAt=datetime.now(timezone.utc).isoformat(), python=platform.python_version(),
                adapterHash=digest((ROOT/'model-runner/research_adapters.py').read_bytes()),
                runtimeLockHash=digest((ROOT/'model-runner/requirements-research.txt').read_bytes()),
                mode='HISTORICAL_REPLAY', counts={}, maxErrors={}, exclusions={}, sourceHashes=PINS,
                limitations=['No original quote capture times; not prospective validation',
                             'Archived feature parity does not validate raw-history live feature construction',
                             'No model promotion, no profitability validation'])

def checked(relative):
    path = ASSETS / relative
    if digest(path.read_bytes()) != PINS[relative]:
        raise ValueError('REFERENCE_HASH_MISMATCH:' + relative)
    return path

def reference(name, relative):
    spec = importlib.util.spec_from_file_location(name, checked(relative))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Parity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r6 = reference('reference_v6', 'mahoraga_v6_league_policies/code/paper_inference.py')
        cls.r7 = reference('reference_v7', 'mahoraga_v7_lab/code/model.py')
        cls.m6 = {lg: json.loads(checked(f'mahoraga_v6_league_policies/models/HONEST_CANDIDATE_2025_{lg}.json').read_text()) for lg in LEAGUES}
        cls.m7 = json.loads(checked('mahoraga_v7_lab/models/return_partial_2026.json').read_text())
        cls.d6 = pd.read_csv(checked('mahoraga_v6_league_policies/inputs/extended_2026_features.csv'))
        cls.d7 = pd.read_csv(checked('mahoraga_v7_lab/inputs/features.csv'))

    def test_v6_250_archived_rows(self):
        maximum = 0.
        ids = []
        actions = {}
        for league, model in self.m6.items():
            pool = self.d6[self.d6.competition.eq(league) & self.d6.season.ge(2025)].dropna(subset=model['features'] + ['oh', 'od', 'oa'])
            # Fixed source order, spread across the available period, never choose by return.
            selected = pool.iloc[np.linspace(0, len(pool)-1, 50, dtype=int)]
            self.assertEqual(len(selected), 50)
            for _, row in selected.iterrows():
                data = row.to_dict(); data['odds'] = [row.oh, row.od, row.oa]
                original = self.r6.predict(model, data)
                actual = v6(model, data)
                self.assertIsNone(actual['central'])
                self.assertEqual(actual['action'], 'NO_ACTION' if original['action'] == 'SKIP' else original['action'])
                if original['estimated_stress_ev'] is None:
                    self.assertIsNone(actual['estimatedEV'])
                else:
                    error = abs(original['estimated_stress_ev'] - actual['estimatedEV'])
                    maximum = max(maximum, error); self.assertLessEqual(error, 1e-8)
                self.assertEqual(canonical(actual), canonical(v6(model, data)))
                ids.append(row.fixture_id)
                actions[actual['action']] = actions.get(actual['action'], 0) + 1
        EVIDENCE['counts']['V6ArchivedRows'] = len(ids)
        EVIDENCE['V6Actions'] = actions
        EVIDENCE['V6SampleManifestHash'] = digest(canonical(ids).encode())
        EVIDENCE['maxErrors']['V6SelectedStressEV'] = maximum

    def test_v7_all_eligible_2026_archived_rows(self):
        selected = []
        for lg in LEAGUES:
            pool = self.d7[self.d7.competition.eq(lg) & self.d7.season.eq(2026) & self.d7.common_eligible.eq(True)]
            self.assertGreater(len(pool), 0)
            selected.append(pool)
        frame = pd.concat(selected)
        self.assertGreaterEqual(len(frame), 100)
        expected = self.r7.raw_predict(self.m7, frame)
        blended = self.r7.predict(self.m7, frame)
        sides = self.r7.pick(expected, frame[['oh', 'od', 'oa']].to_numpy(float))
        maximum = 0.
        for i, (_, row) in enumerate(frame.iterrows()):
            data = row.to_dict(); data['odds'] = [row.oh, row.od, row.oa]
            actual = v7(self.m7, data, row.competition)
            error = float(np.max(np.abs(expected[i] - actual['central'])))
            maximum = max(maximum, error); self.assertLessEqual(error, 1e-8)
            self.assertEqual(actual['action'], ['HOME', 'DRAW', 'AWAY'][sides[i]] if sides[i] >= 0 else 'NO_ACTION')
            if sides[i] >= 0:
                self.assertAlmostEqual(actual['estimatedEV'], expected[i, sides[i]] * data['odds'][sides[i]] - 1, places=8)
            self.assertAlmostEqual(sum(actual['central']), 1., places=12)
            self.assertEqual(canonical(actual), canonical(v7(self.m7, data, row.competition)))
            altered = dict(data, outcome=999, hg_result=100, ag_result=100)
            self.assertEqual(actual, v7(self.m7, altered, row.competition))
        self.assertGreater(float(np.max(np.abs(expected - blended))), 1e-4)
        EVIDENCE['counts']['V7ArchivedRows'] = len(frame)
        EVIDENCE['V7SampleManifestHash'] = digest(canonical(frame.fixture_id.tolist()).encode())
        EVIDENCE['maxErrors']['V7CentralProbability'] = maximum
        EVIDENCE['rawVsBlendedMaximumDifference'] = float(np.max(np.abs(expected - blended)))

    def test_float32_boundaries(self):
        count = 0
        for lg, model in self.m6.items():
            row = self.d6[self.d6.competition.eq(lg)].dropna(subset=model['features']).iloc[-1].to_dict()
            row['odds'] = [2., 2., 2.]
            def walk(node):
                nonlocal count
                if 'feature' not in node: return
                for value in [float(np.nextafter(np.float32(node['threshold']), np.float32(-np.inf))), float(np.float32(node['threshold'])), float(np.nextafter(np.float32(node['threshold']), np.float32(np.inf)))]:
                    candidate = dict(row); candidate[node['feature']] = value
                    # q sum validity is part of the original contract; keep altered q coherent.
                    if node['feature'].startswith('q_'):
                        others = [f'q_{s}' for s in ['home','draw','away'] if f'q_{s}' != node['feature']]
                        total = sum(candidate[k] for k in others)
                        for key in others: candidate[key] *= (1-value)/total
                    # Isolate this actual trained subtree so the boundary is always reached.
                    subtree = dict(model, tree=node)
                    expected = self.r6.predict(subtree, candidate)
                    actual = v6(subtree, candidate)
                    self.assertEqual(actual['action'], 'NO_ACTION' if expected['action'] == 'SKIP' else expected['action'])
                    self.assertEqual(actual['estimatedEV'], expected['estimated_stress_ev'])
                    self.assertEqual(actual['path'][0]['left'], bool(np.float32(value) <= node['threshold']))
                    count += 1
                walk(node['le']); walk(node['gt'])
            walk(model['tree'])
        EVIDENCE['counts']['SyntheticFloat32BoundaryCases'] = count

    def test_missing_and_fixed_variants(self):
        row = self.d7[self.d7.common_eligible.eq(True)].iloc[-1].to_dict()
        row['odds'] = [row[k] for k in ['oh','od','oa']]
        for value in [None, '', float('nan'), float('inf'), True]:
            with self.assertRaises(ValueError): v7(self.m7, dict(row, z_diff_xgf5=value), row['competition'])
        with self.assertRaises(ValueError): v7(self.m7, row, 'women.eng.1')
        changed = copy.deepcopy(self.m7); changed['scaler']['names'].reverse()
        with self.assertRaises(ValueError): v7(changed, row, row['competition'])
        changed = copy.deepcopy(self.m7); changed['config']['partial'] = False
        with self.assertRaises(ValueError): v7(changed, row, row['competition'])

    def test_synthetic_context_guards_not_historical_time_validation(self):
        context = dict(mode='HISTORICAL_REPLAY', market='1x2_90min', competition='eng.1', source='SYNTHETIC_GUARD_TEST',
                       decision_at='2030-01-10T11:00:00Z', quote_captured_at='2030-01-10T10:59:00Z',
                       kickoff_at='2030-01-10T12:00:00Z', feature_last_date='2030-01-06')
        validate_context(self.m7, context)
        invalid = [dict(mode='LOCAL_RESEARCH'), dict(use_unblended=False), dict(market='ah'), dict(source='UNKNOWN'),
                   dict(feature_last_date='2030-01-08'), dict(quote_captured_at='2030-01-10T10:49:00Z'),
                   dict(decision_at='2026-05-24T11:00:00Z'), dict(kickoff_at='2030-01-10T11:00:00Z')]
        for change in invalid:
            with self.assertRaises(ValueError): validate_context(self.m7, context | change)
        with self.assertRaises(ValueError): validate_context(dict(self.m7, status='RETROSPECTIVE_FIT_NOT_VALIDATED'), context)
        EVIDENCE['counts']['SyntheticContextGuardCases'] = len(invalid) + 1

    def test_asset_tampering_and_hash(self):
        relative = 'mahoraga_v7_lab/models/return_partial_2026.json'
        self.assertEqual(load_artifact(checked(relative), PINS[relative]), self.m7)
        with self.assertRaises(ValueError): load_artifact(checked(relative), '0'*64)

if __name__ == '__main__':
    output = ROOT / '.runtime-v2/model-parity'
    output.mkdir(parents=True, exist_ok=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Parity))
    EVIDENCE.update(finishedAt=datetime.now(timezone.utc).isoformat(), tests=result.testsRun,
                    failures=len(result.failures), errors=len(result.errors), skipped=len(result.skipped),
                    exitCode=0 if result.wasSuccessful() else 1)
    (output / 'report.json').write_text(json.dumps(EVIDENCE, indent=2), encoding='utf-8')
    sys.exit(EVIDENCE['exitCode'])
