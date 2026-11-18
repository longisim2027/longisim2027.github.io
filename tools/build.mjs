// Build the static LongiSim demo for GitHub Pages from a checkout of the research repo.
//
//   node tools/build.mjs [--pcub ../pcub-longitudinal-recommendation-lab] [--python python]
//
// The research checkout must be clean and have `npm ci` run in frontend/.
// Output goes to docs/ (served by GitHub Pages). Nothing in the research
// checkout is modified.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PYODIDE_VERSION = '314.0.7';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const pcub = path.resolve(arg('pcub', path.join(site, '..', 'pcub-longitudinal-recommendation-lab')));
const python = arg('python', 'python');
const frontend = path.join(pcub, 'frontend');
const out = path.join(site, 'docs');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();

// 1. Pin and verify the research checkout.
const commit = run('git', ['-C', pcub, 'rev-parse', 'HEAD']);
const dirty = run('git', ['-C', pcub, 'status', '--porcelain', '--untracked-files=no']);
if (dirty) throw new Error(`Research checkout has local changes; commit or stash them first:\n${dirty}`);
console.log(`PCUB commit ${commit}`);
console.log(run(python, [path.join(pcub, 'scripts', 'verify_publication.py')], { cwd: pcub }).split('\n').pop());

// 2. Fresh output dir; backend bundle.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const [bundleFile, bundleId, fileCount] = run(python, ['-I', path.join(here, 'make_bundle.py'), pcub, out]).split(' ');
console.log(`bundle ${bundleFile} (${fileCount} files)`);

// 3. Frontend: the project's own Vite config, with the demo shim as entry.
const requireFromFrontend = createRequire(path.join(frontend, 'package.json'));
const vite = await import(pathToFileURL(requireFromFrontend.resolve('vite')).href);
const entry = path.join(here, 'demo-main.ts');

// Branding: the demo presents the system as LongiSim. Only the product name in
// the page title and header changes; "PCUB" as the name of the allocation
// method is left untouched everywhere else. Each replacement must match
// exactly once, so an upstream change fails the build instead of being missed.
const BRAND = 'LongiSim';
const TAGLINE = 'A Multi-Agent Platform for User Simulation and Longitudinal Evaluation of Recommender Systems';
const rebrand = (file, text, pairs) =>
  pairs.reduce((acc, [from, to]) => {
    if (acc.split(from).length !== 2) throw new Error(`${file}: expected "${from}" exactly once; update tools/build.mjs`);
    return acc.replace(from, to);
  }, text);

await vite.build({
  root: frontend,
  configFile: path.join(frontend, 'vite.config.ts'),
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: false },
  plugins: [
    {
      name: 'pcub-demo-entry',
      enforce: 'pre',
      resolveId: (id) => (id === '/@pcub-demo-entry' ? entry : null),
      transform: (code, id) =>
        id.replaceAll('\\', '/').endsWith('/src/app/AppShell.tsx')
          ? rebrand('AppShell.tsx', code, [
              ['aria-label="PCUB home"', `aria-label="${BRAND} home"`],
              ['tracking-tight">PCUB</span>', `tracking-tight">${BRAND}</span>`],
            ])
          : null,
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          rebrand('index.html', html, [
            ['src="/src/main.tsx"', 'src="/@pcub-demo-entry"'],
            ['<title>PCUB — Longitudinal Recommendation Lab</title>', `<title>${BRAND} — Longitudinal Recommendation Lab</title>`],
            [
              'content="A research demonstration of the PCUB Longitudinal Multi-Agent Conversational Recommendation System."',
              `content="${BRAND}: ${TAGLINE}. Interactive research demo running entirely in the browser."`,
            ],
          ]),
      },
    },
  ],
});

// 4. Worker, SPA fallback, build record.
const worker = readFileSync(path.join(here, 'backend-worker.js'), 'utf8')
  .replaceAll('__PYODIDE_VERSION__', PYODIDE_VERSION)
  .replaceAll('__BUNDLE_FILE__', bundleFile)
  .replaceAll('__BUNDLE_ID__', bundleId);
writeFileSync(path.join(out, 'backend-worker.js'), worker);
copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html')); // deep links like /lab/sessions/<id>
writeFileSync(path.join(out, '.nojekyll'), '');
writeFileSync(
  path.join(out, 'build-info.json'),
  JSON.stringify({ name: BRAND, research_repository: 'https://github.com/Niranjan2003/pcub-longitudinal-recommendation-lab', research_commit: commit, pyodide: PYODIDE_VERSION, backend_bundle: bundleFile, built_at: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`done -> ${path.relative(site, out)}`);
