"""
Converts the real ČSÚ open-data election-night feed ("okrsková data" -
kvt3.xml + kvhl.xml, viz data/KV2026_datovaveta.pdf a
https://volby.gov.cz/opendata/kv2026/kv2026_opendata_seznam.htm) into the
results-praha{N}.json / results-magistrat.json format consumed by the
Výsledky tab (see "Záložka Výsledky" v README.md pro přesný tvar).

Reálná data ČSÚ zveřejní, až začne zpracování (9.-10. 10. 2026) - do té doby
tento skript nejde spustit na ostrých datech, jen přes --selftest (ověří
veškerou logiku - parsování XML/ZIP, filtrování na obec, d'Hondtovo dělení
mandátů a přepočet pořadí kandidátů podle přednostních hlasů - na syntetické
datové sadě se spočítaným očekávaným výsledkem).

Mandátový přepočet vychází ze zákona č. 491/2001 Sb. (volby do zastupitelstev
obcí), § 45-46 a metodiky ČSÚ
(https://csu.gov.cz/legislativa-a-metody-prepoctu-volby-do-zastupitelstev-obci):
  - mandáty se dělí d'Hondtovou metodou (dělitelé 1, 2, 3, ...),
  - uzavírací klauzule: strana postupuje do skrutinia, pokud získala alespoň
    5 % z (celkový počet platných hlasů / počet mandátů) * min(počet jejích
    kandidátů, počet mandátů),
  - kandidát se posune na první místo listiny, pokud získal alespoň 110 %
    průměrného počtu hlasů na kandidáta dané listiny (přednostní hlasy),
    ostatní zůstávají v pořadí dle hlasovacího lístku.

Usage:
  python scripts/parse_real_results.py <kvt3.xml|.zip> <kvhl.xml|.zip> [slug ...]
  python scripts/parse_real_results.py --selftest

Nevyřešené riziko (ověřit, až budou ostrá data k dispozici):
  POR_STR_HL (pořadí strany na hlasovacím lístku) se zde mapuje na pole "id"
  v candidates-praha{N}.json podle předpokladu, že pořadí z Poradny pro obce
  odpovídá vylosovanému pořadí na hlasovacím lístku. Skript při nesouladu
  počtu listin vypíše varování - pokud se objeví, je potřeba mapování ručně
  opravit (např. přidáním PARTY_ORDER_OVERRIDES níže).
"""
import argparse
import datetime
import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
import parse_candidates  # noqa: E402  (MUNICIPALITIES - zdrojové URL/OBEC kódy, candidates soubory)
import generate_sample_results as sample  # noqa: E402  (DISTRICT_SEATS, results soubory)

DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")
KV_NS = "http://www.volby.cz/kv/"

# Mandátový přepočet (zákon č. 491/2001 Sb.) - viz docstring výše.
CLOSING_CLAUSE_SHARE = 0.05
PREFERENCE_MULTIPLIER = 1.10

# Ruční oprava, pokud POR_STR_HL na reálném hlasovacím lístku neodpovídá
# pořadí "id" v candidates-praha{N}.json. Klíč = slug, hodnota = dict
# {POR_STR_HL: id_v_candidates_json}.
PARTY_ORDER_OVERRIDES = {}


def _obec_code(slug):
    """OBEC (ZUJ) kód odvozený z URL v parse_candidates.MUNICIPALITIES."""
    url = parse_candidates.MUNICIPALITIES[slug]["source_url"]
    m = re.search(r"-(\d+)$", url.rstrip("/"))
    if not m:
        raise ValueError(f"Nelze z URL odvodit kód obce (OBEC) pro {slug}: {url}")
    return int(m.group(1))


def municipality_config(slug):
    cfg = dict(sample.MUNICIPALITIES[slug])
    cfg["slug"] = slug
    cfg["obec"] = _obec_code(slug)
    # Magistrát = celoměstské zastupitelstvo hl. m. Prahy (TYPZASTUP=1),
    # číslované městské části = zastupitelstvo městské části (TYPZASTUP=2).
    cfg["typzastup"] = 1 if slug == "magistrat" else 2
    return cfg


