import nationalPin from "./national-model-pin.json";
import codePins from "./universal-code-pins.json";
import v2CodePins from "./general-v2-code-pins.json";
import { GENERAL_ADAPTIVE_ID, ADAPTATION_RULES } from "./general-adaptation";
import adaptationCodePins from "./general-adaptation-code-pins.json";
export const UNIVERSAL_ID = GENERAL_ADAPTIVE_ID;
export const UNIVERSAL_MANIFEST = {
  id: UNIVERSAL_ID,
  label: "通用赛前研究",
  outputKind: "CENTRAL_AND_SCORE_DISTRIBUTION",
  researchOnly: true,
  automaticPromotion: false,
  status: "UNVALIDATED_FORWARD_RESEARCH",
  supportedCompetitions:
    "All configured competitions with exact team identity and sufficient inputs",
  supportedMarkets: ["1X2", "ASIAN_HANDICAP", "TOTAL_GOALS"],
  marketGoalWeight: 0.5,
  clubRecipe:
    "Legacy standings shrinkage / Dixon-Coles; league statistics required",
  nationalRecipe:
    "Opponent-adjusted ridge Poisson; men's senior national Friendly training; competitive transfer unvalidated",
  national: nationalPin,
  codePins: { ...codePins, ...v2CodePins },
  calibration: { ...ADAPTATION_RULES, codePins: adaptationCodePins },
  pricingVersion: "GENERAL_COHERENT_RETURN_V2",
  maximumEstimatedEV: 0.2,
  strictForwardEligible: false,
};
export const PAPER_STRATEGIES = [
  {
    id: "general-v2-all-singles",
    legacyId: "all-singles",
    label: "广覆盖单场对照",
    version: "GENERAL_BROAD_PAPER_V2",
    maximum: 100,
  },
  {
    id: "general-v2-value-singles",
    legacyId: "value-singles",
    label: "精选价值单场",
    version: "GENERAL_VALUE_PAPER_V2",
    maximum: 5,
  },
  {
    id: "general-v2-spread-singles",
    legacyId: "spread-singles",
    label: "让球价值单场",
    version: "GENERAL_ASIAN_PAPER_V2",
    maximum: 5,
  },
  {
    id: "general-v2-featured-picks",
    legacyId: "featured-picks",
    label: "最优玩法精选",
    version: "GENERAL_FEATURED_PAPER_V2",
    maximum: 10,
  },
  {
    id: "general-v2-forced-fun",
    legacyId: "forced-fun",
    label: "各玩法强制对照",
    version: "GENERAL_FORCED_PAPER_V2",
    maximum: 60,
  },
  {
    id: "general-v2-double",
    legacyId: "double",
    label: "双场分散组合",
    version: "GENERAL_DOUBLE_LEG_PAPER_V2",
    maximum: 5,
  },
] as const;
