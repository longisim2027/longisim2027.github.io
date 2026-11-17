/* PCUB in-browser backend worker (module worker).
 *
 * Boots Pyodide, unpacks the research backend (Python sources + verified
 * assets, unchanged), and answers the frontend's /v1 requests by calling the
 * backend's own request handler. The SQLite database lives in IndexedDB so
 * sessions survive a reload in the same browser. Nothing leaves the browser.
 *
 * Build-time constants (replaced by tools/build.mjs): __PYODIDE_VERSION__,
 * __BUNDLE_FILE__, __BUNDLE_ID__.
 */
const PYODIDE_VERSION = '__PYODIDE_VERSION__';
const BUNDLE_FILE = '__BUNDLE_FILE__';
const BUNDLE_ID = '__BUNDLE_ID__';
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const DB_DIR = '/data';
const DB_PATH = `${DB_DIR}/pcub-${BUNDLE_ID}.sqlite3`;

let loadPyodide = null;
let py = null;
let bridge = null;
let ready = null;
let queue = Promise.resolve();

const progress = (stage, detail) => postMessage({ type: 'progress', stage, detail });

function syncfs(populate) {
  return new Promise((resolve, reject) => py.FS.syncfs(populate, (err) => (err ? reject(err) : resolve())));
}

async function boot() {
  const t0 = performance.now();
  progress('runtime', 'Loading the Python runtime (WebAssembly)');
  ({ loadPyodide } = await import(`${INDEX_URL}pyodide.mjs`));
  py = await loadPyodide({ indexURL: INDEX_URL });

  progress('packages', 'Loading numpy, pandas, pydantic and pyarrow');
  const bundle = fetch(new URL(BUNDLE_FILE, self.location.href)).then((r) => {
    if (!r.ok) throw new Error(`Backend bundle HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  await py.loadPackage(['numpy', 'pandas', 'pydantic', 'pyarrow'], { messageCallback: () => {} });

  progress('bundle', 'Unpacking the research backend and its assets');
  py.unpackArchive(await bundle, 'zip', { extractDir: '/pcub' });

  py.FS.mkdirTree(DB_DIR);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, DB_DIR);
  await syncfs(true);
  // Drop databases written by older bundles; their sessions refer to other assets.
  for (const name of py.FS.readdir(DB_DIR)) {
    if (name.startsWith('pcub-') && !name.startsWith(`pcub-${BUNDLE_ID}.sqlite3`)) py.FS.unlink(`${DB_DIR}/${name}`);
  }

  progress('verify', 'Verifying all 321 asset hashes and loading the 10,000-recipe catalog');
  await py.runPythonAsync(`
import sys
sys.path[:0] = ['/pcub/src', '/pcub']
import browser_bridge
browser_bridge.start('/pcub/assets', ${JSON.stringify(DB_PATH)})
`);
  bridge = py.pyimport('browser_bridge');
  await syncfs(false);
  postMessage({ type: 'ready', seconds: Math.round((performance.now() - t0) / 100) / 10 });
}

async function handle({ method, path, key, body }) {
  await ready;
  const text = bridge.dispatch(method, path, key || '', body || '');
  if (method === 'POST') await syncfs(false);
  return text;
}

async function reset() {
  await ready.catch(() => {});
  if (py) {
    for (const name of py.FS.readdir(DB_DIR)) if (name.startsWith('pcub-')) py.FS.unlink(`${DB_DIR}/${name}`);
    await syncfs(false);
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'boot') {
    ready ??= boot().catch((err) => {
      postMessage({ type: 'failed', detail: String(err && err.message ? err.message : err) });
      throw err;
    });
    return;
  }
  if (msg.type === 'reset') {
    reset().then(() => postMessage({ type: 'reset-done' }));
    return;
  }
  if (msg.type === 'request') {
    // One request at a time, in order: the real server is also serialized per session.
    queue = queue
      .then(() => handle(msg))
      .then((text) => postMessage({ type: 'response', id: msg.id, text }))
      .catch((err) => postMessage({ type: 'response', id: msg.id, error: String(err && err.message ? err.message : err) }));
  }
};
