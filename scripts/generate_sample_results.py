"""
Generates plausible SAMPLE election-night results (not real data) for the
results-tracking page, based on the real candidate lists already parsed into
data/candidates-praha{1..22}.json.

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

# Real council size per district (počet volených členů zastupitelstva),
# taken from the official 2022 results archive (volby.gov.cz) - these sizes
# are set by municipal statute and don't change between elections.
DISTRICT_SEATS = {
    1: 27, 2: 35, 3: 35, 4: 45, 5: 41, 6: 45, 7: 29, 8: 45, 9: 33, 10: 45,
    11: 35, 12: 35, 13: 35, 14: 31, 15: 31, 16: 15, 17: 23, 18: 23, 19: 15,
    20: 25, 21: 17, 22: 25,
}


def _municipality(number):
    return {
        "candidates_file": f"candidates-praha{number}.json",
        "results_file": f"results-praha{number}.json",
        "seed": 1000 + number,
        "total_seats": DISTRICT_SEATS[number],
    }


MUNICIPALITIES = {f"praha{n}": _municipality(n) for n in DISTRICT_SEATS}
MUNICIPALITIES["magistrat"] = {
    "candidates_file": "candidates-magistrat.json",
    "results_file": "results-magistrat.json",
    "seed": 2026,
    "total_seats": 65,  # Zastupitelstvo hlavního města Prahy (volby.gov.cz, 2022)
    "votes_per_seat": (6000, 9000),  # city-wide turnout is far higher per seat than a district
    "precincts_range": (900, 1400),  # approx. voting precincts across the whole city
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
    total_seats = config["total_seats"]
    with open(os.path.join(DATA_DIR, config["candidates_file"]), encoding="utf-8") as f:
        candidates_data = json.load(f)

    rng = random.Random(config["seed"])
    parties_src = candidates_data["parties"]

    # Plausible-looking, randomized vote shares (not real results). Scaled
    # roughly by council size, so bigger districts (more seats, more
    # inhabitants) also show proportionally more cast votes.
    raw_weights = [rng.uniform(0.4, 1.0) ** 2 for _ in parties_src]
    total_weight = sum(raw_weights)
    lo, hi = config.get("votes_per_seat", (230, 280))
    total_votes_cast = rng.randint(total_seats * lo, total_seats * hi)
    party_results = []
    for party, weight in zip(parties_src, raw_weights):
        votes = round(total_votes_cast * weight / total_weight)
        party_results.append({"id": party["id"], "name": party["name"], "votes": votes})

    # Normalize so percentages read nicely.
    total_votes = sum(p["votes"] for p in party_results)
    for p in party_results:
        p["votesPercent"] = round(p["votes"] / total_votes * 100, 1)

    seats_won = dhondt_seats(party_results, total_seats)
    for p, n in zip(party_results, seats_won):
        p["seats"] = n

    party_results.sort(key=lambda p: p["votes"], reverse=True)

    # Build the council seats: for each party, its top N candidates (by
    # ballot number) fill its allocated seats - a simplification of real
    # preferential-vote tallying, fine for a visual sample.
    candidates_by_party = {p["id"]: sorted(p["candidates"], key=lambda c: c["number"] or 999) for p in parties_src}
    filled_seats = []
    for p in party_results:
        for idx, c in enumerate(candidates_by_party[p["id"]][: p["seats"]]):
            # Plausible preferential-vote counts: roughly proportional to the
            # party's vote total, mildly decreasing by ballot position, with
            # randomness so it doesn't look mechanically generated.
            base = p["votes"] * rng.uniform(0.04, 0.22)
            decay = max(1 - idx * 0.08, 0.3)
            preference_votes = max(5, round(base * decay))
            filled_seats.append({
                "name": c["name"],
                "partyId": p["id"],
                "partyName": p["name"],
                "preferenceVotes": preference_votes,
            })

    rng.shuffle(filled_seats)

    # Simulate "election night in progress": only some precincts counted so
    # far, so only part of the seats are confirmed yet. Precinct count is
    # loosely scaled by council size, so bigger districts show more of them
    # (overridable via "precincts_range" for the city-wide council, which has
    # far more voting precincts than any single district).
    precincts_lo, precincts_hi = config.get(
        "precincts_range",
        (max(5, round(total_seats * 0.5)), max(8, round(total_seats * 1.0) + 5)),
    )
    precincts_total = rng.randint(precincts_lo, precincts_hi)
    progress = rng.uniform(0.45, 0.7)
    precincts_counted = max(1, round(precincts_total * progress))
    confirmed_count = max(1, round(total_seats * progress))

    seats = []
    for i in range(total_seats):
        if i < confirmed_count:
            seats.append({"seatNumber": i + 1, **filled_seats[i]})
        else:
            seats.append({"seatNumber": i + 1, "name": None, "partyId": None, "partyName": None, "preferenceVotes": None})
    rng.shuffle(seats)
    for i, s in enumerate(seats, start=1):
        s["seatNumber"] = i

    # Scale down displayed vote totals/percentages proportionally to progress
    # too, so the party table looks consistent with "not fully counted yet".
    for p in party_results:
        p["votes"] = round(p["votes"] * progress)
    for s in seats:
        if s["preferenceVotes"] is not None:
            s["preferenceVotes"] = round(s["preferenceVotes"] * progress)

    result = {
        "municipality": candidates_data["municipality"],
        "election": "Volby do zastupitelstev obcí 2026",
        "isSample": True,
        "sampleNote": "Ukázková data pro vývoj a náhled stránky - nejde o skutečné výsledky voleb.",
        "generatedAt": None,  # filled in by the frontend with fetch time; left null here
        "totalSeats": total_seats,
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
    print(f"[{slug}] wrote {out_path}: {confirmed}/{total_seats} seats confirmed, "
          f"{precincts_counted}/{precincts_total} okrsků, {len(party_results)} stran")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    slugs = sys.argv[1:] or list(MUNICIPALITIES.keys())
    for slug in slugs:
        generate(slug)
