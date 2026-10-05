export const SEPTEMBER_ID = "LEGACY_20260920_FULL_RULES_V1";
export const V6_ID = "V6_C388_FROZEN_20261001";
export const VERSIONS = [
  {
    id: "GENERAL",
    label: "通用 · 2.0",
    modelId: "GENERAL_FOOTBALL_ADAPTIVE_RESEARCH_V1",
    status: "RUNNING",
    description: "同一比分分布驱动胜平负、亚洲盘和大小球",
  },
  {
    id: "SEPTEMBER20",
    label: "9月20日 · 原版规则",
    modelId: SEPTEMBER_ID,
    status: "RUNNING",
    description: "保留旧版选单、串关、保底和动态PP扣减；精确历史运行身份未证实",
  },
  {
    id: "V6",
    label: "V6 · 配置388",
    modelId: V6_ID,
    status: "RUNNING",
    description: "原生胜平负压力策略；仅五大联赛，未归一化压力概率",
  },
] as const;
export function selectedVersion(params: URLSearchParams) {
  const id = params.get("version") || "GENERAL";
  const value = VERSIONS.find((v) => v.id === id);
  if (!value) throw Error("INVALID_MODEL_VERSION");
  return value;
}
export function versionPolicy(id: string, version: string) {
  return version === "GENERAL"
    ? id.startsWith("general")
    : version === "SEPTEMBER20"
      ? id.startsWith("september20:")
      : id === "v6-native";
}
