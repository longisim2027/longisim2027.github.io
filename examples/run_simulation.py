"""Run a small LongiSim simulation experiment against a local backend.

For every simulator x policy pair, the script runs complete synthetic sessions
(2 segments x 6 turns). At one chosen turn it also runs a branch comparison
with each allocator and the synthetic oracle. It writes one CSV row per
session and prints a summary table.

Start the backend from the research repository first (see its SETUP.md), e.g.

    cd backend
    PYTHONPATH=src python -m demo_backend.api.server --assets assets \
        --database runtime/experiment.sqlite3 --port 8765

then run

    python examples/run_simulation.py --base http://127.0.0.1:8765 --repeats 3

Standard library only. Each run uses fresh random session ids, so synthetic
reactions differ between repeats; use --repeats to average over them.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import urllib.error
import urllib.request
import uuid
from collections import Counter

REACTIONS = ["ACCEPT", "MODIFY_CLARIFY", "DEFER", "REJECT"]
STATE_VARS = ["trust", "motivation", "fatigue", "satisfaction", "engagement", "resistance"]

# Synthetic fixtures: each owns the simulated user's profile, initial state,
# request and horizon. The policy under test is chosen separately.
FIXTURES = {
    "current_structured_simulator@1": "trajectory_pcub-v3-current_structured_simulator@1-pcub-v1-pcub-profile-0002-23d45e44-deterministic_recipe_recommendation-v1.json",
    "usersimcrs_agenda_derived@1": "trajectory_pcub-v3-usersimcrs_agenda_derived@1-pcub-v1-pcub-profile-0002-23d45e44-deterministic_recipe_recommendation-v1.json",
}
POLICIES = [
    "constraint_only_baseline",
    "deterministic_recipe_recommendation",
    "feedback_sequence_recipe_recommendation",
]
# Offline, the guarded LLM policy answers only 77 recorded contexts, so it is
# left out of this experiment.
ALLOCATORS = ["equal", "greedy", "uncertainty", "pcub"]


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        headers = {}
        data = None
        if method == "POST":
            # Every write carries an idempotency key, so a retried request is applied once.
            headers = {"Content-Type": "application/json", "Idempotency-Key": str(uuid.uuid4())}
            data = json.dumps(body or {}).encode()
        req = urllib.request.Request(self.base + path, method=method, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req) as res:
                return json.load(res)
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"{method} {path} -> {err.code}: {err.read().decode()[:300]}") from None


def run_session(api: Api, simulator: str, policy: str, predictor: str, compare_turn: int, budget: int) -> dict:
    s = api.call("POST", "/v1/sessions", {
        "world_kind": "synthetic_simulation",
        "policy": policy,
        "prediction_backend": simulator,
        "predictor": predictor,
        "fixture": FIXTURES[simulator],
    })
    reactions: Counter[str] = Counter()
    p_realized = []  # forecast probability the predictor gave to the reaction that then happened
    regrets: dict[str, float] = {}
    turn = 0
    while s["status"] == "open":
        turn += 1
        # 1-2. Recommend and forecast (the forecast is stored before any reaction exists).
        s = api.call("POST", f"/v1/sessions/{s['id']}/recommendations", {"expected_revision": s["revision"]})
        forecast = s["pending"]["probabilities"]

        # Optional: compare two policies on hypothetical futures from this turn.
        if turn == compare_turn:
            for allocator in ALLOCATORS:
                c = api.call("POST", "/v1/branch-comparisons", {
                    "session_id": s["id"],
                    "expected_revision": s["revision"],
                    "policies": ["deterministic_recipe_recommendation", "feedback_sequence_recipe_recommendation"],
                    "allocator": allocator,
                    "budget": budget,
                    "oracle": True,
                })
                regrets[allocator] = c["metrics"]["regret"]

        # 3-4. The simulator generates the reaction; the backend commits it.
        s = api.call("POST", f"/v1/sessions/{s['id']}/feedback", {
            "expected_revision": s["revision"],
            "operation": "feedback",
            "recommendation_id": s["pending"]["id"],
        })
        reaction = s["history"][-1]["reaction"]
        reactions[reaction] += 1
        p_realized.append(forecast[REACTIONS.index(reaction)])

    row = {"simulator": simulator, "policy": policy, "predictor": predictor, "session_id": s["id"], "turns": turn}
    row.update({f"n_{r.lower()}": reactions[r] for r in REACTIONS})
    row["mean_p_realized"] = round(statistics.fmean(p_realized), 4)
    row.update({f"final_{v}": round(s["state"][v], 4) for v in STATE_VARS})
    row.update({f"regret_{a}": regrets.get(a) for a in ALLOCATORS})
    return row


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", default="http://127.0.0.1:8765", help="backend URL")
    ap.add_argument("--repeats", type=int, default=1, help="sessions per simulator x policy")
    ap.add_argument("--predictor", default="contextual", choices=["population", "class_bias", "contextual"])
    ap.add_argument("--compare-turn", type=int, default=4, help="turn at which to run branch comparisons (0 = none)")
    ap.add_argument("--budget", type=int, default=4, choices=[2, 4, 8, 12])
    ap.add_argument("--out", default="simulation_results.csv")
    args = ap.parse_args()

    api = Api(args.base)
    caps = api.call("GET", "/v1/capabilities")
    print(f"backend mode={caps['mode']}, simulators={caps['backends']}")

    rows = []
    for simulator in FIXTURES:
        for policy in POLICIES:
            for i in range(args.repeats):
                row = run_session(api, simulator, policy, args.predictor, args.compare_turn, args.budget)
                rows.append(row)
                print(f"  {simulator:32} {policy:42} run {i + 1}: accept={row['n_accept']:2} reject={row['n_reject']:2} "
                      f"final trust={row['final_trust']:.2f} satisfaction={row['final_satisfaction']:.2f}")

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nMeans over {args.repeats} run(s) per cell (written to {args.out}):")
    print(f"{'simulator':32} {'policy':42} {'accept':>6} {'reject':>6} {'trust':>6} {'satisf.':>7} {'p(real.)':>8}")
    for simulator in FIXTURES:
        for policy in POLICIES:
            cell = [r for r in rows if r["simulator"] == simulator and r["policy"] == policy]
            m = lambda k: statistics.fmean(r[k] for r in cell)
            print(f"{simulator:32} {policy:42} {m('n_accept'):6.1f} {m('n_reject'):6.1f} "
                  f"{m('final_trust'):6.2f} {m('final_satisfaction'):7.2f} {m('mean_p_realized'):8.3f}")
    if args.compare_turn:
        print(f"\nMean regret by allocator (budget {args.budget}, turn {args.compare_turn}):")
        for a in ALLOCATORS:
            print(f"  {a:12} {statistics.fmean(r[f'regret_{a}'] for r in rows):.5f}")


if __name__ == "__main__":
    main()
