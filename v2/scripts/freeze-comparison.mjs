import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { build } from "esbuild";
import { root } from "./safety.mjs";

const original = process.argv[2];
if (!original || !fs.existsSync(path.join(original, ".git")))
  throw Error("VERIFIED_LEGACY_CHECKOUT_REQUIRED");
const base = path.join(root, ".models-local/research");
const target = path.join(root, ".models-local/frozen/20261001-r1");
fs.mkdirSync(target, { recursive: true });
const digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sealed = (name, data) => {
  const out = path.join(target, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out) && digest(fs.readFileSync(out)) !== digest(data))
    throw Error("FROZEN_ASSET_CHANGED:" + name);
  if (!fs.existsSync(out)) fs.writeFileSync(out, data, { flag: "wx" });
  return digest(data);
};
const pins = JSON.parse(
  fs.readFileSync(path.join(root, "model-runner/research-assets.json")),
);
const assets = {};
for (const [name, hash] of Object.entries(pins)) {
  if (
    !(
      name.includes("HONEST_CANDIDATE_2025_") ||
      name.endsWith("return_partial_2026.json") ||
      name.endsWith("/paper_inference.py") ||
      name.endsWith("/model.py")
    )
  )
    continue;
  const data = fs.readFileSync(path.join(base, name));
  if (digest(data) !== hash) throw Error("SOURCE_HASH_MISMATCH:" + name);
  assets[name] = sealed(name, data);
}
const zip = fs.readFileSync(
  path.join(
    original,
    "algorithm-snapshots/2026-09-20-prebatch-source-40ae681.zip",
  ),
);
if (
  digest(zip) !==
  "d968249005634f18ebd71a831a3ca34263e347ed4efa9bc956159bccf23f1044"
)
  throw Error("SOURCE_HASH_MISMATCH");
assets["legacy-source.zip"] = sealed("legacy-source.zip", zip);
const sources = {};
const commit = "40ae6816dfbcbdfd89eac1a05eefae98ecd0db9b";
for (const name of ["lib/goal-model.ts", "lib/simulation-lab.ts"]) {
  const result = spawnSync("git", ["show", commit + ":" + name], {
    cwd: original,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status) throw Error("SOURCE_READ_FAILED");
  sources[name] = result.stdout.toString("utf8");
  assets[name] = sealed(name, result.stdout);
}
const required = new Set([
  "dcTau",
  "dcScoreGrid",
  "makeGoalEvidence",
  "makeCurrentOnlyGoalEvidence",
  "poissonAtLeast",
  "poissonSpread",
  "form",
  "candidate",
  "spreadCandidate",
  "totalsPoissonCandidate",
]);
const vars = new Set([
  "DC_RHO",
  "clamp",
  "shrink",
  "prevWeight",
  "DERBY_CITIES",
  "isDerby",
  "currentModelW",
  "currentEvolutionShift",
]);
const declarations = [];
for (const [name, source] of Object.entries(sources)) {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && required.has(node.name?.text))
      declarations.push(node.getText(ast));
    if (ts.isVariableStatement(node)) {
      const selected = node.declarationList.declarations.filter((d) =>
        vars.has(d.name.getText(ast)),
      );
      // clamp has identical name in both files; goal clamp must remain separate.
      for (const d of selected) {
        const key = d.name.getText(ast);
        if (name.includes("simulation") && key === "clamp") continue;
        declarations.push(
          (node.declarationList.flags & ts.NodeFlags.Let ? "let " : "const ") +
            d.getText(ast) +
            ";",
        );
      }
    }
  }
}
// The simulation clamp accepts bounds, unlike the goal clamp. Preserve both exact formulae.
const code = declarations
  .join("\n")
  .replace(
    /const clamp\s*=[^;]+;/,
    "const goalClamp = (n:number) => Math.max(.25,Math.min(4,n));\nconst clamp = (n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));",
  )
  .replace(/=clamp\(rates/g, "=goalClamp(rates")
  .replace(/=clamp\(shrink/g, "=goalClamp(shrink");
const adapter =
  `// Pure arithmetic extracted from ${commit}; no imports, DB, account or fetching.\n// Presentation callbacks are inert; scores and historical portfolio controls are not reproduced.\n` +
  `type Match=any;type Leg=any;type Evidence=any;type GoalStats=any;type GoalEvidence=any;\nconst analysisText=(..._args:any[])=>'';const researchRationale=(..._args:any[])=>[];const scoreLeg=(..._args:any[])=>null;\n` +
  code +
  `\nexport function evaluate(input:any){\nconst saved=Date.now;Date.now=()=>input.at;try{\nconst g=input.goalStats;let goalModel=null;\nif(g){goalModel=g.homePrev&&g.awayPrev?makeGoalEvidence(g.home,g.away,g.homePrev,g.awayPrev,g.mean,g.meanPrev,[],[g.season,g.season-1],g.observedAt):makeCurrentOnlyGoalEvidence(g.home,g.away,g.mean,'',g.season,g.observedAt);}\nconst match={...input.match,goalModel};const broad=candidate(match),value=candidate(match,true),spread=spreadCandidate(match),total=totalsPoissonCandidate(match);\nconst featured=[value,spread,total].filter(Boolean).sort((a,b)=>b.edge-a.edge)[0]||null;\nreturn {broad,featured,goalModel};\n}finally{Date.now=saved;}}\n`;
assets["legacy-arithmetic.ts"] = sealed(
  "legacy-arithmetic.ts",
  Buffer.from(adapter),
);
const compiled = await build({
  stdin: { contents: adapter, loader: "ts", resolveDir: target },
  write: false,
  format: "esm",
  platform: "node",
  target: "node20",
});
assets["legacy-arithmetic.mjs"] = sealed(
  "legacy-arithmetic.mjs",
  compiled.outputFiles[0].contents,
);
for (const name of ["build_features.py", "features_v5.py", "goal-core.mjs"]) {
  assets["upstream/" + name] = sealed(
    "upstream/" + name,
    fs.readFileSync(
      path.join(base, "mahoraga_v6_league_policies/code/upstream", name),
    ),
  );
}
const manifest = {
  version: 1,
  selected: "V6_C388_FROZEN_20261001",
  parallel: "LEGACY_20260920_FROZEN_V2",
  savedV7: "V7_RETURN_PARTIAL_QUOTE_WEIGHTED_FIXED",
  sourceCommit: commit,
  legacyDefaults: { goalWeight: 0.5, evolutionShift: 0 },
  assets,
};
sealed("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
const pinFile = path.join(root, "model-runner/comparison-assets-r1.json");
const json = JSON.stringify(manifest, null, 2) + "\n";
if (fs.existsSync(pinFile) && fs.readFileSync(pinFile, "utf8") !== json)
  throw Error("FROZEN_MANIFEST_CHANGED");
if (!fs.existsSync(pinFile)) fs.writeFileSync(pinFile, json, { flag: "wx" });
console.log(
  JSON.stringify({
    directory: target,
    assetN: Object.keys(assets).length,
    manifestHash: digest(Buffer.from(json)),
  }),
);
