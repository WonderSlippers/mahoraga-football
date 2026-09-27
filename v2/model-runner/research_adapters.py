"""Inference-only adapters. No training, network, database or mutable model selection.

Archived features remain HISTORICAL_REPLAY. A raw-history live builder is required
before these adapters may consume prospective jobs; archived rows are not that builder.
"""
from __future__ import annotations
import hashlib
import json
import math
from datetime import datetime, timedelta
from pathlib import Path
import numpy as np
from scipy.special import expit, logit, softmax

LEAGUES = ['eng.1', 'ger.1', 'ita.1', 'esp.1', 'fra.1']
SIDES = ['HOME', 'DRAW', 'AWAY']
BASE = ['market_home_logratio', 'market_away_logratio', 'market_favorite_strength',
        'opp_home_residual', 'opp_away_residual', 'old_home_residual', 'old_away_residual',
        'elo_diff', 'elo_slow', 'elo_momentum', 'gf5_diff', 'ga5_diff',
        'performance5_diff', 'performance10_diff', 'rest_diff', 'goals_level']
XG = ['xgf5_diff', 'xga5_diff', 'xgf15_diff', 'xga15_diff', 'sot5_diff', 'sota5_diff']
LOCAL = ['intercept', 'market_home_logratio', 'market_away_logratio',
         'opp_home_residual', 'opp_away_residual', 'elo_momentum', 'gf5_diff', 'ga5_diff', 'rest_diff']

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)

def number(row, key):
    value = row.get(key)
    if value is None or isinstance(value, bool) or value == '':
        raise ValueError('MISSING_FEATURE:' + key)
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('NONFINITE_FEATURE:' + key)
    return result

def odds3(row):
    odds = np.asarray(row['odds'], float)
    if odds.shape != (3,) or not np.isfinite(odds).all() or (odds <= 1).any():
        raise ValueError('INVALID_ODDS')
    return odds

