/*
 * Demo entry for the static GitHub Pages build.
 *
 * The PCUB frontend is built unchanged from the research repository. This shim
 * runs first: it starts a Web Worker that hosts the real offline LongiSim backend in
 * Pyodide, routes the app's same-origin /v1/* requests to it, and shows a slim
 * banner explaining what is running. Then it loads the app's own entry point.
 */

type WorkerMsg =
  | { type: 'progress'; stage: string; detail: string }
  | { type: 'ready'; seconds: number }
  | { type: 'failed'; detail: string }
  | { type: 'reset-done' }
  | { type: 'response'; id: number; text?: string; error?: string };

// Resolve from the site root, not the page: deep links like /lab/sessions/<id>
// load this same page, and a page-relative URL would point inside that path.
const worker = new Worker(new URL('/backend-worker.js', location.origin), { type: 'module' });
const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: unknown) => void }>();
let nextId = 0;

/* ---------- banner ---------- */
const style = document.createElement('style');
style.textContent = `
#pcub-demo-banner{--b-bg:#eef3fb;--b-fg:#1d2a3a;--b-muted:#4a5a70;--b-line:#c9d6ea;--b-accent:#2456a6;
  background:var(--b-bg);color:var(--b-fg);border-bottom:1px solid var(--b-line);
  font:14px/1.45 "IBM Plex Sans",system-ui,sans-serif;padding:8px 16px}
#pcub-demo-banner .row{max-width:1200px;margin:0 auto;display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap}
#pcub-demo-banner strong{font-weight:600}
#pcub-demo-banner .msg{color:var(--b-muted);flex:1 1 320px;min-width:0}
#pcub-demo-banner .dot{width:8px;height:8px;border-radius:50%;background:var(--b-accent);flex:none}
#pcub-demo-banner[data-state=boot] .dot{animation:pcubpulse 1.2s ease-in-out infinite}
#pcub-demo-banner[data-state=failed] .dot{background:#c0392b}
@keyframes pcubpulse{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){#pcub-demo-banner .dot{animation:none!important}}
#pcub-demo-footer{--b-bg:#eef3fb;--b-fg:#1d2a3a;--b-line:#c9d6ea;--b-accent:#2456a6;
  background:var(--b-bg);color:var(--b-fg);border-top:1px solid var(--b-line);
  font:14px/1.45 "IBM Plex Sans",system-ui,sans-serif;padding:12px 16px}
#pcub-demo-footer .about{max-width:1200px;margin:0 auto 8px}
#pcub-demo-footer .about span{display:block;color:#4a5a70}
#pcub-demo-footer .row{max-width:1200px;margin:0 auto;display:flex;gap:6px 16px;align-items:center;flex-wrap:wrap}
#pcub-demo-footer a,#pcub-demo-footer button{color:var(--b-accent);font:inherit}
#pcub-demo-footer button{background:none;border:1px solid var(--b-line);border-radius:6px;padding:2px 10px;cursor:pointer}
#pcub-demo-footer button:hover{border-color:var(--b-accent)}
`;
document.head.append(style);

// Top banner: status text only, nothing focusable, so the app's own
// "Skip to content" link stays the first Tab stop.
const banner = document.createElement('div');
banner.id = 'pcub-demo-banner';
banner.setAttribute('role', 'status');
banner.innerHTML = `<div class="row"><span class="dot" aria-hidden="true"></span>
<strong>LongiSim · in-browser research demo</strong>
<span class="msg">Starting the backend…</span></div>`;
document.body.prepend(banner);
const msgEl = banner.querySelector('.msg') as HTMLElement;
banner.dataset.state = 'boot';

// Controls live after the app in DOM and tab order.
const footer = document.createElement('div');
footer.id = 'pcub-demo-footer';
footer.innerHTML = `<div class="about"><strong>LongiSim</strong>: A Multi-Agent Platform for User Simulation and Longitudinal Evaluation of Recommender Systems.
<span>Simulated and human users interact with recommendation policies over many turns, so a policy is judged by how its effects build up over time, not by a single recommendation.</span></div>
<div class="row">
<a href="https://github.com/Niranjan2003/pcub-longitudinal-recommendation-lab" target="_blank" rel="noopener">Research repository</a>
<a href="https://github.com/longisim2027/longisim2027.github.io#readme" target="_blank" rel="noopener">How this demo works</a>
<button type="button" hidden>Reset demo data</button></div>`;
document.body.append(footer);
const resetBtn = footer.querySelector('button') as HTMLButtonElement;

const READY_TEXT =
  'The real offline LongiSim backend runs in your browser (Python on WebAssembly). No server and no model calls; sessions stay in this browser.';

resetBtn.addEventListener('click', () => {
  if (!confirm('Delete all demo sessions stored in this browser and reload?')) return;
  for (const k of Object.keys(localStorage)) if (k.startsWith('pcub.')) localStorage.removeItem(k);
  worker.postMessage({ type: 'reset' });
});

let failed = false;
function fail(detail: string) {
  failed = true;
  banner.dataset.state = 'failed';
  msgEl.textContent = `The in-browser backend could not start: ${detail}. Try a current desktop Chrome, Edge or Firefox, or run the project locally.`;
  for (const [, p] of pending) p.reject(new TypeError('In-browser backend failed to start'));
  pending.clear();
}
worker.onerror = (e) => fail(e.message || 'the backend worker could not be loaded');

worker.onmessage = (event: MessageEvent<WorkerMsg>) => {
  const m = event.data;
  if (m.type === 'progress') msgEl.textContent = `Starting the backend (first visit downloads about 40 MB, then it is cached): ${m.detail}…`;
  else if (m.type === 'ready') {
    banner.dataset.state = 'ready';
    msgEl.textContent = READY_TEXT;
    resetBtn.hidden = false;
  } else if (m.type === 'failed') fail(m.detail);
  else if (m.type === 'reset-done') location.reload();
  else if (m.type === 'response') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error !== undefined || m.text === undefined) {
      p.resolve(new Response('', { status: 502 }));
      return;
    }
    const { status, body } = JSON.parse(m.text) as { status: number; body: unknown };
    p.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  }
};
worker.postMessage({ type: 'boot' });

/* ---------- fetch routing ---------- */
const nativeFetch = window.fetch.bind(window);

function headerValue(h: HeadersInit | undefined, name: string): string {
  if (!h) return '';
  return new Headers(h).get(name) ?? '';
}

window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/v1/')) return nativeFetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';
  const key = headerValue(init?.headers, 'Idempotency-Key');
  const signal = init?.signal;
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (failed) return reject(new TypeError('In-browser backend failed to start'));
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    // An aborted GET just stops waiting; the backend still answers (reads have no effect).
    signal?.addEventListener('abort', () => {
      if (pending.delete(id)) reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    });
    worker.postMessage({ type: 'request', id, method, path: url.pathname + url.search, key, body });
  });
};
