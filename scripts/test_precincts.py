import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import update_csu as csu


def batch(number=1, order=1, votes=100, precinct=12001, council=547107, council_type="MCMO"):
    return f"""
    <VYSLEDKY_OKRSKY xmlns="{csu.NS['kv']}" DATUM_CAS_GENEROVANI="2026-10-10T19:30:00">
      <DAVKA DATUMVOLEB="20261009" PORADI_DAVKY="{number}"/>
      <OKRSEK KODZASTUP="{council}" OZNAC_TYPU="{council_type}" CIS_OBVODU="1"
        CIS_OKRSEK="{precinct}" PORADI_ZPRAC="{order}" DATUM_CAS_ZPRAC="2026-10-10T19:29:00">
        <UCAST_OKRSEK ZAPSANI_VOLICI="200" VYDANE_OBALKY="100" PLATNE_HLASY="{votes}"/>
        <HLASY_OKRSEK POR_STR_HLAS_LIST="4" HLASY="{votes}"/>
      </OKRSEK>
    </VYSLEDKY_OKRSKY>
    """.encode()


class PrecinctTests(unittest.TestCase):
    def test_catalog_covers_all_50_precincts_once(self):
        catalog = json.loads((csu.DATA_DIR / "polling-stations-praha12.json").read_text(encoding="utf-8"))
        numbers = [number for station in catalog["stations"] for number in station["precincts"]]
        self.assertEqual(len(catalog["stations"]), 15)
        self.assertEqual(sorted(numbers), list(range(12001, 12051)))
        self.assertEqual(len({station["id"] for station in catalog["stations"]}), 15)
        single = [station["precincts"][0] for station in catalog["stations"] if len(station["precincts"]) == 1]
        self.assertEqual(sorted(single), [12002, 12006, 12007, 12008, 12015, 12016])

    def test_real_counts_and_newer_corrections_replace_not_add(self):
        precincts = {12001: {"number": 12001, "counted": False}}
        csu.merge_precinct_batch(csu.precinct_batch(batch()), precincts)
        self.assertTrue(precincts[12001]["counted"])
        self.assertEqual(precincts[12001]["registeredVoters"], 200)
        self.assertEqual(precincts[12001]["votes"], {"4": 100})
        csu.merge_precinct_batch(csu.precinct_batch(batch(order=2, votes=150)), precincts)
        csu.merge_precinct_batch(csu.precinct_batch(batch(order=1, votes=80)), precincts)
        self.assertEqual(precincts[12001]["votes"], {"4": 150})
        self.assertEqual(precincts[12001]["processingOrder"], 2)

    def test_zero_votes_are_still_counted(self):
        precincts = {12001: {"number": 12001, "counted": False}}
        csu.merge_precinct_batch(csu.precinct_batch(batch(votes=0)), precincts)
        self.assertTrue(precincts[12001]["counted"])

    def test_other_councils_are_not_mixed_with_praha12(self):
        precincts = {12001: {"number": 12001, "counted": False}}
        csu.merge_precinct_batch(csu.precinct_batch(batch(council=554782, council_type="OBEC")), precincts)
        self.assertFalse(precincts[12001]["counted"])

    def test_rejects_unknown_precinct_wrong_council_and_inconsistent_votes(self):
        for data in (
            batch(precinct=12099), batch(council_type="OBEC"),
            batch().replace(b'PLATNE_HLASY="100"', b'PLATNE_HLASY="99"'),
            batch().replace(b'VYDANE_OBALKY="100"', b'VYDANE_OBALKY="201"'),
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                csu.merge_precinct_batch(csu.precinct_batch(data), {12001: {"number": 12001, "counted": False}})

    def test_first_import_reads_every_batch_then_resumes_from_cursor(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "precincts-praha12.json"
            responses = {
                f"{csu.PRECINCTS_URL}.xml": batch(number=3, order=3, precinct=12003),
                f"{csu.PRECINCTS_URL}_00001.xml": batch(),
                f"{csu.PRECINCTS_URL}_00002.xml": batch(number=2, order=2, precinct=12002),
            }
            with patch.object(csu, "download", side_effect=lambda url: responses[url]) as downloaded:
                result = csu.load_precinct_results(path)
            self.assertEqual(downloaded.call_count, 3)
            self.assertEqual(result["lastBatch"], 3)
            self.assertEqual(sum(item["counted"] for item in result["precincts"]), 3)
            csu.write_json(path, result)
            with patch.object(csu, "download", return_value=batch(number=4, order=4, votes=120)) as downloaded:
                resumed = csu.load_precinct_results(path)
            downloaded.assert_called_once_with(f"{csu.PRECINCTS_URL}.xml")
            self.assertEqual(resumed["lastBatch"], 4)
            self.assertEqual(resumed["precincts"][0]["votes"], {"4": 120})
            self.assertEqual(sum(item["counted"] for item in resumed["precincts"]), 3)

    def test_wrong_election_missing_batch_and_source_error_are_rejected(self):
        for data in (
            batch().replace(b"20261009", b"20221009"),
            b"<html/>",
            f'<VYSLEDKY_OKRSKY xmlns="{csu.NS["kv"]}"><CHYBA KOD_CHYBY="10"/></VYSLEDKY_OKRSKY>'.encode(),
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                csu.precinct_batch(data)

    def test_regressed_cursor_does_not_overwrite_previous_results(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "precincts-praha12.json"
            with patch.object(csu, "download", return_value=batch()):
                result = csu.load_precinct_results(path)
            result["lastBatch"] = 3
            csu.write_json(path, result)
            before = path.read_bytes()
            with patch.object(csu, "download", return_value=batch(number=2)):
                with self.assertRaisesRegex(ValueError, "regressed"):
                    csu.load_precinct_results(path)
            self.assertEqual(path.read_bytes(), before)

    def test_corrupt_previous_records_are_not_republished(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "precincts-praha12.json"
            with patch.object(csu, "download", return_value=batch()):
                original = csu.load_precinct_results(path)
            for corruption in ("duplicate", "status", "votes"):
                damaged = copy.deepcopy(original)
                if corruption == "duplicate":
                    damaged["precincts"].append(damaged["precincts"][0])
                elif corruption == "status":
                    damaged["precincts"][0]["counted"] = "true"
                else:
                    damaged["precincts"][0]["votes"]["4"] = -1
                csu.write_json(path, damaged)
                before = path.read_bytes()
                with self.subTest(corruption=corruption), self.assertRaises(ValueError):
                    csu.load_precinct_results(path)
                self.assertEqual(path.read_bytes(), before)

    def test_failed_precinct_import_does_not_publish_partial_batch(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "results-praha12.json"
            original = {"municipality": "Praha 12", "isSample": False, "precinctsCounted": 0}
            csu.write_json(path, original)
            with patch.object(csu, "download", return_value=b"XML"), \
                    patch.object(csu, "registry_rows", return_value={547107: []}), \
                    patch.object(csu, "convert", return_value=({"parties": []}, copy.deepcopy(original))), \
                    patch.object(csu, "load_precinct_results", side_effect=ValueError("missing batch")):
                with self.assertRaisesRegex(ValueError, "missing batch"):
                    csu.update(["praha12"], Path(folder))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), original)
            self.assertEqual(len(list(Path(folder).iterdir())), 1)


if __name__ == "__main__":
    unittest.main()
