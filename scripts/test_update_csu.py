import io
from http.client import IncompleteRead, RemoteDisconnected
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from xml.etree import ElementTree as ET
import zipfile

import parse_real_results
import update_csu as csu


def candidate(number: int, validity: str = "A") -> dict[str, str]:
    return {
        "KODZASTUP": "547107", "COBVODU": "1", "POR_STR_HL": "4",
        "PORCISLO": str(number), "JMENO": "Jana", "PRIJMENI": f"Testová{number}",
        "TITULPRED": "Ing.", "TITULZA": "", "VEK": "40", "POVOLANI": "lékařka",
        "PLATNOST": validity,
    }


def results(complete: bool = False) -> bytes:
    return f"""
    <VYSLEDKY_OBEC xmlns="{csu.NS['kv']}" DATUM_CAS_GENEROVANI="2026-10-10T14:00:00">
    <OBEC KODZASTUP="547107" POCET_OBVODU="1" OZNAC_TYPU="MCMO"
          VOLENO_ZASTUP="2" JE_SPOCTENO="{int(complete)}">
    <VYSLEDEK>
    <UCAST OKRSKY_ZPRAC="{2 if complete else 0}" OKRSKY_CELKEM="2"
           UCAST_PROC="50.25" PLATNE_HLASY="{99 if complete else 0}"/>
    <VOLEBNI_STRANA POR_STR_HLAS_LIST="4" NAZEV_STRANY="Naše Dvanáctka"
        KANDIDATU_POCET="2" ZASTUPITELE_POCET="{2 if complete else 0}"
        HLASY="{99 if complete else 0}" HLASY_PROC="{100 if complete else 0}">
    {'''<ZASTUPITEL PORADOVE_CISLO="3" JMENO="Jana" PRIJMENI="Testová3" TITULPRED="Ing." TITULZA="" HLASY="55"/>
    <ZASTUPITEL PORADOVE_CISLO="1" JMENO="Jana" PRIJMENI="Testová1" TITULPRED="Ing." TITULZA="" HLASY="44"/>''' if complete else ''}
    </VOLEBNI_STRANA>
    </VYSLEDEK></OBEC></VYSLEDKY_OBEC>
    """.encode("utf-8")


def district_results(counted: int = 0, total: int = 2) -> bytes:
    standalone = ET.fromstring(results())
    municipality = standalone.find(f"{{{csu.NS['kv']}}}OBEC")
    assert municipality is not None
    turnout = municipality.find(
        f"{{{csu.NS['kv']}}}VYSLEDEK/{{{csu.NS['kv']}}}UCAST"
    )
    assert turnout is not None
    turnout.set("OKRSKY_ZPRAC", str(counted))
    turnout.set("OKRSKY_CELKEM", str(total))
    other = ET.fromstring(ET.tostring(municipality))
    other.set("KODZASTUP", "999999")
    root = ET.Element(
        f"{{{csu.NS['kv']}}}VYSLEDKY_OBCE_OKRES",
        {"DATUM_CAS_GENEROVANI": "2026-10-10T19:30:00"},
    )
    root.extend((other, municipality))
    return ET.tostring(root)


