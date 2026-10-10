"""Update candidates and results from official ČSÚ XML, without estimating mandates."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead, RemoteDisconnected
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from xml.etree import ElementTree as ET
import zipfile

from parse_candidates import MUNICIPALITIES, clean, guess_gender

NS = {"kv": "http://www.volby.cz/kv/"}
BASE = "https://volby.gov.cz"
REGISTRY_URL = f"{BASE}/opendata/kv2026/xml/kvrk.zip"
RESULTS_URL = (
    f"{BASE}/appdata/kv2026/20261009/odata/okresy/"
    "vysledky_obce_okres_CZ0100.xml"
)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PRECINCTS_URL = f"{BASE}/appdata/kv2026/20261009/odata/okrsky/vysledky_okrsky"


def download(url: str) -> bytes:
    attempts = 4
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(url, timeout=60) as response:
                return response.read()
        except (HTTPError, URLError, RemoteDisconnected, IncompleteRead,
                TimeoutError, ConnectionError) as error:
            if isinstance(error, HTTPError):
                error.close()
                if error.code not in (408, 429, 500, 502, 503, 504):
                    raise
            if attempt == attempts:
                raise
            delay = 2 ** attempt
            print(f"ČSÚ download failed ({attempt}/{attempts}) for {url}: {error}; "
                  f"retrying in {delay}s.", file=sys.stderr, flush=True)
            time.sleep(delay)
    raise AssertionError("Unreachable download retry state")


def code_for(slug: str) -> int:
    return int(MUNICIPALITIES[slug]["source_url"].rstrip("/").rsplit("-", 1)[1])


def parse_xml(data: bytes, expected_root: str | tuple[str, ...]) -> ET.Element:
    root = ET.fromstring(data)
    expected_roots = (expected_root,) if isinstance(expected_root, str) else expected_root
    expected_tags = {f"{{{NS['kv']}}}{name}" for name in expected_roots}
    if root.tag not in expected_tags:
        raise ValueError(
            f"Unexpected XML root: {root.tag}; expected {' or '.join(expected_roots)}"
        )
    error = root.find("kv:CHYBA", NS)
    if error is not None:
        raise ValueError(f"ČSÚ XML error: {error.attrib}")
    return root


def integer(value: str) -> int:
    result = int(value)
    if result < 0:
        raise ValueError(f"Negative value in ČSÚ data: {value}")
    return result


def full_name(values: dict[str, str]) -> str:
    return clean(" ".join(values.get(key, "") for key in (
        "TITULPRED", "JMENO", "PRIJMENI", "TITULZA",
    )))


def registry_rows(data: bytes, codes: set[int]) -> dict[int, list[dict[str, str]]]:
    selected: dict[int, list[dict[str, str]]] = {code: [] for code in codes}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        with archive.open("kvrk.xml") as stream:
            root = None
            for event, element in ET.iterparse(stream, events=("start", "end")):
                if root is None:
                    root = element
                if event == "end" and element.tag == f"{{{NS['kv']}}}KV_REGKAND_ROW":
                    row = {child.tag.rsplit("}", 1)[-1]: child.text or "" for child in element}
                    code = integer(row["KODZASTUP"])
                    if code in selected:
                        selected[code].append(row)
                    root.clear()
    for code, rows in selected.items():
        if not rows:
            raise ValueError(f"Missing candidate registry for {code}")
    return selected


def convert(slug: str, data: bytes, rows: list[dict[str, str]]) -> tuple[dict, dict]:
    root = parse_xml(data, ("VYSLEDKY_OBEC", "VYSLEDKY_OBCE_OKRES"))
    if root.tag == f"{{{NS['kv']}}}VYSLEDKY_OBEC":
        municipality = root.find("kv:OBEC", NS)
    else:
        municipality = root.find(f"kv:OBEC[@KODZASTUP='{code_for(slug)}']", NS)
    if municipality is None or integer(municipality.attrib["KODZASTUP"]) != code_for(slug):
        raise ValueError(f"Missing or incorrect municipality for {slug}")
    if municipality.attrib["POCET_OBVODU"] != "1":
        raise ValueError(f"Multiple electoral districts are not supported: {slug}")
    expected_type = "OBEC" if slug == "magistrat" else "MCMO"
    if municipality.attrib["OZNAC_TYPU"] != expected_type:
        raise ValueError(f"Incorrect council type for {slug}")
    complete = municipality.attrib["JE_SPOCTENO"]
    if complete not in ("0", "1"):
        raise ValueError(f"Invalid JE_SPOCTENO: {complete}")
    complete = complete == "1"
    total_seats = integer(municipality.attrib["VOLENO_ZASTUP"])
    turnout = municipality.find("kv:VYSLEDEK/kv:UCAST", NS)
    if turnout is None:
        raise ValueError(f"Missing turnout for {slug}")
    counted = integer(turnout.attrib["OKRSKY_ZPRAC"])
    total = integer(turnout.attrib["OKRSKY_CELKEM"])
    if total == 0 or counted > total or complete != (counted == total):
        raise ValueError(f"Inconsistent processing status for {slug}")

    by_party: dict[int, list[dict[str, str]]] = {}
    for row in rows:
        if integer(row["COBVODU"]) != 1:
            raise ValueError(f"Unexpected candidate electoral district for {slug}")
        if row["PLATNOST"] not in ("A", "N"):
            raise ValueError(f"Unknown candidate validity: {row['PLATNOST']}")
        if row["PLATNOST"] == "A":
            by_party.setdefault(integer(row["POR_STR_HL"]), []).append(row)

    parties = []
    candidate_parties = []
    seats = []
    seen = set()
    for party in municipality.findall("kv:VYSLEDEK/kv:VOLEBNI_STRANA", NS):
        values = party.attrib
        number = integer(values["POR_STR_HLAS_LIST"])
        if number in seen:
            raise ValueError(f"Duplicate party {number} for {slug}")
        seen.add(number)
        active = sorted(by_party.get(number, []), key=lambda row: integer(row["PORCISLO"]))
        if len(active) != integer(values["KANDIDATU_POCET"]):
            raise ValueError(f"Candidate count mismatch for {slug}, party {number}; refresh registry")
        if len({row["PORCISLO"] for row in active}) != len(active):
            raise ValueError(f"Duplicate candidate numbers for {slug}, party {number}")
        candidate_parties.append({
            "id": number,
            "name": values["NAZEV_STRANY"],
            "candidateCount": len(active),
            "candidates": [{
                "number": integer(row["PORCISLO"]),
                "name": full_name(row),
                "age": integer(row["VEK"]),
                "gender": guess_gender(row["JMENO"].split()[0], row["PRIJMENI"]),
                "profession": row["POVOLANI"],
            } for row in active],
        })
        elected = party.findall("kv:ZASTUPITEL", NS)
        seat_count = integer(values["ZASTUPITELE_POCET"])
        if len(elected) != seat_count or (not complete and seat_count):
            raise ValueError(f"Inconsistent official mandates for {slug}, party {number}")
        if len({winner.attrib["PORADOVE_CISLO"] for winner in elected}) != len(elected):
            raise ValueError(f"Duplicate elected candidates for {slug}, party {number}")
        parties.append({
            "id": number, "name": values["NAZEV_STRANY"],
            "votes": integer(values["HLASY"]),
            "votesPercent": float(values["HLASY_PROC"]),
            "seats": seat_count if complete else None,
        })
        for winner in elected:
            ballot_number = integer(winner.attrib["PORADOVE_CISLO"])
            if ballot_number not in {integer(row["PORCISLO"]) for row in active}:
                raise ValueError(f"Elected candidate is not active: {slug}, {number}/{ballot_number}")
            seats.append({
                "seatNumber": len(seats) + 1,
                "name": full_name(winner.attrib),
                "partyId": number, "partyName": values["NAZEV_STRANY"],
                "preferenceVotes": integer(winner.attrib["HLASY"]),
            })
    if set(by_party) - seen:
        raise ValueError(f"Registry contains unknown parties for {slug}")
    if not parties or (complete and len(seats) != total_seats):
        raise ValueError(f"Incomplete official results for {slug}")
    if sum(party["votes"] for party in parties) != integer(turnout.attrib["PLATNE_HLASY"]):
        raise ValueError(f"Party vote totals do not match turnout totals for {slug}")
    for seat_number in range(len(seats) + 1, total_seats + 1):
        seats.append({
            "seatNumber": seat_number, "name": None, "partyId": None,
            "partyName": None, "preferenceVotes": None,
        })
    metadata = {
        "municipality": MUNICIPALITIES[slug]["name"],
        "election": "Volby do zastupitelstev obcí 2026",
        "source": RESULTS_URL,
    }
    candidates = {
        **metadata, "source": REGISTRY_URL,
        "sourceNote": "Oficiální registr ČSÚ; pouze platní kandidáti",
        "parties": sorted(candidate_parties, key=lambda party: party["id"]),
    }
    results = {
        **metadata, "isSample": False, "isComplete": complete,
        "generatedAt": root.attrib["DATUM_CAS_GENEROVANI"],
        "totalSeats": total_seats, "precinctsTotal": total,
        "precinctsCounted": counted,
        "turnoutPercent": float(turnout.attrib["UCAST_PROC"]) if counted else None,
        "parties": sorted(parties, key=lambda party: (-party["votes"], party["id"])),
        "seats": seats,
    }
    return candidates, results


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def precinct_batch(data: bytes) -> ET.Element:
    root = parse_xml(data, "VYSLEDKY_OKRSKY")
    batch = root.find("kv:DAVKA", NS)
    if batch is None or batch.attrib["DATUMVOLEB"] != "20261009":
        raise ValueError("Missing or incorrect precinct batch election")
    integer(batch.attrib["PORADI_DAVKY"])
    return root


def merge_precinct_batch(root: ET.Element, precincts: dict[int, dict]) -> None:
    for element in root.findall("kv:OKRSEK", NS):
        values = element.attrib
        if values["KODZASTUP"] != str(code_for("praha12")):
            continue
        if values["OZNAC_TYPU"] != "MCMO" or values["CIS_OBVODU"] != "1":
            raise ValueError("Incorrect Prague 12 precinct council type")
        number = integer(values["CIS_OKRSEK"])
        if number not in precincts:
            raise ValueError(f"Unknown Prague 12 precinct: {number}")
        order = integer(values["PORADI_ZPRAC"])
        previous = precincts[number]
        if previous["counted"] and previous["processingOrder"] >= order:
            continue
        turnout = element.find("kv:UCAST_OKRSEK", NS)
        if turnout is None:
            raise ValueError(f"Missing turnout for precinct {number}")
        registered = integer(turnout.attrib["ZAPSANI_VOLICI"])
        issued = integer(turnout.attrib["VYDANE_OBALKY"])
        total_votes = integer(turnout.attrib["PLATNE_HLASY"])
        votes = {}
        for party in element.findall("kv:HLASY_OKRSEK", NS):
            party_id = str(integer(party.attrib["POR_STR_HLAS_LIST"]))
            if party_id in votes:
                raise ValueError(f"Duplicate party in precinct {number}")
            votes[party_id] = integer(party.attrib["HLASY"])
        if sum(votes.values()) != total_votes or issued > registered:
            raise ValueError(f"Inconsistent votes or turnout for precinct {number}")
        precincts[number] = {
            "number": number, "counted": True, "processingOrder": order,
            "processedAt": values["DATUM_CAS_ZPRAC"],
            "registeredVoters": registered, "issuedEnvelopes": issued,
            "totalVotes": total_votes, "votes": votes,
        }


def load_precinct_results(path: Path) -> dict:
    with (DATA_DIR / "polling-stations-praha12.json").open(encoding="utf-8") as stream:
        catalog = json.load(stream)
    numbers = [number for station in catalog["stations"] for number in station["precincts"]]
    if len(numbers) != 50 or set(numbers) != set(range(12001, 12051)):
        raise ValueError("Polling stations must cover each Prague 12 precinct exactly once")
    precincts = {number: {"number": number, "counted": False} for number in numbers}
    last_batch = 0
    if path.exists():
        with path.open(encoding="utf-8") as stream:
            previous = json.load(stream)
        if previous["municipality"] != "Praha 12" or previous["electionDate"] != "20261009":
            raise ValueError("Incorrect previous precinct results election")
        last_batch = integer(str(previous["lastBatch"]))
        if (len(previous["precincts"]) != len(numbers)
                or {item["number"] for item in previous["precincts"]} != set(numbers)):
            raise ValueError("Incorrect previous precinct coverage")
        for item in previous["precincts"]:
            if not isinstance(item["counted"], bool):
                raise ValueError("Invalid previous precinct processing status")
            if item["counted"]:
                for key in ("processingOrder", "registeredVoters", "issuedEnvelopes", "totalVotes"):
                    if not isinstance(item[key], int) or isinstance(item[key], bool) or item[key] < 0:
                        raise ValueError(f"Invalid previous precinct {key}")
                votes = item["votes"]
                if (not isinstance(votes, dict)
                        or any(not isinstance(vote, int) or isinstance(vote, bool) or vote < 0
                               for vote in votes.values())
                        or sum(votes.values()) != item["totalVotes"]
                        or item["issuedEnvelopes"] > item["registeredVoters"]):
                    raise ValueError("Invalid previous precinct votes or turnout")
        precincts.update({item["number"]: item for item in previous["precincts"]})
    latest = precinct_batch(download(f"{PRECINCTS_URL}.xml"))
    batch = latest.find("kv:DAVKA", NS)
    assert batch is not None
    latest_number = integer(batch.attrib["PORADI_DAVKY"])
    if latest_number < last_batch:
        raise ValueError(f"Precinct batch regressed: {last_batch} -> {latest_number}")

    def fetch_batch(number: int) -> ET.Element:
        root = precinct_batch(download(f"{PRECINCTS_URL}_{number:05d}.xml"))
        metadata = root.find("kv:DAVKA", NS)
        assert metadata is not None
        if integer(metadata.attrib["PORADI_DAVKY"]) != number:
            raise ValueError(f"Incorrect precinct batch number: {number}")
        return root

    # Only the initial import needs the historical batches; subsequent runs resume.
    with ThreadPoolExecutor(max_workers=4) as executor:
        for root in executor.map(fetch_batch, range(last_batch + 1, latest_number)):
            merge_precinct_batch(root, precincts)
    merge_precinct_batch(latest, precincts)
    return {
        **catalog, "electionDate": "20261009", "source": f"{PRECINCTS_URL}.xml",
        "generatedAt": latest.attrib["DATUM_CAS_GENEROVANI"],
        "lastBatch": latest_number,
        "precincts": sorted(precincts.values(), key=lambda item: item["number"]),
    }


def preserve_results_if_precinct_count_regresses(results: dict, path: Path) -> dict:
    if not path.exists():
        return results

    with path.open(encoding="utf-8") as stream:
        previous = json.load(stream)
    if not isinstance(previous, dict):
        raise ValueError(f"Invalid previous results in {path}: expected a JSON object")
    if previous.get("municipality") != results["municipality"] or previous.get("isSample"):
        return results

    previous_count = previous.get("precinctsCounted")
    if not isinstance(previous_count, int) or isinstance(previous_count, bool):
        raise ValueError(f"Invalid previous precinct count in {path}")
    if results["precinctsCounted"] < previous_count:
        print(
            f"ČSÚ precinct count regressed for {results['municipality']} "
            f"({previous_count} -> {results['precinctsCounted']}); keeping previous results.",
            file=sys.stderr, flush=True,
        )
        return previous
    return results


def update(slugs: list[str], output: Path) -> None:
    rows = registry_rows(download(REGISTRY_URL), {code_for(slug) for slug in slugs})
    results_data = download(RESULTS_URL)
    converted = []
    for slug in slugs:
        candidates, results = convert(slug, results_data, rows[code_for(slug)])
        results = preserve_results_if_precinct_count_regresses(
            results, output / f"results-{slug}.json",
        )
        converted.append((slug, candidates, results))
    precinct_results = (
        load_precinct_results(output / "precincts-praha12.json") if "praha12" in slugs else None
    )
    if precinct_results is not None:
        result = next(results for slug, _, results in converted if slug == "praha12")
        party_ids = {str(party["id"]) for party in result["parties"]}
        if result["precinctsTotal"] != len(precinct_results["precincts"]):
            raise ValueError("Prague 12 polling station count does not match CSU")
        if any(set(precinct.get("votes", {})) - party_ids for precinct in precinct_results["precincts"]):
            raise ValueError("Unknown party in Prague 12 precinct results")
    # Validate every downloaded municipality before publishing any of the batch.
    for slug, candidates, results in converted:
        write_json(output / f"candidates-{slug}.json", candidates)
        write_json(output / f"results-{slug}.json", results)
        count = sum(party["candidateCount"] for party in candidates["parties"])
        print(f"[{slug}] {count} valid candidates; "
              f"{results['precinctsCounted']}/{results['precinctsTotal']} precincts", flush=True)
    if precinct_results is not None:
        write_json(output / "precincts-praha12.json", precinct_results)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slugs", nargs="*", help="Default: Praha 1–22 and magistrát")
    parser.add_argument("--output-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--watch", action="store_true", help="Repeat every 60 seconds; stop with Ctrl+C")
    args = parser.parse_args()
    slugs = args.slugs or list(MUNICIPALITIES)
    for slug in slugs:
        if slug not in MUNICIPALITIES:
            parser.error(f"Unknown municipality: {slug}")
    try:
        while True:
            update(slugs, args.output_dir)
            if not args.watch:
                break
            time.sleep(60)
    except KeyboardInterrupt:
        print("Updating stopped.", file=sys.stderr)
    except (OSError, IncompleteRead, ValueError, KeyError, ET.ParseError, zipfile.BadZipFile) as error:
        parser.exit(1, f"ČSÚ update failed (previous results retained): {error}\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
