"""Arayüz betikleri: aynı sayfada sırayla yüklenen düz betikler (web/index.html) aynı üst düzey adları paylaşır.

İki betikte aynı adla const/let/function tanımlanırsa tarayıcı ikincisini hiç çalıştırmaz ("already been
declared"); o betiğin bütün özellikleri sessizce kaybolur. Bu test o çakışmayı yakalar.
"""

import re
import unittest
from collections import defaultdict
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
TANIM = re.compile(r"^(?:const|let|var|class|(?:async\s+)?function\*?)\s+([A-Za-z_$][\w$]*)", re.M)


class BetikTest(unittest.TestCase):
    def test_ust_duzey_adlar_cakismaz(self):
        sayfa = (WEB / "index.html").read_text(encoding="utf-8")
        betikler = [ad for ad in re.findall(r'<script src="([^"/]+\.js)"', sayfa)]
        self.assertIn("app.js", betikler)
        yerler = defaultdict(list)
        for ad in betikler:
            for isim in TANIM.findall((WEB / ad).read_text(encoding="utf-8")):
                yerler[isim].append(ad)
        cakisanlar = {isim: dosyalar for isim, dosyalar in yerler.items() if len(dosyalar) > 1}
        self.assertEqual(cakisanlar, {})


if __name__ == "__main__":
    unittest.main()
