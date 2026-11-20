# LongiSim

**A Multi-Agent Platform for User Simulation and Longitudinal Evaluation of Recommender Systems**

[**Live demo → longisim2027.github.io**](https://longisim2027.github.io) · [Research repository](https://github.com/Niranjan2003/pcub-longitudinal-recommendation-lab)

---

LongiSim evaluates recommendation policies over **whole interaction trajectories** instead of single recommendations. A recommender and a user interact for many turns. The user can be a person or a synthetic simulator. Each reaction changes the user's state and the context for the next recommendation, so the platform can measure how the effects of a policy build up over time. It can also replay a moment of a session under alternative futures to ask what a different policy would have done.

The current testbed uses the food domain, with a 10,000-recipe catalog from the HUMMUS / Food.com dataset.

## Contents

- [The simulation loop](#the-simulation-loop)
- [Running a simulation in the browser](#running-a-simulation-in-the-browser)
- [Experimental factors](#experimental-factors)
- [What a run produces](#what-a-run-produces)
- [Scripting experiments](#scripting-experiments)
- [Interpreting results](#interpreting-results)
- [About this deployment](#about-this-deployment)

## The simulation loop

Every turn runs the same five steps, in the same order, for human and synthetic users alike:

| Step | What happens |
|---|---|
| 1. Recommend | The safety filter removes candidates that break the user's hard constraints, and the **policy** ranks the rest of a 48-recipe window. |
| 2. Forecast | Before any reaction exists, the **predictor** estimates the probability of each reaction: accept, modify/clarify, defer, reject. The forecast is stored and never edited. |
| 3. Outcome | A person picks a reaction, or the **simulator** generates one from private tendencies the predictor never sees. |
| 4. Commit | One atomic step appends the turn to the history, updates the six state variables (trust, motivation, fatigue, satisfaction, engagement, resistance) and lets an adaptive predictor learn from the revealed reaction. |
| 5. Next turn | The new history and state shape the next recommendation and forecast. |

A session runs for a planned horizon of segments × turns (2 × 6 by default). At any pending turn, a **branch comparison** expands up to 20 hypothetical futures (4 first reactions × 4 second reactions). It estimates which of two policies would do better from that point and never changes the session itself.

## Running a simulation in the browser

Open the [live demo](https://longisim2027.github.io). The backend starts in about 20 seconds on the first visit; the banner at the top shows its progress. Then:

1. **Create a synthetic scenario.** Go to **Live Session → Synthetic simulation**. Choose a curated simulated user, a simulator, a recommendation policy and a predictor, then **Create scenario**.
2. **Run the trajectory.** Use **Run 1 turn with simulator reactions** or **Run 3 turns with simulator reactions** to step through, or **Run all … remaining turns** to finish the plan. Each turn shows the recommended recipe, the forecast made before the reaction, the simulated reaction and the updated state. The timeline and state charts track the trajectory.
3. **Compare policies on hypothetical futures.** At a pending turn, choose **Open the branch explorer**. Pick two policies, an allocator and a budget, turn on the **synthetic oracle**, and choose **Run branch comparison**. The result shows:
   - the expanded branch tree and the order in which nodes were expanded;
   - the estimated value of each policy;
   - the oracle's reference values;
   - the **regret** of the limited estimate.
4. **Read the outcome.** When the last planned turn is done, the session closes and shows a trajectory summary. Create another scenario with one factor changed to compare.

**Human sessions** follow the same loop, except that you answer each recommendation yourself. Choose **Human interaction**, describe a persona and its hard constraints (diet, maximum time, maximum ingredients), and react with **Accept**, **Modify / clarify**, **Defer** or **Reject**.

Sessions are stored in your browser and survive a reload. **Reset demo data** in the footer deletes them.

## Experimental factors

| Factor | Options | What it controls |
|---|---|---|
| User | Human, or a synthetic fixture | Who produces the reactions. A fixture fixes the simulated user's profile, initial state, request and horizon. |
| Simulator | **Structured**: probabilistic, seeded. **Agenda-derived**: rule-based, deterministic, inspired by agenda-based user simulation. | How synthetic reactions are generated. In human sessions it only selects the model bundle used for forecasts. |
| Policy | Constraint-only (control), Deterministic, Feedback-sequence, Guarded LLM scorer | How recipes are ranked. Feedback-sequence is the most history-sensitive non-LLM policy. Offline, the guarded LLM can answer only 77 recorded contexts. |
| Predictor | Population (frozen), Class bias, Contextual | How reactions are forecast. The adaptive modes learn within one scenario, only after each reveal. |
| Allocator | Equal, Greedy, Uncertainty-first, PCUB | Which hypothetical branch node a comparison expands next. PCUB weighs probability, uncertainty, policy disagreement and cost. |
| Budget | 2, 4, 8, 12 nodes | How much of the 20-node branch forest a comparison may evaluate. |
| Oracle | On or off (synthetic sessions only) | Exhaustive reference values under the simulator's private probabilities, used to compute regret. |
| Horizon | 1–4 segments × 1–12 turns (human) | Session length. State and predictor adaptation carry across segments. |

## What a run produces

Per turn:
- the recommended recipe and its ranking rationale;
- the forecast reaction probabilities and conformal prediction sets;
- the realized reaction and continuation flag;
- the state before and after the turn.

Per session:
- the full trajectory: reaction counts, state over time, and how well forecasts anticipated realized reactions.

Per branch comparison:
- the expanded nodes and their order;
- each policy's estimated value;
- the selected policy;
- with the oracle: reference values, best policy, **regret**, value error and rank agreement;
- a cost ledger.

These outputs support questions such as:
- **Policy effects over time.** Under the same simulated user, which policy keeps trust and satisfaction higher across the trajectory, and how quickly does a weak policy lose the user?
- **Robustness across simulators.** Does a policy's ranking hold under both the structured and the agenda-derived simulator?
- **Forecasting.** Do adaptive predictors anticipate realized reactions better than the frozen population model as a session goes on?
- **Budgeted evaluation.** How much regret does each allocator incur at a given budget, compared with the oracle?

## Scripting experiments

For repeated, larger runs, start the backend locally from the research repository (see its `SETUP.md`). Then drive it over its HTTP API. [`examples/run_simulation.py`](examples/run_simulation.py) is a ready-made experiment that needs only the Python standard library. It:
- runs complete synthetic sessions for every simulator × policy pair;
- at one turn, runs a branch comparison with each allocator and the oracle;
- writes one CSV row per session and prints a summary.

```bash
# in the research repository
cd backend
PYTHONPATH=src python -m demo_backend.api.server --assets assets \
    --database runtime/experiment.sqlite3 --port 8765

# in this repository
python examples/run_simulation.py --base http://127.0.0.1:8765 --repeats 3 --out results.csv
```

Options:
- `--predictor`: `population`, `class_bias` or `contextual`;
- `--compare-turn`: the turn at which to run comparisons, or `0` for none;
- `--budget`: `2`, `4`, `8` or `12`.

A run takes about 15 seconds per session. Excerpt from one run with two repeats per cell; synthetic reactions vary between runs:

```text
simulator                        policy                                     accept reject  trust satisf.
current_structured_simulator@1   constraint_only_baseline                      2.0    0.5   0.75    0.61
current_structured_simulator@1   feedback_sequence_recipe_recommendation       7.5    1.0   0.83    0.85
usersimcrs_agenda_derived@1      constraint_only_baseline                      0.0   12.0   0.00    0.00
usersimcrs_agenda_derived@1      feedback_sequence_recipe_recommendation       2.0    2.0   0.64    0.49
```

The API has nine endpoints under `/v1`. The ones an experiment needs are:

| Request | Purpose |
|---|---|
| `GET /v1/capabilities` | Available policies, simulators, predictors, allocators and budgets |
| `POST /v1/sessions` | Create a human or synthetic session |
| `POST /v1/sessions/{id}/recommendations` | Steps 1–2: recommend and forecast |
| `POST /v1/sessions/{id}/feedback` | Steps 3–4: submit, or for a synthetic session generate, the reaction and commit it |
| `POST /v1/branch-comparisons` | Compare two policies on hypothetical futures from the pending turn |
| `GET /v1/sessions/{id}`, `GET /v1/branch-comparisons/{id}` | Read stored results |

Every write takes an `Idempotency-Key` header and the session's `expected_revision`, so a retried request is applied exactly once.

## Interpreting results

- **The state variables are engineered.** They move by a fixed rule per reaction and are simulation variables, not measurements of anyone's psychology.
- **Simulated users are not people.** Oracle values and regret are relative to the simulator, not human ground truth. Human sessions have no oracle.
- **Each run is one sample.** Synthetic reactions and tie-breaks are seeded from each session's random identifier. Repeat runs and report spreads, not single values.
- **One comparison is one case.** Branch estimates are budget-limited approximations, and estimates from different budgets are not on a common scale.
- **The safety filter is approximate.** It relies on keyword matching and is not dietary or allergy certification.

The research repository's `frontend/docs/USER_GUIDE.md` and `SCIENTIFIC_INTERPRETATION.md` give the full definitions.

## About this deployment

GitHub Pages serves only static files, so the demo runs the platform's real backend **inside the visitor's browser**:

| Component | How it runs |
|---|---|
| Frontend | The research application, built from the research repository. Only the product name in the header and page title differs. |
| Backend | The unmodified Python backend and its 321 hash-verified assets, in a Web Worker on [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly). |
| API | A small shim routes `/v1/*` requests to the worker, which passes them to the backend's own request handler. |
| Storage | SQLite in the browser's IndexedDB. Nothing leaves the browser. |

The first visit downloads about 40 MB, which the browser then caches. The demo runs in offline mode and makes no live model calls.

**Fidelity.** Pyodide provides close but not identical package versions: Python 3.14.2, numpy 2.4.6, pandas 3.0.2, pydantic 2.12.5 and pyarrow 22.0.0, against the release pins of 3.12.10, 2.5.1, 3.0.3, 2.13.4 and 24.0.0. To check the effect, the same 41-request scenario was run on the native and in-browser backends with session identifiers made deterministic. The scenario covered human sessions, both simulators, and comparisons with and without the oracle. Every recipe, reaction, prediction set, status and error matched, and numbers differed by at most 2.2 × 10⁻¹⁶. The project's browser acceptance suite passes 32/32 against this build. For the exact release environment, run the project locally.

### Repository layout

| Path | Contents |
|---|---|
| `docs/` | The built site, served by GitHub Pages (generated; do not edit) |
| `docs/build-info.json` | Research commit, Pyodide version and backend bundle of the current build |
| `examples/run_simulation.py` | Scripted simulation experiment against a local backend |
| `tools/build.mjs` | Builds `docs/` from a clean research checkout |
| `tools/demo-main.ts`, `tools/demo-entry.ts` | Page entry and shim: start the worker, route `/v1/*`, add the banner and footer |
| `tools/backend-worker.js`, `tools/browser_bridge.py` | Run the backend in Pyodide and call its request handler without a socket |
| `tools/make_bundle.py` | Packs backend sources and assets into a deterministic zip |

### Building

You need:
- Node.js ≥ 22.12;
- Python ≥ 3.9;
- a clean checkout of the research repository next to this one, with `npm ci` run in its `frontend/`.

```bash
node tools/build.mjs --pcub ../pcub-longitudinal-recommendation-lab
```

The build:
1. Refuses a research checkout with local changes.
2. Runs the research repository's publication check.
3. Builds the site into `docs/` and records the research commit.

Commit `docs/` to publish.

## Data and rights

The research code, documentation and artifacts belong to the project authors. No open-source licence is granted; see the research repository. This demo is published with the project owner's agreement.

The recipe catalog is a subset of the HUMMUS / Food.com dataset (Bölz et al., RecSys 2023). Food.com data may be used only for educational or scientific purposes. The backend bundle also contains recorded model outputs. See [`THIRD_PARTY_DATA.md`](https://github.com/Niranjan2003/pcub-longitudinal-recommendation-lab/blob/main/THIRD_PARTY_DATA.md) for provenance and terms.
