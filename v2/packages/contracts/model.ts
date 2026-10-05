export function modelAsset(
  manifest: any,
  asset: { name: string; hash: string },
) {
  if (
    !asset.name.endsWith(".json") ||
    asset.name.includes("..") ||
    /[\\/:]/.test(asset.name)
  )
    throw Error("MODEL_PATH_REJECTED");
  if (
    !manifest.trainCutoffAt ||
    !Number.isFinite(Date.parse(manifest.trainCutoffAt))
  )
    throw Error("MODEL_TRAIN_TIME_MISSING");
  if (
    !/^[a-f0-9]{64}$/.test(manifest.artifactSha256) ||
    manifest.artifactSha256 !== asset.hash
  )
    throw Error("MODEL_HASH_MISMATCH");
  if (String(manifest.modelId).includes("RETROSPECTIVE"))
    throw Error("RESEARCH_FIT_FORBIDDEN");
  return {
    status: "BLOCKED",
    reason: "MODEL_PARITY_AND_FEATURE_INPUTS_NOT_VALIDATED",
  };
}
