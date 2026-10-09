"""
Parses the official ČSÚ candidate lists (zprostředkované přes poradnaproobce.cz)
for Prague city districts, municipal elections 2026, from a saved HTML page
into structured JSON.

Usage:
  python scripts/parse_candidates.py [slug ...]   # defaults to all municipalities
"""
import json
import os
import re
import sys
import tempfile

from bs4 import BeautifulSoup

def _municipality(number, slug_with_id):
    return {
        "name": f"Praha {number}",
        "html_file": f"praha{number}_candidates.html",
        "source_url": f"https://www.poradnaproobce.cz/komunalni-volby-2026/kandidatni-listiny/{slug_with_id}",
        "out_file": f"candidates-praha{number}.json",
    }


# All 22 numbered Prague city districts (Praha 1-22). The trailing number in
# each slug is the ČSÚ "ZUJ" code for that district on poradnaproobce.cz.
MUNICIPALITIES = {
    "praha1": _municipality(1, "praha-1-500054"),
    "praha2": _municipality(2, "praha-2-500089"),
    "praha3": _municipality(3, "praha-3-500097"),
    "praha4": _municipality(4, "praha-4-500119"),
    "praha5": _municipality(5, "praha-5-500143"),
    "praha6": _municipality(6, "praha-6-500178"),
    "praha7": _municipality(7, "praha-7-500186"),
    "praha8": _municipality(8, "praha-8-500208"),
    "praha9": _municipality(9, "praha-9-500216"),
    "praha10": _municipality(10, "praha-10-500224"),
    "praha11": _municipality(11, "praha-11-547034"),
    "praha12": _municipality(12, "praha-12-547107"),
    "praha13": _municipality(13, "praha-13-539694"),
    "praha14": _municipality(14, "praha-14-547361"),
    "praha15": _municipality(15, "praha-15-547387"),
    "praha16": _municipality(16, "praha-16-539601"),
    "praha17": _municipality(17, "praha-17-547174"),
    "praha18": _municipality(18, "praha-18-547417"),
    "praha19": _municipality(19, "praha-19-547344"),
    "praha20": _municipality(20, "praha-20-538213"),
    "praha21": _municipality(21, "praha-21-538949"),
    "praha22": _municipality(22, "praha-22-538931"),
}

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# Academic/professional titles that can precede or follow a candidate's name
# on Czech ballots. Stripped out to isolate the given/first name for gender
# detection.
TITLE_TOKENS = {
    "Bc.", "BcA.", "Ing.", "arch.", "JUDr.", "MUDr.", "MVDr.", "PaedDr.",
    "PhDr.", "RNDr.", "Mgr.", "prof.", "doc.", "Dipl.", "DiS.", "DrSc.",
    "CSc.", "Ph.D.", "MBA", "MPA", "MPH", "LLM", "LL.M.", "ThDr.",
    "ThLic.", "PharmDr.", "et",
}

# Manual overrides for first names where the "ends with -a => female" Czech
# heuristic would misclassify (foreign names, or well-known exceptions).
GENDER_OVERRIDES = {
    "attila": "M",
    "lingli": "F",
    "petri": "F",
    "ingrid": "F",
    "karin": "F",
}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def guess_gender(first_name, last_name):
    # Strongest signal: Czech feminine surnames almost always end in "á"
    # (e.g. "-ová", "-ská", "-cká", or plain adjectival "-á"). Male surnames
    # never end this way, so this overrides the first-name heuristic below.
    if last_name and last_name.rstrip(".,").endswith("á"):
        return "F"
    if not first_name:
        return None
    key = first_name.lower()
    if key in GENDER_OVERRIDES:
        return GENDER_OVERRIDES[key]
    return "F" if key.endswith("a") else "M"


def name_tokens_without_titles(full_name):
    tokens = full_name.split(" ")
    return [t for t in tokens if t.rstrip(",") not in TITLE_TOKENS]


def first_name_of(full_name):
    kept = name_tokens_without_titles(full_name)
    return kept[0] if kept else None


def last_name_of(full_name):
    kept = name_tokens_without_titles(full_name)
    return kept[-1] if kept else None


def parse(src_path):
    with open(src_path, encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    sections = soup.select("section.cmp_election_openable_section")
    parties = []

    for idx, section in enumerate(sections, start=1):
        header = section.select_one(".cmp_election_openable_section_header__title")
        subtitle = section.select_one(".cmp_election_openable_section_header__subtitle")
        if not header:
            continue
        party_name = clean(header.get_text())
        count_match = re.search(r"(\d+)", subtitle.get_text() if subtitle else "")
        candidate_count = int(count_match.group(1)) if count_match else None

        candidates = []
        # Real data rows (not the "label" duplicate rows used for mobile view)
        rows = section.select("tr.cmpt_election_table_responsive__ln")
        for row in rows:
            number_cell = row.select_one(".pg_election_candidate_lists_table__ln_cell_label--number")
            name_cell = row.select_one("th.cmpt_election_table_responsive__ln_cell_label.w-100")
            profession_cell = row.select_one('td[data-label="Povolání"]')
            if not name_cell:
                continue

            number = clean(number_cell.get_text()) if number_cell else None
            full_text = clean(name_cell.get_text())
            age_match = re.search(r"\((\d+)\s*let\)", full_text)
            age = int(age_match.group(1)) if age_match else None
            name = clean(name_cell.find("strong").get_text()) if name_cell.find("strong") else re.sub(r"\s*\(\d+\s*let\)", "", full_text)
            profession = clean(profession_cell.get_text()) if profession_cell else None
            gender = guess_gender(first_name_of(name), last_name_of(name))

            candidates.append(
                {
                    "number": int(number) if number and number.isdigit() else None,
                    "name": name,
                    "age": age,
                    "gender": gender,
                    "profession": profession,
                }
            )

        parties.append(
            {
                "id": idx,
                "name": party_name,
                "candidateCount": candidate_count,
                "candidates": candidates,
            }
        )

    return parties


def run_for(slug):
    config = MUNICIPALITIES[slug]
    src_path = os.path.join(tempfile.gettempdir(), config["html_file"])
    out_path = os.path.join(DATA_DIR, config["out_file"])

    parties = parse(src_path)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "municipality": config["name"],
                "election": "Volby do zastupitelstev obcí 2026",
                "source": config["source_url"],
                "sourceNote": "Data ČSÚ, zprostředkovaná přes Poradna pro obce",
                "parties": parties,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    total = sum(len(p["candidates"]) for p in parties)
    print(f"[{config['name']}] parties: {len(parties)}, total candidates parsed: {total}")
    for p in parties:
        print(f"  - {p['name']}: {len(p['candidates'])} (expected {p['candidateCount']})")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    slugs = sys.argv[1:] or list(MUNICIPALITIES.keys())
    for slug in slugs:
        if slug not in MUNICIPALITIES:
            print(f"Unknown municipality slug: {slug} (known: {', '.join(MUNICIPALITIES)})")
            continue
        run_for(slug)
