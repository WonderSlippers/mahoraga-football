import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "./input.schema.json";
const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
export type FrozenInput = {
  mode: string;
  fixtureId: string;
  revisionId: string;
  observedAt: string;
  ingestedAt: string;
  cutoffAt: string;
  kickoffAt: string;
  odds: string[];
  missingMask: string[];
  generalCalibration?: {
    protocol: string;
    revision: number;
    modelTrust: number;
    temperature: number;
    effectiveAt: number;
  };
  researchFeatures?: {
    homeRecent: {
      id: string;
      at: string;
      gf: number;
      ga: number;
      opponent: string;
      competition: string;
    }[];
    awayRecent: {
      id: string;
      at: string;
      gf: number;
      ga: number;
      opponent: string;
      competition: string;
    }[];
    neutralSite: boolean | null;
    sourceSnapshotId: string;
    observedAt: number;
  };
};
export function input(value: unknown): FrozenInput {
  if (!validate(value)) throw new Error("FEATURE_SCHEMA_MISMATCH");
  const v = value as FrozenInput;
  if (v.odds.some((o) => !Number.isFinite(Number(o)) || Number(o) <= 1))
    throw new Error("ODDS_INVALID");
  if (
    Date.parse(v.observedAt) > Date.parse(v.cutoffAt) ||
    Date.parse(v.ingestedAt) > Date.parse(v.cutoffAt) ||
    Date.parse(v.cutoffAt) >= Date.parse(v.kickoffAt)
  )
    throw new Error("FEATURE_LATE");
  if (
    v.researchFeatures &&
    (v.researchFeatures.observedAt > Date.parse(v.cutoffAt) ||
      [...v.researchFeatures.homeRecent, ...v.researchFeatures.awayRecent].some(
        (g) => Date.parse(g.at) >= Date.parse(v.cutoffAt),
      ))
  )
    throw Error("FEATURE_LATE");
  if (
    v.generalCalibration &&
    v.generalCalibration.effectiveAt > Date.parse(v.cutoffAt)
  )
    throw Error("FEATURE_LATE");
  return v;
}
export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("NUMBER_INVALID");
    return JSON.stringify(v);
  }
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object")
    return (
      "{" +
      Object.keys(v!)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((v as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  throw new Error("VALUE_INVALID");
}
export async function sha(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function central(p: unknown): number[] {
  if (
    !Array.isArray(p) ||
    p.length !== 3 ||
    p.some(
      (x) => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1,
    ) ||
    Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-8
  )
    throw new Error("MODEL_OUTPUT_INVALID");
  return p;
}
export function exactFields(v: Record<string, unknown>, keys: string[]) {
  if (
    !v ||
    Array.isArray(v) ||
    typeof v !== "object" ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw new Error("INVALID_FIELDS");
}
