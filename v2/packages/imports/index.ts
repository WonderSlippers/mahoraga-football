import { parse } from "csv-parse/browser/esm/sync";
import Decimal from "decimal.js";
import { canonical, sha } from "../contracts/index";
export type ImportFile = { name: string; content: string };
export type ArchiveRow = {
  businessKey: string;
  originalId: string | null;
  portfolio: string;
  kind: string;
  raw: string;
  contentHash: string;
  stakeAtoms: string | null;
  pnlAtoms: string | null;
  legCount: number | null;
  status: string | null;
  currency: string | null;
  warnings: string[];
  disposition: "ACCEPTED" | "QUARANTINE" | "DUPLICATE";
};
function amount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean" || !/^-?\d+(?:\.\d+)?$/.test(String(value)))
    throw Error("AMOUNT_UNPARSEABLE");
  const a = new Decimal(String(value)).times(1000000);
  if (!a.isInteger() || a.abs().gt("9007199254740991"))
    throw Error("AMOUNT_PRECISION_OR_RANGE");
  return a.toFixed(0);
}
function unbox(value: any): any {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.payload === "string") return JSON.parse(value.payload);
    if (value.data && typeof value.data === "object") return value.data;
  }
  return value;
}
function shardLab(rows: any[]) {
  const roots = rows.filter((x) => x.key === "simulation_lab_v2");
  if (roots.length !== 1) throw Error("IMPORT_SHARD_ROOT_INVALID");
  const root = unbox(roots[0]);
  if (
    root.format !== "simulation-lab-shards-v1" ||
    root.revision !== Number(roots[0].updated_at) ||
    root.meta?.updatedAt !== root.revision ||
    !Array.isArray(root.manifest)
  )
    throw Error("IMPORT_SHARD_REVISION");
  const shards = rows.filter(
    (x) => typeof x.key === "string" && x.key.startsWith("simulation_lab_v2:"),
  );
  const expected = new Set<string>();
  const portfolios: any[] = [];
  for (const item of root.manifest) {
    if (
      typeof item.id !== "string" ||
      !Number.isInteger(item.parts) ||
      item.parts < 1 ||
      item.parts > 1000
    )
      throw Error("IMPORT_SHARD_MANIFEST");
    const parts: string[] = [];
    for (let i = 0; i < item.parts; i++) {
      const key = `simulation_lab_v2:${item.id}:${i}`;
      if (expected.has(key)) throw Error("IMPORT_SHARD_DUPLICATE");
      expected.add(key);
      const found = shards.filter((s) => s.key === key);
      if (found.length !== 1) throw Error("IMPORT_SHARD_MISSING");
      const s = unbox(found[0]);
      if (
        Number(found[0].updated_at) !== root.revision ||
        s.revision !== root.revision ||
        s.portfolioId !== item.id ||
        s.index !== i ||
        typeof s.chunk !== "string"
      )
        throw Error("IMPORT_SHARD_REVISION");
      parts.push(s.chunk);
    }
    const portfolio = JSON.parse(parts.join(""));
    if (portfolio.id !== item.id || !Array.isArray(portfolio.tickets))
      throw Error("IMPORT_SHARD_PORTFOLIO");
    portfolios.push(portfolio);
  }
  if (shards.length !== expected.size) throw Error("IMPORT_SHARD_EXTRA");
  return { ...root.meta, portfolios };
}
export async function sourceManifest(files: ImportFile[]) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 30)
    throw Error("IMPORT_FILES_INVALID");
  const names = new Set<string>();
  let size = 0;
  const manifest = [];
  for (const file of files) {
    if (
      !file ||
      typeof file.name !== "string" ||
      !file.name ||
      file.name.length > 150 ||
      /[\\/\x00]/.test(file.name) ||
      typeof file.content !== "string" ||
      names.has(file.name)
    )
      throw Error("IMPORT_FILES_INVALID");
    names.add(file.name);
    const bytes = new TextEncoder().encode(file.content).length;
    size += bytes;
    if (size > 8 * 1024 * 1024) throw Error("PAYLOAD_LIMIT");
    manifest.push({ name: file.name, bytes, sha256: await sha(file.content) });
  }
  manifest.sort((a, b) => a.name.localeCompare(b.name));
  return {
    files: manifest,
    sourceHash: await sha(canonical(manifest)),
    bytes: size,
  };
}
export async function previewFiles(namespace: string, files: ImportFile[]) {
  if (!/^[\w-]{1,80}$/.test(namespace)) throw Error("IMPORT_NAMESPACE_INVALID");
  const manifest = await sourceManifest(files);
  const extracted: { value: any; portfolio: string; kind: string }[] = [];
  const warnings: string[] = [];
  const claims: any[] = [];
  const walk = (
    input: any,
    scope: string,
    kind = "TICKET",
    depth = 0,
  ): void => {
    if (depth > 6) throw Error("IMPORT_DEPTH_LIMIT");
    const v = unbox(input);
    if (Array.isArray(v)) {
      if (v.some((x) => x?.key === "simulation_lab_v2")) {
        walk(shardLab(v), "simulation_lab_v2", "TICKET", depth + 1);
        return;
      }
      for (const row of v) {
        if (
          row?.key === "simulation_lab_v1" ||
          row?.key === "sim_state" ||
          row?.key === "app_state"
        )
          walk(row, row.key, "TICKET", depth + 1);
        else if (row?.key)
          warnings.push(
            "UNSUPPORTED_STATE_KEY:" + String(row.key).slice(0, 80),
          );
        else extracted.push({ value: row, portfolio: scope, kind });
      }
      return;
    }
    if (!v || typeof v !== "object") throw Error("IMPORT_AMBIGUOUS");
    if (v.simulation_lab_v2) {
      const rows = Object.entries(v)
        .filter(([k]) => k.startsWith("simulation_lab_v2"))
        .map(([key, x]: any) => ({ key, ...x }));
      walk(shardLab(rows), "simulation_lab_v2", "TICKET", depth + 1);
      return;
    }
    if (v.simulation_lab_v1 || v.sim_state) {
      if (v.simulation_lab_v1)
        walk(v.simulation_lab_v1, "simulation_lab_v1", "TICKET", depth + 1);
      if (v.sim_state) walk(v.sim_state, "sim_state", "TICKET", depth + 1);
      return;
    }
    if (Array.isArray(v.portfolios)) {
      for (const portfolio of v.portfolios) {
        if (
          typeof portfolio.id !== "string" ||
          !Array.isArray(portfolio.tickets)
        )
          throw Error("IMPORT_PORTFOLIO_INVALID");
        claims.push({
          portfolio: portfolio.id,
          name: portfolio.name ?? null,
          legacyBalanceClaim: portfolio.balance ?? null,
          initialBalanceClaim: portfolio.initialBalance ?? null,
          currency: portfolio.currency ?? null,
        });
        for (const value of portfolio.tickets)
          extracted.push({ value, portfolio: portfolio.id, kind: "TICKET" });
      }
      return;
    }
    if (Array.isArray(v.records) || Array.isArray(v.tickets)) {
      claims.push({
        portfolio: scope,
        legacyBalanceClaim: v.balance ?? null,
        initialBalanceClaim: v.initialBalance ?? null,
        currency: v.currency ?? null,
      });
      for (const value of v.records || v.tickets)
        extracted.push({ value, portfolio: scope, kind: "TICKET" });
      return;
    }
    throw Error("IMPORT_AMBIGUOUS");
  };
  for (const file of files) {
    const text = file.content.replace(/^\uFEFF/, "").trim();
    const rowStart = extracted.length,
      claimStart = claims.length;
    let value: any;
    try {
      value =
        text.startsWith("{") || text.startsWith("[")
          ? JSON.parse(text)
          : parse(text, {
              columns: true,
              bom: true,
              skip_empty_lines: true,
              max_record_size: 131072,
              relax_column_count: false,
            });
      const kind = /model_forecast/i.test(file.name)
        ? "PREDICTION_ARCHIVE"
        : /market_quote|odds_snapshot/i.test(file.name)
          ? "QUOTE_ARCHIVE"
          : /market_result|model_outcome/i.test(file.name)
            ? "RESULT_ARCHIVE"
            : "TICKET";
      if (kind === "QUOTE_ARCHIVE" && Array.isArray(value)) {
        // Preserve potentially large quote archives exactly as chunked source files;
        // do not pretend old prices were captured prospectively by this installation.
        const fileHash = manifest.files.find(
          (f) => f.name === file.name,
        )!.sha256;
        extracted.push({
          portfolio: kind,
          kind,
          value: {
            id: fileHash,
            archiveRepresentation: "ORIGINAL_SOURCE_FILE",
            fileName: file.name,
            sourceRows: value.length,
            columns: value.length ? Object.keys(value[0]) : [],
            sourceSha256: fileHash,
            mode: "LEGACY_IMPORT",
            quoteObservedAt: null,
          },
        });
        claims.push({
          portfolio: kind,
          fileName: file.name,
          archivedSourceRows: value.length,
          sourceSha256: fileHash,
        });
      } else walk(value, kind === "TICKET" ? "legacy-default" : kind, kind);
    } catch (e) {
      extracted.splice(rowStart);
      claims.splice(claimStart);
      warnings.push(
        `${file.name}:${e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : "IMPORT_PARSE_FAILED"}`,
      );
    }
  }
  if (extracted.length > 10000) throw Error("IMPORT_ROW_LIMIT");
  const rows: ArchiveRow[] = [];
  const seen = new Map<string, string>();
  for (const { value, portfolio, kind } of extracted) {
    const raw = canonical(value),
      contentHash = await sha(raw),
      originalId =
        typeof value?.id === "string" || typeof value?.id === "number"
          ? String(value.id)
          : null;
    const businessKey = await sha(
      canonical([namespace, portfolio, kind, originalId || contentHash]),
    );
    const row: ArchiveRow = {
      businessKey,
      originalId,
      portfolio,
      kind,
      raw,
      contentHash,
      stakeAtoms: null,
      pnlAtoms: null,
      legCount: Array.isArray(value?.legs) ? value.legs.length : null,
      status: typeof value?.status === "string" ? value.status : null,
      currency: typeof value?.currency === "string" ? value.currency : null,
      warnings: [],
      disposition: "ACCEPTED",
    };
    if (!originalId) {
      row.warnings.push("ORIGINAL_ID_MISSING");
      row.disposition = "QUARANTINE";
    }
    if (new TextEncoder().encode(raw).length > 65536) {
      row.warnings.push("RECORD_TOO_LARGE");
      row.disposition = "QUARANTINE";
    }
    if (kind === "TICKET") {
      try {
        row.stakeAtoms = amount(value.stake);
        row.pnlAtoms = amount(value.pnl);
      } catch (e) {
        row.warnings.push((e as Error).message);
        row.disposition = "QUARANTINE";
      }
      if (!value.modelVersion) row.warnings.push("MODEL_VERSION_MISSING");
      if (!value.predictionId) row.warnings.push("ORIGINAL_PREDICTION_MISSING");
      if (row.legCount === null) row.warnings.push("LEGS_UNKNOWN");
      if (row.currency === null) row.warnings.push("CURRENCY_UNKNOWN");
    }
    const prior = seen.get(businessKey);
    if (prior) {
      row.disposition = prior === contentHash ? "DUPLICATE" : "QUARANTINE";
      if (prior !== contentHash)
        row.warnings.push("SAME_KEY_DIFFERENT_CONTENT");
    } else seen.set(businessKey, contentHash);
    rows.push(row);
  }
  const report = reconcile(rows);
  return {
    namespace,
    manifest,
    rows,
    claims,
    warnings,
    report,
    previewHash: await sha(
      canonical({ namespace, manifest, rows, claims, warnings, report }),
    ),
  };
}
export function reconcile(rows: ArchiveRow[]) {
  const portfolios: Record<string, any> = Object.create(null);
  for (const row of rows) {
    const p = (portfolios[row.portfolio] ||= {
      records: 0,
      accepted: 0,
      duplicates: 0,
      quarantine: 0,
      knownLegs: 0,
      unknownLegs: 0,
      stakeAtoms: "0",
      pnlAtoms: "0",
      missingStake: 0,
      missingPnl: 0,
      statuses: Object.create(null),
      currency: row.currency,
    });
    p.records++;
    p[
      row.disposition === "ACCEPTED"
        ? "accepted"
        : row.disposition === "DUPLICATE"
          ? "duplicates"
          : "quarantine"
    ]++;
    if (row.disposition !== "ACCEPTED" || row.kind !== "TICKET") continue;
    if (row.legCount === null) p.unknownLegs++;
    else p.knownLegs += row.legCount;
    for (const field of ["stakeAtoms", "pnlAtoms"] as const)
      if (row[field] === null)
        p[field === "stakeAtoms" ? "missingStake" : "missingPnl"]++;
      else p[field] = (BigInt(p[field]) + BigInt(row[field]!)).toString();
    const status = row.status || "UNKNOWN";
    p.statuses[status] = (p.statuses[status] || 0) + 1;
    if (p.currency !== row.currency) p.currency = "MIXED_UNKNOWN";
  }
  return {
    mode: "LEGACY_IMPORT",
    readOnly: true,
    records: rows.length,
    portfolios,
    note: "Original claims only; no opening balance or prospective prediction created",
  };
}