def aware(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('TIMEZONE_REQUIRED')
    return dt

def validate_context(model, context):
    if context.get('market') != '1x2_90min':
        raise ValueError('UNSUPPORTED_MARKET')
    if context.get('competition') not in LEAGUES:
        raise ValueError('UNSUPPORTED_COMPETITION')
    if context.get('mode') != 'HISTORICAL_REPLAY':
        raise ValueError('LIVE_FEATURE_BUILDER_BLOCKED')
    if 'use_unblended' in context:
        raise ValueError('VARIANT_OVERRIDE_FORBIDDEN')
    if not context.get('source') or context['source'] in ['UNKNOWN', 'nan']:
        raise ValueError('SOURCE_REQUIRED')
    if model.get('status', '').startswith('RETROSPECTIVE'):
        raise ValueError('RETROSPECTIVE_FORBIDDEN')
    decision, quote, kickoff = [aware(context[k]) for k in ['decision_at', 'quote_captured_at', 'kickoff_at']]
    if not quote <= decision < kickoff or decision - quote > timedelta(minutes=10):
        raise ValueError('INVALID_QUOTE_TIME')
    if datetime.fromisoformat(context['feature_last_date']).date() >= decision.date() - timedelta(days=2):
        raise ValueError('HISTORY_EMBARGO')
    audit = model.get('training_audit', {})
    train = model.get('last_train_date', audit.get('last_discovery_date'))
    calibration = model.get('blend', {}).get('last_calibration_date', audit.get('last_calibration_date'))
    if not train or not calibration:
        raise ValueError('MODEL_CUTOFF_MISSING')
    if any(datetime.fromisoformat(d).date() >= decision.date() for d in [train, calibration]):
        raise ValueError('MODEL_TIME_LEAKAGE')
    if audit and audit['competition'] != context['competition']:
        raise ValueError('MODEL_COMPETITION_MISMATCH')

def v6(model, row):
    if model.get('status', '').startswith('RETROSPECTIVE'):
        raise ValueError('RETROSPECTIVE_FORBIDDEN')
    cfg = model['config']
    expected = dict(depth=4, min_leaf=120, regularization=5, min_calibration=40,
                    z_stress=.5, lo=1.8, hi=2.5, threshold=.02)
    if cfg != expected:
        raise ValueError('V6_CONFIG_388_REQUIRED')
    values = {f: number(row, f) for f in model['features']}
    odds = odds3(row)
    q = np.array([values[f'q_{s}'] for s in ['home', 'draw', 'away']])
    if (q <= 0).any() or not np.isclose(q.sum(), 1):
        raise ValueError('INVALID_MARKET_PROBABILITY')
    node = model['tree']
    path = []
    while 'feature' in node:
        left = bool(np.float32(values[node['feature']]) <= node['threshold'])
        path.append(dict(feature=node['feature'], threshold=node['threshold'], left=left))
        node = node['le'] if left else node['gt']
    stresses, evs = [None] * 3, [None] * 3
    for side in range(3):
        off = model['offsets'].get(f"{node['leaf']}:{side}")
        if off is not None and cfg['lo'] <= odds[side] <= cfg['hi']:
            delta, se, count = off
            if count < cfg['min_calibration']:
                raise ValueError('INVALID_CALIBRATION_SUPPORT')
            stresses[side] = float(expit(logit(np.clip(q[side], .005, .995)) + delta - cfg['z_stress'] * se))
            evs[side] = stresses[side] * float(odds[side]) - 1
    ranked = [v if v is not None else -math.inf for v in evs]
    side = int(np.argmax(ranked)) if max(ranked) >= cfg['threshold'] else -1
    return dict(variant='V6_C388_STRESS_REFERENCE', central=None,
                stressBySelection=dict(zip(SIDES, stresses)), evBySelection=dict(zip(SIDES, evs)),
                action=SIDES[side] if side >= 0 else 'NO_ACTION',
                estimatedEV=evs[side] if side >= 0 else None,
                outputKind='SELECTION_STRESS_ONLY', leaf=node['leaf'], path=path,
                reason='ELIGIBLE_RESEARCH_ONLY' if side >= 0 else 'NO_SUPPORTED_EDGE', researchOnly=True)

def v7_features(model, row, competition):
    if competition not in LEAGUES:
        raise ValueError('UNSUPPORTED_COMPETITION')
    if model['name'] != 'return_partial' or model['type'] != 'offset' or model['config'] != dict(partial=True, use_xg=True, base='proportional'):
        raise ValueError('V7_FIXED_VARIANT_REQUIRED')
    odds = odds3(row)
    q = (1 / odds) / (1 / odds).sum()
    def residual(a, b):
        p = np.clip([number(row, a), number(row, b), 1 - number(row, a) - number(row, b)], 1e-6, 1)
        p /= p.sum()
        return np.log(p[[0, 2]] / p[1]) - np.log(q[[0, 2]] / q[1])
    r1, r2 = residual('opp_ph', 'opp_pd'), residual('old_ph', 'old_pd')
    market_logits = np.log(q[[0, 2]] / q[1])
    diff = lambda a, b: number(row, a) - number(row, b)
    raw = np.array([*market_logits, q.max(), *r1, *r2, number(row, 'elo_diff'),
                    number(row, 'z_elo16'), number(row, 'z_elo_momentum'),
                    diff('home_gf_5', 'away_gf_5'), diff('home_ga_5', 'away_ga_5'),
                    diff('home_resid_5', 'away_resid_5'), diff('home_resid_10', 'away_resid_10'),
                    np.clip(diff('home_rest', 'away_rest'), -14, 14),
                    number(row, 'home_gf_5') + number(row, 'away_gf_5'),
                    *[number(row, f'z_diff_{f}') for f in ['xgf5', 'xga5', 'xgf15', 'xga15', 'sot5', 'sota5']]])
    if model['scaler']['names'] != BASE + XG:
        raise ValueError('FEATURE_ORDER_MISMATCH')
    mean, scale = np.asarray(model['scaler']['mean']), np.asarray(model['scaler']['scale'])
    if mean.shape != raw.shape or scale.shape != raw.shape or not np.isfinite(mean).all() or not np.isfinite(scale).all() or (scale <= 0).any():
        raise ValueError('INVALID_SCALER')
    base = np.r_[1., np.clip((raw - mean) / scale, -5, 5)]
    names = ['intercept'] + BASE + XG
    positions = [names.index(n) for n in LOCAL]
    matrix = np.r_[base, *[base[positions] * (competition == league) for league in LEAGUES]]
    expected_names = names + [f'{league}::{name}' for league in LEAGUES for name in LOCAL]
    if model['coefficient_names'] != expected_names:
        raise ValueError('COEFFICIENT_ORDER_MISMATCH')
    return matrix, q

def v7(model, row, competition):
    matrix, q = v7_features(model, row, competition)
    coefficients = np.asarray(model['coefficients'])
    if coefficients.shape != (len(matrix), 3) or not np.isfinite(coefficients).all():
        raise ValueError('INVALID_COEFFICIENTS')
    p = softmax(np.log(q) + matrix @ coefficients)
    odds = odds3(row)
    evs = p * odds - 1
    eligible = (odds >= 1.8) & (odds <= 2.5) & (evs >= .02)
    side = int(np.where(eligible, evs, -np.inf).argmax()) if eligible.any() else -1
    return dict(variant='V7_RETURN_PARTIAL_UNBLENDED', central=p.tolist(),
                action=SIDES[side] if side >= 0 else 'NO_ACTION',
                estimatedEV=float(evs[side]) if side >= 0 else None,
                outputKind='CENTRAL_1X2', probabilityMeaning='UNCALIBRATED_EXPLORATORY_CENTRAL',
                reason='ELIGIBLE_RESEARCH_ONLY' if side >= 0 else 'NO_ELIGIBLE_EDGE', researchOnly=True)

def load_artifact(path: Path, expected_hash: str):
    if path.suffix != '.json' or path.is_symlink():
        raise ValueError('UNSAFE_MODEL_ARTIFACT')
    data = path.read_bytes()
    if len(data) > 1024 * 1024 or digest(data) != expected_hash:
        raise ValueError('MODEL_HASH_MISMATCH')
    model = json.loads(data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('NONFINITE_MODEL')))
    if model.get('status', '').startswith('RETROSPECTIVE'):
        raise ValueError('RETROSPECTIVE_FORBIDDEN')
    return model

def infer(model, row, context, family):
    validate_context(model, context)
    if family == 'V6':
        return v6(model, row)
    if family == 'V7':
        return v7(model, row, context['competition'])
    raise ValueError('MODEL_NOT_WHITELISTED')