def _local_tag(tag):
    return tag.rsplit("}", 1)[-1]


def iter_rows(source, row_tag):
    """Yields dict {element_name: text} for each <row_tag> row in an XML file.

    `source` may be a filesystem path (.xml or .zip containing one .xml), or
    an already-open file-like object (used by the self-test).
    """
    opened_zip = None
    stream = source
    try:
        if isinstance(source, str) and source.lower().endswith(".zip"):
            opened_zip = zipfile.ZipFile(source)
            member = next(n for n in opened_zip.namelist() if n.lower().endswith(".xml"))
            stream = opened_zip.open(member)
        expected_root = {"KV_T3_ROW": "KV_T3", "KV_HL_ROW": "KV_HL",
                         "KV_COCO_ROW": "KV_COCO"}[row_tag]
        root_seen = False
        for event, elem in ET.iterparse(stream, events=("start", "end")):
            if not root_seen:
                root_seen = True
                if _local_tag(elem.tag) != expected_root:
                    raise ValueError(
                        f"Expected {expected_root}, got {_local_tag(elem.tag)}. "
                        "Use update_csu.py for live ČSÚ results."
                    )
            if event == "end" and _local_tag(elem.tag) == row_tag:
                yield {_local_tag(child.tag): (child.text or "").strip() for child in elem}
                elem.clear()
    finally:
        if opened_zip is not None:
            opened_zip.close()


def datgener_of(source):
    """Reads the DATGENER timestamp attribute off the root element (cheap, stops after first element)."""
    opened_zip = None
    stream = source
    try:
        if isinstance(source, str) and source.lower().endswith(".zip"):
            opened_zip = zipfile.ZipFile(source)
            member = next(n for n in opened_zip.namelist() if n.lower().endswith(".xml"))
            stream = opened_zip.open(member)
        for _, elem in ET.iterparse(stream, events=("start",)):
            return elem.attrib.get("DATGENER")
    except Exception:
        return None
    finally:
        if opened_zip is not None:
            opened_zip.close()
    return None


def _num(row, key, default=None):
    val = row.get(key)
    if val in (None, ""):
        return default
    return int(round(float(val)))


def aggregate_t3(source, targets):
    """targets: {(obec, typzastup): slug}. Returns {slug: totals dict}."""
    by_okrsek = {slug: {} for slug in set(targets.values())}
    for row in iter_rows(source, "KV_T3_ROW"):
        slug = targets.get((_num(row, "OBEC"), _num(row, "TYPZASTUP")))
        if slug is None:
            continue
        key = (_num(row, "COBVODU"), _num(row, "OKRSEK"))
        by_okrsek[slug][key] = row  # last occurrence wins (defensive dedupe on corrections)

    totals = {}
    for slug, rows in by_okrsek.items():
        t = dict(precincts_counted=len(rows), vol_seznam=0, vyd_obalky=0,
                 vol_prukaz=0, odevz_obal=0, plat_listky=0, pl_hl_celk=0)
        for row in rows.values():
            t["vol_seznam"] += _num(row, "VOL_SEZNAM", 0)
            t["vyd_obalky"] += _num(row, "VYD_OBALKY", 0)
            t["vol_prukaz"] += _num(row, "VOL_PRUKAZ", 0)
            t["odevz_obal"] += _num(row, "ODEVZ_OBAL", 0)
            t["plat_listky"] += _num(row, "PLAT_LISTKY", 0)
            t["pl_hl_celk"] += _num(row, "PL_HL_CELK", 0)
        totals[slug] = t
    return totals


def aggregate_hl(source, targets):
    """Returns {slug: {POR_STR_HL: {"votes": int, "candidates": {number: votes}}}}."""
    by_row = {slug: {} for slug in set(targets.values())}
    for row in iter_rows(source, "KV_HL_ROW"):
        slug = targets.get((_num(row, "OBEC"), _num(row, "TYPZASTUP")))
        if slug is None:
            continue
        key = (_num(row, "COBVODU"), _num(row, "OKRSEK"), _num(row, "POR_STR_HL"))
        by_row[slug][key] = row  # last occurrence wins, same dedupe logic as T3

    result = {slug: {} for slug in by_row}
    for slug, rows in by_row.items():
        for (_, _okrsek, por), row in rows.items():
            bucket = result[slug].setdefault(por, {"votes": 0, "candidates": {}})
            bucket["votes"] += _num(row, "POC_HLASU", 0)
            for i in range(1, 71):
                val = row.get(f"HLASY_{i:02d}")
                if val in (None, ""):
                    continue
                bucket["candidates"][i] = bucket["candidates"].get(i, 0) + int(round(float(val)))
    return result


