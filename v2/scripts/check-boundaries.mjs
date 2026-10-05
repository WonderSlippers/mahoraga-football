import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const failures = [];
let checked = 0;
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : /\.(?:ts|tsx|mjs|py)$/.test(e.name)
          ? [path.join(dir, e.name)]
          : [],
    );
}
for (const file of ["apps", "packages", "model-runner", "scripts"].flatMap(
  walk,
)) {
  const text = fs.readFileSync(file, "utf8");
  checked++;
  if (/[A-Za-z]:[\\/].*\.wrangler[\\/]state/.test(text))
    failures.push(file + ": production state path");
  if (
    /(?:serviceToken|bootstrap|localSessionToken)\s*[:=]\s*['"][a-f0-9]{32,}['"]/.test(
      text,
    )
  )
    failures.push(file + ": embedded secret");
  if (file.endsWith(".py") && /(?:pickle|joblib)\.load\s*\(/.test(text))
    failures.push(file + ": unsafe deserialization");
  if (file.endsWith(".ts") || file.endsWith(".tsx")) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        file.replaceAll("\\", "/").startsWith("apps/web/") &&
        /apps\/api|services\/|repositories\//.test(node.moduleSpecifier.text)
      )
        failures.push(file + ": UI imports API business layer");
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
console.log(
  JSON.stringify({
    type: "STATIC_BOUNDARY_CHECK_NOT_MODEL_VALIDATION",
    checkedFiles: checked,
    failures,
  }),
);
if (failures.length) process.exitCode = 1;
