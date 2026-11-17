# PCUB Longitudinal Recommendation Lab: in-browser demo

**Live demo: <https://longisim2027.github.io>**

This site hosts an interactive demo of the
[PCUB Longitudinal Recommendation Lab](https://github.com/Niranjan2003/pcub-longitudinal-recommendation-lab).
It is a research testbed for longitudinal conversational recipe recommendation.

The demo runs the project's real offline backend **inside your browser**. GitHub Pages serves only static files, so:

- The research frontend is built unchanged from the research repository.
- The research backend (Python sources and its 321 hash-verified assets, byte for byte) runs in a Web Worker on [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly).
- A small shim routes the app's `/v1/*` API calls to that worker, which feeds them to the backend's own request handler. Routing, validation, idempotency and error codes are the same code the local server runs.
- Sessions are stored in a SQLite database in your browser (IndexedDB). They survive a reload. Nothing is sent anywhere, and "Reset demo data" in the banner deletes them.

The first visit downloads about 40 MB (the Python runtime, numpy, pandas, pydantic, pyarrow and the backend bundle). The backend then needs about 20 seconds to verify its assets and load the 10,000-recipe catalog. Later visits use the browser cache.

## Faithfulness to the local setup

The backend runs in **offline mode**: deterministic policies, the two synthetic simulators, branch comparisons, and the 77 recorded guarded-LLM decision contexts. It makes no live model calls (`mode: offline`, `live_guarded: false`).

Pyodide ships close but not identical versions of the scientific stack: Python 3.14, numpy 2.4.6, pandas 3.0.2, pydantic 2.12.5 and pyarrow 22, against the release pins of Python 3.12.10, numpy 2.5.1, pandas 3.0.3, pydantic 2.13.4 and pyarrow 24.0.0. To check that this doesn't matter, the same scenario was run against both backends with session ids made deterministic: 41 requests covering human sessions with all four reaction types, both simulators, and branch comparisons with and without the oracle. Every recommended recipe, reaction, prediction set, status and error matched. The only differences were floating-point values in the last binary digit (at most 2.2 × 10⁻¹⁶).

Synthetic runs and the conformal tie-break are seeded from each session's random id, so two runs of the same scenario differ by design. This is equally true of the local server.

The project's own browser acceptance suite (`frontend/e2e`: human and synthetic flows, branch comparisons, axe accessibility checks and 375 px layouts) was run against this static build.

For the exact recorded release environment, run the project locally (see its `SETUP.md`).

## Layout

| Path | Contents |
|---|---|
| `docs/` | The built site, which GitHub Pages serves from here. Generated; don't edit by hand. |
| `docs/build-info.json` | The research commit, Pyodide version and backend bundle this build came from. |
| `tools/build.mjs` | Builds `docs/` from a clean research checkout. |
| `tools/demo-main.ts` | Page entry: imports the shim, then the app's own unmodified `src/main.tsx`. |
| `tools/demo-entry.ts` | Shim: starts the worker, routes `/v1/*` to it, and adds the demo banner and footer. |
| `tools/backend-worker.js` | Module worker: loads Pyodide, unpacks the backend, persists SQLite in IndexedDB. |
| `tools/browser_bridge.py` | Calls the backend's own `Handler.route()` without a socket. |
| `tools/make_bundle.py` | Packs backend sources and assets into a deterministic zip. |

## Rebuilding

Requirements: Node ≥ 22.12, any Python ≥ 3.9 (standard library only), and a clean checkout of the research repository next to this one with `npm ci` run in its `frontend/`.

```bash
node tools/build.mjs --pcub ../pcub-longitudinal-recommendation-lab
```

The script refuses a checkout with local changes. It runs the research repo's `scripts/verify_publication.py`, writes the backend bundle, builds the frontend with the project's own Vite config, and records the commit in `docs/build-info.json`. Commit `docs/` to publish.

## Data and rights

The research code, documentation and artifacts belong to the PCUB project; no open-source license is granted (see the research repository). The demo is published with the project owner's agreement.

The recipe catalog is a subset of the HUMMUS / Food.com dataset (Bölz et al., RecSys 2023). Food.com data may only be used for educational or scientific purposes. The backend bundle also contains recorded model outputs. See [`THIRD_PARTY_DATA.md`](https://github.com/Niranjan2003/pcub-longitudinal-recommendation-lab/blob/main/THIRD_PARTY_DATA.md) for provenance and terms.
