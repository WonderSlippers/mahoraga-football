import frozen from "../../model-runner/comparison-assets-r1.json";
import codePins from "../../model-runner/comparison-code-pins.json";
export const COMPARISON_METHODS = [
  {
    id: "V6_C388_FROZEN_20261001",
    label: "V6 · 配置388 · 固定研究",
    outputKind: "SELECTION_STRESS_ONLY",
    artifactHashes: [
      "fe20f46d6d784e2f1cdd7b225ec985bef4212d6f060bed3e22b734af159ef476",
      "01c9e7e42df89dea4c6f2d4afa89527192f42bb39ade0e1d96f549e0f2ae9dc2",
      "cf8fb69e5a4acd968f6affa16a5b3e938c93ea18f2f486fa978b168494e58764",
      "63668f4c299d4c4b56f6806d469341d77486bd998cc57fcd649b10520147afdb",
      "c1bbae1546b6d4316ef6e2b97e1b73f0d45a367e802d0d3f90d72c2385f01942",
    ],
    scope: "FIVE_LEAGUES_SHADOW_ONLY",
    frozenSourceHashes: frozen.assets,
    frozenLocalHashes: codePins,
    config: {
      depth: 4,
      min_leaf: 120,
      regularization: 5,
      min_calibration: 40,
      z_stress: 0.5,
      lo: 1.8,
      hi: 2.5,
      threshold: 0.02,
    },
    trainCutoffAt: "2025-05-26T00:00:00Z",
    validation: "POSTHOC_CONFIG_FROZEN_FORWARD_RESEARCH",
  },
  {
    id: "LEGACY_20260920_FROZEN_V2",
    label: "9月20日旧版 · V2固定研究",
    outputKind: "CENTRAL_AND_CONSERVATIVE_ACTIONS",
    artifactHashes: [
      "d968249005634f18ebd71a831a3ca34263e347ed4efa9bc956159bccf23f1044",
    ],
    scope: "LEGACY_BROAD_AND_BEST_MARKET_REFERENCE",
    frozenSourceHashes: frozen.assets,
    frozenLocalHashes: codePins,
    config: {
      goalWeight: 0.5,
      evolutionMarginShift: 0,
      rho: -0.08,
      sourceCommit: "40ae6816dfbcbdfd89eac1a05eefae98ecd0db9b",
    },
    trainCutoffAt: null,
    validation: "PREBATCH_SOURCE_DEFAULTS_NOT_EXACT_DIRTY_RUNTIME",
  },
] as const;
export const FROZEN_V7 = {
  id: "V7_RETURN_PARTIAL_QUOTE_WEIGHTED_FIXED",
  label: "V7 · 固定报价融合 · 已封存",
  artifactHash:
    "7746e847ec329635a1f16737e7d2394a2561d9220e047a8800c3cfae9c3b1775",
  status: "SAVED_NOT_AUTO_PROMOTED",
};
