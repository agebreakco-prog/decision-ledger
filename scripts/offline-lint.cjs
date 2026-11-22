// Offline equivalent of `forge lint` (which requires `forge login`).
// Runs the Forge CLI's own manifest validator and client-side linters.
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const cliMods = path.join(root, 'node_modules/@forge/cli/node_modules/@forge');
const req = (m) => require(fs.existsSync(path.join(cliMods, m)) ? path.join(cliMods, m) : `@forge/${m}`);
const { validate } = req('manifest');
const lintPkg = req('lint');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(e.name) ? [p] : [];
  });
}

(async () => {
  process.chdir(root);
  const res = await validate(false);
  if (!res.success) {
    console.log('Manifest validation FAILED');
    for (const e of res.errors || []) console.log(`  manifest.yml:${e.line ?? '?'}:${e.column ?? '?'}  ${e.message}`);
    process.exitCode = 1;
  } else console.log('Manifest validation: OK');

  // Feature-gate service stub: no gates enabled, no runtimes deprecated.
  const statsig = new Proxy({}, { get: (_, k) => async () => (/Runtimes|List|Array/.test(String(k)) ? [] : false) });
  const logger = { info: (...a) => console.log(...a), warn: (...a) => console.log(...a), debug: () => {}, error: (...a) => console.log(...a) };
  const files = walk(path.join(root, 'src')).map((f) => path.relative(root, f));
  const results = await lintPkg.lint(files, res.manifestObject.typedContent, 'development', logger, statsig, { linter: { mode: 'client-side' } });
  lintPkg.reportLintResults(logger, results);
  const c = lintPkg.problemCount(results);
  console.log(`Lint: ${c.errors} error(s), ${c.warnings} warning(s), ${c.approvals} approval(s) over ${files.length} files`);
  if (c.errors) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
