"""Güncelleme geçmişi (site/guncellemeler.json) ve sürüm notu testleri."""

import copy
import importlib.util
import unittest
from pathlib import Path

_YOL = Path(__file__).resolve().parent.parent / "packaging" / "surum_notu.py"
_spec = importlib.util.spec_from_file_location("surum_notu", _YOL)
surum_notu = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(surum_notu)

ORNEK = {
    "surumler": [
        {"surum": "0.2.0", "tarih": "2026-11-01", "baslik": "Yeni özellik",
         "notlar": [{"tur": "duzeltme", "metin": "Bir hata düzeldi."},
                    {"tur": "yeni", "metin": "Bir şey eklendi."}]},
        {"surum": "0.1.0", "tarih": "2026-10-09", "baslik": "İlk sürüm",
         "notlar": [{"tur": "yeni", "metin": "Başladık."}]},
    ]
}


class GuncellemeDosyasi(unittest.TestCase):
    def test_sitedeki_dosya_gecerli(self):
        veri = surum_notu.oku()
        nolar = [s["surum"] for s in veri["surumler"]]
        self.assertEqual(len(nolar), len(set(nolar)))
        self.assertIn("0.1.0", nolar)

    def test_sira_bozuksa_hata(self):
        veri = copy.deepcopy(ORNEK)
        veri["surumler"].reverse()
        with self.assertRaises(surum_notu.NotHatasi):
            surum_notu.kontrol(veri)

    def test_ayni_surum_iki_kez_hata(self):
        veri = copy.deepcopy(ORNEK)
        veri["surumler"][1]["surum"] = "0.2.0"
        with self.assertRaises(surum_notu.NotHatasi):
            surum_notu.kontrol(veri)

    def test_bilinmeyen_tur_hata(self):
        veri = copy.deepcopy(ORNEK)
        veri["surumler"][0]["notlar"][0]["tur"] = "hata"
        with self.assertRaises(surum_notu.NotHatasi):
            surum_notu.kontrol(veri)


class SurumNotu(unittest.TestCase):
    def test_not_turlere_gore_gruplanir(self):
        s = surum_notu.bul(ORNEK, "v0.2.0")
        metin = surum_notu.not_yaz(s)
        self.assertIn("## Yeni özellik", metin)
        self.assertIn("_1 Kasım 2026_", metin)
        self.assertLess(metin.index("**Yeni**"), metin.index("**Düzeltme**"))
        self.assertIn("ParselSorguPlus-Kurulum-0.2.0.exe", metin)
        self.assertIn(surum_notu.SITE, metin)
        self.assertEqual(surum_notu.baslik(s), "v0.2.0 · Yeni özellik")

    def test_notu_olmayan_surum_yayinlanmaz(self):
        with self.assertRaisesRegex(surum_notu.NotHatasi, "sürüm notu yok"):
            surum_notu.bul(ORNEK, "v0.3.0")

    def test_taslak_surum_yayinlanmaz(self):
        veri = copy.deepcopy(ORNEK)
        veri["surumler"][0]["taslak"] = True
        with self.assertRaisesRegex(surum_notu.NotHatasi, "taslak"):
            surum_notu.bul(veri, "v0.2.0")


if __name__ == "__main__":
    unittest.main()