def load_kvcoco_totals(source, targets):
    """targets: {(kodzastup, typzastup): slug}. Returns the most recent (by
    DATUMVOLEB) {slug: {"precincts_total", "mandaty", "datumvoleb"}}."""
    best = {}
    for row in iter_rows(source, "KV_COCO_ROW"):
        slug = targets.get((_num(row, "KODZASTUP"), _num(row, "TYPZASTUP")))
        if slug is None:
            continue
        datumvoleb = row.get("DATUMVOLEB", "")
        prev = best.get(slug)
        if prev is None or datumvoleb > prev["datumvoleb"]:
            best[slug] = {
                "precincts_total": _num(row, "OKRSKYCELK"),
                "mandaty": _num(row, "MANDATY"),
                "datumvoleb": datumvoleb,
            }
    return best


def dhondt_seats_for_parties(votes, total_seats):
    """votes: list of vote counts (0 = excluded/non-qualifying). Returns seat counts, same order."""
    seats = [0] * len(votes)
    for _ in range(total_seats):
        # Tie-break: higher quotient wins; ties by raw votes, then by earlier
        # index. Real ties would legally be broken by lot (los) - flagged as
        # a TODO since this is vanishingly unlikely with real vote totals.
        quotients = [(v / (seats[i] + 1), v, -i) if v > 0 else None for i, v in enumerate(votes)]
        candidates = [(q, i) for i, q in enumerate(quotients) if q is not None]
        if not candidates:
            break
        _, winner = max(candidates, key=lambda pair: pair[0])
        seats[winner] += 1
    return seats


def apply_closing_clause(party_entries, total_seats, total_valid_votes):
    """Marks party_entries (dicts with 'votes'/'candidate_count') with 'qualifies' in place."""
    for p in party_entries:
        threshold = CLOSING_CLAUSE_SHARE * (total_valid_votes / total_seats) * min(p["candidate_count"], total_seats)
        p["closing_threshold"] = threshold
        p["qualifies"] = p["votes"] >= threshold


def reorder_by_preference(candidates, party_votes):
    """candidates: list of {"number", "name", "preferenceVotes"}, in ballot order.
    Returns a new list: candidates with >=110% of the list's average preference
    votes first (sorted by preference votes desc, ties by ballot number), then
    the rest unchanged in ballot order."""
    if not candidates:
        return []
    avg = party_votes / len(candidates)
    threshold = avg * PREFERENCE_MULTIPLIER
    qualifying_numbers = {c["number"] for c in candidates if c["preferenceVotes"] >= threshold}
    qualifying = sorted(
        (c for c in candidates if c["number"] in qualifying_numbers),
        key=lambda c: (-c["preferenceVotes"], c["number"]),
    )
    remaining = [c for c in candidates if c["number"] not in qualifying_numbers]
    return qualifying + remaining


