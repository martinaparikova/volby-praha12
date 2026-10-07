"""
Generates plausible SAMPLE election-night results (not real data) for the
results-tracking page, based on the real candidate lists already parsed into
data/candidates-praha12.json / data/candidates-praha11.json.

This exists purely so the results UI can be built and previewed before the
real ČSÚ results feed exists (available only once the election has started,
9.-10. 10. 2026). Once the real format is known, replace this script's output
with a converter that reads the actual ČSÚ feed instead.

Usage:
  python scripts/generate_sample_results.py [slug ...]
"""
import json
import os
import random
import sys

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
TOTAL_SEATS = 35

MUNICIPALITIES = {
    "praha12": {
        "candidates_file": "candidates-praha12.json",
        "results_file": "results-praha12.json",
        "seed": 1012,
    },
    "praha11": {
        "candidates_file": "candidates-praha11.json",
        "results_file": "results-praha11.json",
        "seed": 1011,
    },
}


def dhondt_seats(parties, total_seats):
    """parties: list of dicts with 'votes'. Returns list of seat counts (same order)."""
    seats = [0] * len(parties)
    for _ in range(total_seats):
        quotients = [parties[i]["votes"] / (seats[i] + 1) for i in range(len(parties))]
        winner = max(range(len(parties)), key=lambda i: quotients[i])
        seats[winner] += 1
    return seats


def generate(slug):
    config = MUNICIPALITIES[slug]
    with open(os.path.join(DATA_DIR, config["candidates_file"]), encoding="utf-8") as f:
        candidates_data = json.load(f)

    rng = random.Random(config["seed"])
    parties_src = candidates_data["parties"]

    # Plausible-looking, randomized vote shares (not real results).
    raw_weights = [rng.uniform(0.4, 1.0) ** 2 for _ in parties_src]
    total_weight = sum(raw_weights)
    total_votes_cast = rng.randint(7500, 9500)
    party_results = []
    for party, weight in zip(parties_src, raw_weights):
        votes = round(total_votes_cast * weight / total_weight)
        party_results.append({"id": party["id"], "name": party["name"], "votes": votes})

    # Normalize so percentages read nicely.
    total_votes = sum(p["votes"] for p in party_results)
    for p in party_results:
        p["votesPercent"] = round(p["votes"] / total_votes * 100, 1)

    seats_won = dhondt_seats(party_results, TOTAL_SEATS)
    for p, n in zip(party_results, seats_won):
        p["seats"] = n

    party_results.sort(key=lambda p: p["votes"], reverse=True)

    # Build the 35 council seats: for each party, its top N candidates (by
    # ballot number) fill its allocated seats - a simplification of real
    # preferential-vote tallying, fine for a visual sample.
    candidates_by_party = {p["id"]: sorted(p["candidates"], key=lambda c: c["number"] or 999) for p in parties_src}
    filled_seats = []
    for p in party_results:
        for c in candidates_by_party[p["id"]][: p["seats"]]:
            filled_seats.append({"name": c["name"], "partyId": p["id"], "partyName": p["name"]})

    rng.shuffle(filled_seats)

    # Simulate "election night in progress": only some precincts counted so
    # far, so only part of the seats are confirmed yet.
    precincts_total = rng.randint(28, 36)
    progress = rng.uniform(0.45, 0.7)
    precincts_counted = max(1, round(precincts_total * progress))
    confirmed_count = max(1, round(TOTAL_SEATS * progress))

    seats = []
    for i in range(TOTAL_SEATS):
        if i < confirmed_count:
            seats.append({"seatNumber": i + 1, **filled_seats[i]})
        else:
            seats.append({"seatNumber": i + 1, "name": None, "partyId": None, "partyName": None})
    rng.shuffle(seats)
    for i, s in enumerate(seats, start=1):
        s["seatNumber"] = i

    # Scale down displayed vote totals/percentages proportionally to progress
    # too, so the party table looks consistent with "not fully counted yet".
    for p in party_results:
        p["votes"] = round(p["votes"] * progress)

    result = {
        "municipality": candidates_data["municipality"],
        "election": "Volby do zastupitelstev obcí 2026",
        "isSample": True,
        "sampleNote": "Ukázková data pro vývoj a náhled stránky - nejde o skutečné výsledky voleb.",
        "generatedAt": None,  # filled in by the frontend with fetch time; left null here
        "totalSeats": TOTAL_SEATS,
        "precinctsTotal": precincts_total,
        "precinctsCounted": precincts_counted,
        "turnoutPercent": round(rng.uniform(28, 48), 1),
        "parties": [
            {"id": p["id"], "name": p["name"], "votesPercent": p["votesPercent"], "seats": p["seats"]}
            for p in party_results
        ],
        "seats": seats,
    }

    out_path = os.path.join(DATA_DIR, config["results_file"])
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    confirmed = sum(1 for s in seats if s["name"])
    print(f"[{slug}] wrote {out_path}: {confirmed}/{TOTAL_SEATS} seats confirmed, "
          f"{precincts_counted}/{precincts_total} okrsků, {len(party_results)} stran")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    slugs = sys.argv[1:] or list(MUNICIPALITIES.keys())
    for slug in slugs:
        generate(slug)