class OfficialDataTests(unittest.TestCase):
    def setUp(self):
        self.rows = [candidate(1), candidate(2, "N"), candidate(3)]

    def test_retries_closed_connection_then_returns_download(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"official XML"
        with patch.object(csu, "urlopen", side_effect=[
            RemoteDisconnected("Remote end closed connection without response"), response,
        ]) as opened, patch.object(csu.time, "sleep") as sleep:
            self.assertEqual(csu.download("https://volby.gov.cz/test"), b"official XML")
        self.assertEqual(opened.call_count, 2)
        sleep.assert_called_once_with(2)

    def test_truncated_read_retries_entire_download(self):
        truncated = MagicMock()
        truncated.__enter__.return_value.read.side_effect = IncompleteRead(b"partial", 10)
        complete = MagicMock()
        complete.__enter__.return_value.read.return_value = b"complete"
        with patch.object(csu, "urlopen", side_effect=[truncated, complete]), \
                patch.object(csu.time, "sleep"):
            self.assertEqual(csu.download("https://volby.gov.cz/test"), b"complete")

    def test_retry_exhaustion_is_an_error(self):
        with patch.object(csu, "urlopen", side_effect=RemoteDisconnected("closed")) as opened, \
                patch.object(csu.time, "sleep") as sleep:
            with self.assertRaises(RemoteDisconnected):
                csu.download("https://volby.gov.cz/test")
        self.assertEqual(opened.call_count, 4)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [2, 4, 8])

    def test_retries_transient_http_but_not_missing_file(self):
        for status, attempts in ((503, 4), (429, 4), (404, 1), (403, 1)):
            with self.subTest(status=status):
                error = HTTPError("https://volby.gov.cz/test", status, "error", {}, None)
                with patch.object(csu, "urlopen", side_effect=error) as opened, \
                        patch.object(csu.time, "sleep"):
                    with self.assertRaises(HTTPError):
                        csu.download("https://volby.gov.cz/test")
                self.assertEqual(opened.call_count, attempts)

    def test_excludes_invalid_without_renumbering(self):
        candidates, result = csu.convert("praha12", results(), self.rows)
        party = candidates["parties"][0]
        self.assertEqual(party["candidateCount"], 2)
        self.assertEqual([c["number"] for c in party["candidates"]], [1, 3])
        self.assertEqual(party["id"], 4)
        self.assertEqual(party["candidates"][0]["name"], "Ing. Jana Testová1")
        self.assertIsNone(result["turnoutPercent"])
        self.assertIsNone(result["parties"][0]["seats"])
        self.assertEqual(len(result["seats"]), 2)
        self.assertTrue(all(s["partyId"] is None for s in result["seats"]))
        self.assertFalse(result["isSample"])
        self.assertFalse(result["isComplete"])

    def test_uses_official_winners_and_votes(self):
        _, result = csu.convert("praha12", results(True), self.rows)
        self.assertTrue(result["isComplete"])
        self.assertEqual(result["turnoutPercent"], 50.25)
        self.assertEqual(result["parties"][0]["seats"], 2)
        self.assertEqual(result["seats"][0]["name"], "Ing. Jana Testová3")
        self.assertEqual(result["seats"][0]["preferenceVotes"], 55)
        self.assertEqual(result["generatedAt"], "2026-10-10T14:00:00")

    def test_partial_results_do_not_estimate_seats(self):
        xml = results().replace(b'OKRSKY_ZPRAC="0"', b'OKRSKY_ZPRAC="1"')
        _, result = csu.convert("praha12", xml, self.rows)
        self.assertEqual(result["turnoutPercent"], 50.25)
        self.assertIsNone(result["parties"][0]["seats"])
        self.assertTrue(all(s["name"] is None for s in result["seats"]))

    def test_uses_current_district_feed_and_selects_municipality(self):
        _, result = csu.convert("praha12", district_results(), self.rows)
        self.assertEqual(result["generatedAt"], "2026-10-10T19:30:00")
        self.assertEqual(result["source"], csu.RESULTS_URL)
        self.assertEqual(result["precinctsTotal"], 2)

    def test_keeps_previous_results_when_precinct_count_drops(self):
        previous_xml = (
            results().replace(b'OKRSKY_CELKEM="2"', b'OKRSKY_CELKEM="9"')
            .replace(b'OKRSKY_ZPRAC="0"', b'OKRSKY_ZPRAC="7"')
        )
        _, previous = csu.convert("praha12", previous_xml, self.rows)
        _, current = csu.convert("praha12", district_results(5, 9), self.rows)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "results-praha12.json"
            csu.write_json(path, previous)
            with patch("sys.stderr"):
                preserved = csu.preserve_results_if_precinct_count_regresses(current, path)
        self.assertEqual(preserved, previous)
        self.assertEqual(previous["precinctsCounted"], 7)
        self.assertEqual(current["precinctsCounted"], 5)

    def test_accepts_results_when_precinct_count_increases(self):
        previous_xml = results().replace(b'OKRSKY_ZPRAC="0"', b'OKRSKY_ZPRAC="1"')
        _, previous = csu.convert("praha12", previous_xml, self.rows)
        current_xml = results(True)
        _, current = csu.convert("praha12", current_xml, self.rows)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "results-praha12.json"
            csu.write_json(path, previous)
            accepted = csu.preserve_results_if_precinct_count_regresses(current, path)
        self.assertEqual(accepted, current)

    def test_rejects_count_mismatch_and_invalid_winner(self):
        with self.assertRaisesRegex(ValueError, "count mismatch"):
            csu.convert("praha12", results(), [candidate(1)])
        xml = results(True).replace(b'PORADOVE_CISLO="3"', b'PORADOVE_CISLO="2"')
        with self.assertRaisesRegex(ValueError, "not active"):
            csu.convert("praha12", xml, self.rows)

    def test_rejects_error_and_wrong_xml(self):
        error = f'<VYSLEDKY_OBEC xmlns="{csu.NS["kv"]}"><CHYBA KOD_CHYBY="10"/></VYSLEDKY_OBEC>'
        with self.assertRaisesRegex(ValueError, "XML error"):
            csu.convert("praha12", error.encode(), self.rows)
        with self.assertRaisesRegex(ValueError, "Unexpected XML root"):
            csu.convert("praha12", b"<html/>", self.rows)
        with self.assertRaisesRegex(ValueError, "update_csu.py"):
            parse_real_results.aggregate_t3(io.BytesIO(results()), {(547107, 2): "praha12"})

    def test_registry_zip(self):
        root = ET.Element(f"{{{csu.NS['kv']}}}KV_REGKAND")
        for values in self.rows:
            row = ET.SubElement(root, f"{{{csu.NS['kv']}}}KV_REGKAND_ROW")
            for key, value in values.items():
                ET.SubElement(row, f"{{{csu.NS['kv']}}}{key}").text = value
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("kvrk.xml", ET.tostring(root))
        self.assertEqual(csu.registry_rows(data.getvalue(), {547107})[547107], self.rows)

    def test_failed_download_preserves_published_files(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "results-praha12.json"
            path.write_text('{"isSample":true}', encoding="utf-8")
            with patch.object(csu, "download", side_effect=OSError("offline")):
                with self.assertRaises(OSError):
                    csu.update(["praha12"], Path(folder))
            self.assertEqual(json.loads(path.read_text())["isSample"], True)

    def test_json_is_utf8_and_atomically_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.json"
            csu.write_json(path, {"name": "ČSÚ"})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"name": "ČSÚ"})
            self.assertEqual(list(Path(folder).iterdir()), [path])


if __name__ == "__main__":
    unittest.main()