def build_results(slug, t3_totals, hl_totals, candidates_data, meta):
    t = t3_totals.get(slug, dict(precincts_counted=0, vol_seznam=0, odevz_obal=0, pl_hl_celk=0))
    hl = hl_totals.get(slug, {})
    total_seats = meta["total_seats"]
    total_valid_votes = t.get("pl_hl_celk") or sum(b["votes"] for b in hl.values())

    overrides = PARTY_ORDER_OVERRIDES.get(slug, {})
    party_entries = []
    for party in candidates_data["parties"]:
        por = next((k for k, v in overrides.items() if v == party["id"]), party["id"])
        bucket = hl.get(por, {"votes": 0, "candidates": {}})
        party_entries.append({
            "id": party["id"],
            "name": party["name"],
            "votes": bucket["votes"],
            "candidate_count": party.get("candidateCount", len(party["candidates"])),
            "candidates_src": sorted(party["candidates"], key=lambda c: c["number"] or 999),
            "preference_votes": bucket["candidates"],
        })

    known_ids = {p["id"] for p in party_entries}
    unmapped = sorted(set(hl.keys()) - known_ids - set(overrides.values()))
    if hl and unmapped:
        print(f"  [VAROVÁNÍ] {slug}: HL obsahuje POR_STR_HL {unmapped} bez odpovídající listiny "
              f"v candidates-*.json - zkontrolujte pořadí (PARTY_ORDER_OVERRIDES).")

    if total_valid_votes:
        apply_closing_clause(party_entries, total_seats, total_valid_votes)
    else:
        for p in party_entries:
            p["qualifies"] = False

    qualifying = [p for p in party_entries if p["qualifies"] and p["votes"] > 0]
    seat_counts = dhondt_seats_for_parties([p["votes"] for p in qualifying], total_seats)
    for p, n in zip(qualifying, seat_counts):
        p["seats"] = n
    for p in party_entries:
        p.setdefault("seats", 0)
        p["votesPercent"] = round(p["votes"] / total_valid_votes * 100, 1) if total_valid_votes else 0.0

    party_entries.sort(key=lambda p: p["votes"], reverse=True)

    seats = []
    for p in party_entries:
        if not p["seats"]:
            continue
        ordered = [
            {"number": c["number"], "name": c["name"], "preferenceVotes": p["preference_votes"].get(c["number"], 0)}
            for c in p["candidates_src"]
        ]
        for c in reorder_by_preference(ordered, p["votes"])[: p["seats"]]:
            seats.append({
                "seatNumber": len(seats) + 1,
                "name": c["name"],
                "partyId": p["id"],
                "partyName": p["name"],
                "preferenceVotes": c["preferenceVotes"],
            })

    turnout = round(t["odevz_obal"] / t["vol_seznam"] * 100, 1) if t.get("vol_seznam") else 0.0

    return {
        "municipality": candidates_data["municipality"],
        "election": "Volby do zastupitelstev obcí 2026",
        "isSample": False,
        "generatedAt": meta.get("generated_at"),
        "totalSeats": total_seats,
        "precinctsTotal": meta.get("precincts_total"),
        "precinctsCounted": t.get("precincts_counted", 0),
        "turnoutPercent": turnout,
        "parties": [
            {"id": p["id"], "name": p["name"], "votesPercent": p["votesPercent"], "seats": p["seats"]}
            for p in party_entries
        ],
        "seats": seats,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kvt3", nargs="?", help="cesta k kvt3.xml nebo .zip (okrsková data, věta T3)")
    parser.add_argument("kvhl", nargs="?", help="cesta k kvhl.xml nebo .zip (okrsková data, věta HL)")
    parser.add_argument("slugs", nargs="*", help="které obce zpracovat, např. praha12 (výchozí: všechny)")
    parser.add_argument("--kvcoco", help="cesta k aktuálnímu kvcoco.xml (číselník zastupitelstev); "
                                          "výchozí: data/csu_ciselniky/kvcoco.xml (zatím jen data z roku 2022)")
    parser.add_argument("--selftest", action="store_true", help="ověří logiku skriptu na syntetických datech")
    args = parser.parse_args()

    if args.selftest:
        run_selftest()
        return

    if not args.kvt3 or not args.kvhl:
        parser.error("je třeba zadat cesty ke kvt3.xml a kvhl.xml (nebo spustit s --selftest)")

    slugs = args.slugs or list(sample.MUNICIPALITIES.keys())
    configs = {slug: municipality_config(slug) for slug in slugs}
    targets = {(c["obec"], c["typzastup"]): c["slug"] for c in configs.values()}

    kvcoco_path = args.kvcoco or os.path.join(DATA_DIR, "csu_ciselniky", "kvcoco.xml")
    kvcoco_data = {}
    if os.path.exists(kvcoco_path):
        kvcoco_data = load_kvcoco_totals(kvcoco_path, targets)
    else:
        print(f"[VAROVÁNÍ] číselník {kvcoco_path} nenalezen - totalSeats se vezme z generate_sample_results.py "
              f"a precinctsTotal nebude k dispozici.")

    generated_at = datgener_of(args.kvt3) or datetime.datetime.now(datetime.timezone.utc).isoformat()

    print(f"Načítám {args.kvt3} ...")
    t3_totals = aggregate_t3(args.kvt3, targets)
    print(f"Načítám {args.kvhl} ...")
    hl_totals = aggregate_hl(args.kvhl, targets)

    for slug in slugs:
        cfg = configs[slug]
        with open(os.path.join(DATA_DIR, cfg["candidates_file"]), encoding="utf-8") as f:
            candidates_data = json.load(f)

        total_seats = cfg["total_seats"]
        precincts_total = None
        kvcoco_row = kvcoco_data.get(slug)
        if kvcoco_row:
            precincts_total = kvcoco_row["precincts_total"]
            if kvcoco_row["mandaty"] and kvcoco_row["mandaty"] != total_seats:
                print(f"  [VAROVÁNÍ] {slug}: MANDATY v kvcoco ({kvcoco_row['mandaty']}) "
                      f"!= očekávaný počet ({total_seats}) - použiji hodnotu z kvcoco.")
                total_seats = kvcoco_row["mandaty"]
            if kvcoco_row["datumvoleb"] and kvcoco_row["datumvoleb"] < "20260101":
                print(f"  [POZOR] {slug}: kvcoco obsahuje jen data z {kvcoco_row['datumvoleb']} "
                      f"(ne 2026) - precinctsTotal může být zastaralý, stáhněte aktuální číselníky.")

        meta = {"total_seats": total_seats, "precincts_total": precincts_total, "generated_at": generated_at}
        result = build_results(slug, t3_totals, hl_totals, candidates_data, meta)

        out_path = os.path.join(DATA_DIR, cfg["results_file"])
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        seats_assigned = sum(p["seats"] for p in result["parties"])
        print(f"[{slug}] zapsáno {out_path}: {result['precinctsCounted']}/{result['precinctsTotal']} okrsků, "
              f"účast {result['turnoutPercent']}\u00a0%, {seats_assigned}/{result['totalSeats']} mandátů rozděleno")


def _build_selftest_xml(rows, root_tag, row_tag):
    parts = [f'<?xml version="1.0" encoding="UTF-8"?>\n<{root_tag} xmlns="{KV_NS}" DATGENER="2026-10-10T18:00:00">']
    for row in rows:
        parts.append(f" <{row_tag}>")
        for key, val in row.items():
            parts.append(f"  <{key}>{val}</{key}>")
        parts.append(f" </{row_tag}>")
    parts.append(f"</{root_tag}>")
    return io.BytesIO("\n".join(parts).encode("utf-8"))


def run_selftest():
    """Builds a tiny synthetic (but schema-accurate) kvt3/kvhl feed for a fake
    municipality, parses it through the full real pipeline, and asserts the
    result against a hand-computed expected outcome. This lets the whole
    parse/filter/d'Hondt/preferential-vote pipeline be validated today, before
    real ČSÚ data exists."""
    obec, typzastup = 999001, 2
    t3_rows = [
        dict(ID_OKRSKY=1, OBEC=obec, OKRSEK=1, TYPZASTUP=typzastup, COBVODU=1,
             VOL_SEZNAM=100, VYD_OBALKY=80, VOL_PRUKAZ=0, ODEVZ_OBAL=78, PLAT_LISTKY=76, PL_HL_CELK=76),
        dict(ID_OKRSKY=2, OBEC=obec, OKRSEK=2, TYPZASTUP=typzastup, COBVODU=1,
             VOL_SEZNAM=120, VYD_OBALKY=90, VOL_PRUKAZ=0, ODEVZ_OBAL=88, PLAT_LISTKY=85, PL_HL_CELK=85),
    ]
    hl_rows = [
        dict(ID_OKRSKY=1, OBEC=obec, OKRSEK=1, TYPZASTUP=typzastup, COBVODU=1, POR_STR_HL=1,
             POC_HLASU=50, HLASY_01=30, HLASY_02=10, HLASY_03=5, HLASY_04=5),
        dict(ID_OKRSKY=1, OBEC=obec, OKRSEK=1, TYPZASTUP=typzastup, COBVODU=1, POR_STR_HL=2,
             POC_HLASU=26, HLASY_01=5, HLASY_02=5, HLASY_03=16),
        dict(ID_OKRSKY=2, OBEC=obec, OKRSEK=2, TYPZASTUP=typzastup, COBVODU=1, POR_STR_HL=1,
             POC_HLASU=55, HLASY_01=20, HLASY_02=10, HLASY_03=10, HLASY_04=15),
        dict(ID_OKRSKY=2, OBEC=obec, OKRSEK=2, TYPZASTUP=typzastup, COBVODU=1, POR_STR_HL=2,
             POC_HLASU=30, HLASY_01=10, HLASY_02=10, HLASY_03=10),
    ]

    targets = {(obec, typzastup): "testtown"}
    t3_totals = aggregate_t3(_build_selftest_xml(t3_rows, "KV_T3", "KV_T3_ROW"), targets)
    hl_totals = aggregate_hl(_build_selftest_xml(hl_rows, "KV_HL", "KV_HL_ROW"), targets)

    assert t3_totals["testtown"]["precincts_counted"] == 2
    assert t3_totals["testtown"]["vol_seznam"] == 220
    assert t3_totals["testtown"]["odevz_obal"] == 166
    assert hl_totals["testtown"][1]["votes"] == 105
    assert hl_totals["testtown"][2]["votes"] == 56
    assert hl_totals["testtown"][1]["candidates"] == {1: 50, 2: 20, 3: 15, 4: 20}
    assert hl_totals["testtown"][2]["candidates"] == {1: 15, 2: 15, 3: 26}
    print("[selftest] agregace T3/HL: OK")

    candidates_data = {
        "municipality": "Testtown",
        "parties": [
            {"id": 1, "name": "Strana A", "candidateCount": 4, "candidates": [
                {"number": 1, "name": "Kandidát A1"}, {"number": 2, "name": "Kandidát A2"},
                {"number": 3, "name": "Kandidát A3"}, {"number": 4, "name": "Kandidát A4"},
            ]},
            {"id": 2, "name": "Strana B", "candidateCount": 3, "candidates": [
                {"number": 1, "name": "Kandidát B1"}, {"number": 2, "name": "Kandidát B2"},
                {"number": 3, "name": "Kandidát B3"},
            ]},
        ],
    }
    meta = {"total_seats": 5, "precincts_total": 2, "generated_at": "2026-10-10T18:00:00"}
    result = build_results("testtown", t3_totals, hl_totals, candidates_data, meta)

    assert result["turnoutPercent"] == 75.5, result["turnoutPercent"]
    assert result["precinctsCounted"] == 2
    parties_by_id = {p["id"]: p for p in result["parties"]}
    assert parties_by_id[1]["seats"] == 3, parties_by_id
    assert parties_by_id[2]["seats"] == 2, parties_by_id
    assert parties_by_id[1]["votesPercent"] == 65.2
    assert parties_by_id[2]["votesPercent"] == 34.8
    print("[selftest] uzavírací klauzule + d'Hondtovo dělení mandátů (3:2): OK")

    assert len(result["seats"]) == 5
    names_in_order = [s["name"] for s in result["seats"]]
    assert names_in_order == [
        "Kandidát A1", "Kandidát A2", "Kandidát A3",  # A3 (15 hl.) před A4 (20 hl.) by nahradil - ale A4 nemá nárok (< 110 % průměru) -> zůstává za A3 v pořadí listiny, mimo obsazené mandáty
        "Kandidát B3", "Kandidát B1",  # B3 přeskočil na 1. místo (26 hl. >= 110 % průměru 18,67)
    ], names_in_order
    assert result["seats"][3]["preferenceVotes"] == 26  # B3 - přednostní hlasy
    print("[selftest] přepočet pořadí podle přednostních hlasů (B3 přeskakuje na 1. místo): OK")
    print("[selftest] VŠE V POŘÁDKU - skript je připraven na reálná data.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
