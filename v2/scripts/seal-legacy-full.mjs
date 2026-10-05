import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import { format } from "prettier";
import { build } from "esbuild";
const base = ".models-local/frozen/20261001-r1";
const digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
const mathematical = new Set([
  "dcTau",
  "dcScoreGrid",
  "makeGoalEvidence",
  "makeCurrentOnlyGoalEvidence",
  "poissonAtLeast",
  "poissonSpread",
]);
const goalVariables = new Set(["DC_RHO", "clamp", "shrink", "prevWeight"]);
const sourceHashes = {};
const parts = [];
for (const name of ["lib/goal-model.ts", "lib/simulation-lab.ts"]) {
  const source = fs.readFileSync(base + "/" + name, "utf8");
  sourceHashes[name] = digest(Buffer.from(source));
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node)) continue;
    if (name.includes("goal-model")) {
      if (ts.isFunctionDeclaration(node) && mathematical.has(node.name?.text))
        parts.push(node.getText(ast).replace(/^export /, ""));
      if (ts.isVariableStatement(node))
        for (const d of node.declarationList.declarations)
          if (goalVariables.has(d.name.getText(ast)))
            parts.push("const " + d.getText(ast) + ";");
    } else {
      if (
        ts.isFunctionDeclaration(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      )
        continue;
      let text = node.getText(ast).replace(/^export /, "");
      if (
        ts.isFunctionDeclaration(node) &&
        ["candidate", "spreadCandidate", "totalsPoissonCandidate"].includes(
          node.name?.text,
        )
      )
        text = text.replace(
          "function " + node.name.text + "(",
          "function compute_" + node.name.text + "(",
        );
      if (
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (d) => d.name.getText(ast) === "clamp",
        )
      )
        continue;
      parts.push(text);
    }
  }
}
let source = parts
  .join("\n")
  .replace(
    /const clamp\s*=[^;]+;/,
    "const goalClamp=(n:number)=>Math.max(.25,Math.min(4,n));\nconst clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));",
  )
  .replace(/=clamp\(rates/g, "=goalClamp(rates")
  .replace(/=clamp\(shrink/g, "=goalClamp(shrink");
const rawCode = `// @ts-nocheck\n// GENERATED from preserved 40ae6816 source. Do not edit the original sealed assets.\n// Only imports/DB functions removed; scoped clock, clamp collision and frozen-candidate adapters added.\nexport const LEGACY_SOURCE_HASHES=${JSON.stringify(sourceHashes)};\nfunction runtime(at:number,evolution:any){\nconst Date=class extends globalThis.Date{constructor(value?:any){super(value===undefined?at:value)}static now(){return at}};\ntype GoalStats=any;type GoalEvidence=any;\n${source}\ncurrentModelW=evolution.modelW;currentEvolutionShift=evolution.marginShift;\nfunction candidate(m:any,value=false){return m.frozenCandidates?structuredClone(m.frozenCandidates[value?'value':'broad']):compute_candidate(m,value)}\nfunction spreadCandidate(m:any){return m.frozenCandidates?structuredClone(m.frozenCandidates.spread):compute_spreadCandidate(m)}\nfunction totalsPoissonCandidate(m:any){return m.frozenCandidates?structuredClone(m.frozenCandidates.total):compute_totalsPoissonCandidate(m)}\nreturn {candidate,spreadCandidate,totalsPoissonCandidate,processLab,defaults,computeCalibration,makeGoalEvidence,makeCurrentOnlyGoalEvidence};\n}\nexport function legacyEvaluate(input:any){\nconst r=runtime(input.at,input.evolution);const g=input.goalStats;let goalModel=null;\nif(g)goalModel=g.homePrev&&g.awayPrev?r.makeGoalEvidence(g.home,g.away,g.homePrev,g.awayPrev,g.mean,g.meanPrev,[],[g.season,g.season-1],g.observedAt):r.makeCurrentOnlyGoalEvidence(g.home,g.away,g.mean,'',g.season,g.observedAt);\nconst match={...input.match,goalModel};const candidates={broad:r.candidate(match),value:r.candidate(match,true),spread:r.spreadCandidate(match),total:r.totalsPoissonCandidate(match)};\nreturn {match,candidates,central:candidates.broad?.leg.evidence?.adjustedProbabilities??null,goalModel};\n}\nexport function legacyDefaults(){return runtime(0,{modelW:.5,marginShift:0}).defaults()}\nexport function legacyRound(lab:any,matches:any[],at:number){\nconst copy=structuredClone(lab);const old=new Set(copy.portfolios.flatMap((p:any)=>p.tickets.map((t:any)=>p.id+'|'+t.id)));\nconst result=runtime(at,copy.evolution).processLab(copy,structuredClone(matches));\nreturn {lab:copy,result,proposals:copy.portfolios.flatMap((p:any)=>p.tickets.filter((t:any)=>!old.has(p.id+'|'+t.id)).map((t:any)=>({portfolioId:p.id,ticket:t})))};\n}\n`;
const code = await format(rawCode, { parser: "typescript" });
const target = "packages/domain/legacy-september-engine.ts";
fs.writeFileSync(target, code);
const compiled = await build({
  stdin: { contents: rawCode, loader: "ts" },
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
});
const directory = ".models-local/frozen/20261004-legacy-full";
fs.mkdirSync(directory, { recursive: true });
const out = directory + "/engine.mjs";
const bytes = compiled.outputFiles[0].contents;
if (fs.existsSync(out) && digest(fs.readFileSync(out)) !== digest(bytes))
  throw Error("FROZEN_ENGINE_CHANGED");
if (!fs.existsSync(out)) fs.writeFileSync(out, bytes, { flag: "wx" });
const pins = {
  sourceCommit: "40ae6816dfbcbdfd89eac1a05eefae98ecd0db9b",
  sourceHashes,
  typescriptHash: digest(Buffer.from(code)),
  engineHash: digest(bytes),
  scope: "EXACT_PRESERVED_RULES; HISTORICAL_DIRTY_RUNTIME_UNPROVEN",
};
fs.writeFileSync(
  "packages/domain/legacy-september-pins.json",
  JSON.stringify(pins, null, 2) + "\n",
);
console.log(JSON.stringify(pins));
