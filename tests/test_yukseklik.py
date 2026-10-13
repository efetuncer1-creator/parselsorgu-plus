"""Yükseklik modeli (parselapp/yukseklik.py); internete bağlanmaz. Copernicus dosyasının küçük bir eşi (derece
başına 8 nokta, 4x4'lük döşemeler, aynı sıkıştırma ve öngörücü) bellekte üretilir."""

import json
import math
import struct
import tempfile
import unittest
import unittest.mock
import zlib
from pathlib import Path

import numpy as np

from parselapp import yukseklik
from parselapp.store import Store

N = 8  # derece başına nokta (gerçekte 3600)
DOSEME = 4


def deger(r, c):
    return 1000 + r + c / 10


def sikistir(a):
    """doseme_coz'un tersi: büyük sonlu baytlar satırda anlamlılığa göre dizilir, farkı alınır, deflate."""
    boy, en = a.shape
    b = a.astype(">f4").view(np.uint8).reshape(boy, en, 4).transpose(0, 2, 1).reshape(boy, en * 4)
    fark = np.diff(b, axis=1, prepend=np.zeros((boy, 1), np.uint8)).astype(np.uint8)
    return zlib.compress(fark.tobytes())


def tiff(bati, kuzey, katlar=(1, 2)):
    """Kuzey-batı köşesi (bati, kuzey) olan 1°x1° dosya; tam çözünürlük ve küçültülmüş kopyalar (IFD zinciri).
    Küçültülmüş noktanın değeri, kapladığı f x f noktanın ortasındaki değer (deger doğrusal: ortalamayla aynı)."""
    seviyeler = []
    for f in katlar:
        m = N // f
        a = np.fromfunction(lambda r, c: deger(r * f + (f - 1) / 2, c * f + (f - 1) / 2), (m, m), dtype=np.float64).astype(np.float32)
        d = min(DOSEME, m)
        seviyeler.append((m, d, [sikistir(a[i:i + d, j:j + d]) for i in range(0, m, d) for j in range(0, m, d)]))
    geo = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 2, 2048, 0, 1, 4326]
    bic = {3: "H", 4: "I", 12: "d"}

    def girdiler(seviye, ofsetler, ilk):
        m, d, dosemeler = seviye
        g = {256: (3, [m]), 257: (3, [m]), 258: (3, [32]), 259: (3, [8]), 317: (3, [3]), 322: (3, [d]), 323: (3, [d]),
             324: (4, ofsetler), 325: (4, [len(x) for x in dosemeler]), 339: (3, [3])}
        if ilk:
            g.update({33550: (12, [1 / N, 1 / N, 0.0]), 33922: (12, [0.0, 0.0, 0.0, bati, kuzey, 0.0]), 34735: (3, geo)})
        return g

    def ifd(g, yer, sonraki):
        """yer'de başlayan IFD ve hemen ardından 4 bayta sığmayan değerleri."""
        veri_yeri = yer + 2 + len(g) * 12 + 4
        govde, ekler = b"", b""
        for etiket, (tur, d) in sorted(g.items()):
            ham = struct.pack("<" + bic[tur] * len(d), *d)
            govde += struct.pack("<HHI", etiket, tur, len(d))
            if len(ham) <= 4:
                govde += ham.ljust(4, b"\0")
            else:
                govde += struct.pack("<I", veri_yeri + len(ekler))
                ekler += ham
        return struct.pack("<H", len(g)) + govde + struct.pack("<I", sonraki) + ekler

    # Önce IFD'lerin yeri (uzunlukları ofsetlerin değerine bağlı değil), sonra döşemelerin yeri
    yerler, yer = [], 8
    for i, s in enumerate(seviyeler):
        yerler.append(yer)
        yer += len(ifd(girdiler(s, [0] * len(s[2]), i == 0), 0, 0))
    ofsetler = []
    for s in seviyeler:
        ofsetler.append([])
        for x in s[2]:
            ofsetler[-1].append(yer)
            yer += len(x)
    v = b"II*\0" + struct.pack("<I", 8)
    for i, s in enumerate(seviyeler):
        v += ifd(girdiler(s, ofsetler[i], i == 0), yerler[i], yerler[i + 1] if i + 1 < len(yerler) else 0)
    return v + b"".join(x for s in seviyeler for x in s[2])


class SahteKaynak:
    def __init__(self, dosyalar):
        self.dosyalar = dosyalar  # url -> bayt
        self.istekler = 0

    def __call__(self, url, bas, son):
        self.istekler += 1
        v = self.dosyalar.get(url)
        return None if v is None else v[bas:son + 1]


def kaynak(*kareler):
    return SahteKaynak({f"http://x/{yukseklik.dosya_adi(g, b)}/{yukseklik.dosya_adi(g, b)}.tif": tiff(b, g + 1) for g, b in kareler})


class YukseklikTest(unittest.TestCase):
    def setUp(self):
        self.klasor = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.klasor.cleanup()

    def yeni(self, k):
        return yukseklik.Yukseklik(self.klasor.name, aralik=k, kaynak="http://x", hucre=N)

    def test_dosya_adi(self):
        self.assertEqual(yukseklik.dosya_adi(37, 32), "Copernicus_DSM_COG_10_N37_00_E032_00_DEM")
        self.assertEqual(yukseklik.dosya_adi(-1, -5), "Copernicus_DSM_COG_10_S01_00_W005_00_DEM")

    def test_doseme_coz(self):
        a = np.array([[1.5, -2.25, 1013.7], [0.0, 3.0e3, 7.0]], dtype=np.float32)
        np.testing.assert_array_equal(yukseklik.doseme_coz(sikistir(a), 3, 2, 8, 3), a)

    def test_izgara(self):
        k = kaynak((37, 32))
        dizi, bilgi = self.yeni(k).izgara(32.3, 37.4, 32.6, 37.7)
        # İlk nokta: kutunun kuzey-batısından PAY kadar dışarıda, ızgara noktasında
        self.assertAlmostEqual(bilgi["bati"], (math.floor(32.3 * N) - 2) / N)
        self.assertAlmostEqual(bilgi["kuzey"], (math.ceil(37.7 * N) + 2) / N)
        self.assertEqual(dizi.shape, (bilgi["boy"], bilgi["en"]))
        self.assertFalse(bilgi["eksik"])
        self.assertGreater(bilgi["indirilen"], 0)
        for i in range(bilgi["boy"]):
            for j in range(bilgi["en"]):
                enlem, boylam = bilgi["kuzey"] - i / N, bilgi["bati"] + j / N
                r, c = round((38 - enlem) * N), round((boylam - 32) * N)
                self.assertAlmostEqual(float(dizi[i, j]), deger(r, c), places=3)

    def test_denizdeki_kare_bos_kalir(self):
        # Kutu kuzeydeki karenin (dosyası yok) içine taşıyor
        dizi, bilgi = self.yeni(kaynak((37, 32))).izgara(32.3, 37.7, 32.5, 37.99)
        self.assertTrue(bilgi["eksik"])
        for i in range(bilgi["boy"]):  # 38°'nin kuzeyindeki satırlar boş, gerisi dolu
            self.assertEqual(bool(np.isnan(dizi[i]).all()), bilgi["kuzey"] - i / N > 38 + 1e-9)
            self.assertEqual(bool(np.isnan(dizi[i]).any()), bilgi["kuzey"] - i / N > 38 + 1e-9)

    def test_iki_kareyi_birlestirir(self):
        dizi, bilgi = self.yeni(kaynak((37, 32), (37, 33))).izgara(32.8, 37.4, 33.2, 37.5)
        self.assertFalse(bilgi["eksik"])
        j = round((33 - bilgi["bati"]) * N)  # 33°'deki sütun doğudaki karenin ilk sütunu
        self.assertAlmostEqual(float(dizi[0, j]), deger(round((38 - bilgi["kuzey"]) * N), 0), places=3)
        self.assertAlmostEqual(float(dizi[0, j - 1]), deger(round((38 - bilgi["kuzey"]) * N), N - 1), places=3)

    def test_indirilen_saklanir(self):
        self.yeni(kaynak((37, 32))).izgara(32.3, 37.4, 32.6, 37.7)
        def kopuk(*a):
            raise yukseklik.YukseklikHatasi("internet yok")
        dizi, bilgi = self.yeni(kopuk).izgara(32.3, 37.4, 32.6, 37.7)  # yeni nesne: bellekte değil, diskte
        self.assertEqual(bilgi["indirilen"], 0)
        self.assertFalse(np.isnan(dizi).any())

    def test_cok_buyuk_bolge(self):
        y = yukseklik.Yukseklik(self.klasor.name, aralik=kaynak())
        with self.assertRaises(ValueError):
            y.izgara(30.0, 36.0, 35.0, 41.0)  # gerçek çözünürlükte 8 kat küçültülse de 1500 noktayı aşar

    def test_buyuk_bolgede_kucultulmus_kopya(self):
        k = kaynak((37, 32))
        with unittest.mock.patch.object(yukseklik, "EN_COK_HUCRE", 120):  # tam çözünürlükte 13x13 nokta sığmaz
            dizi, bilgi = self.yeni(k).izgara(32.0, 37.0, 33.0, 38.0)
        self.assertEqual(bilgi["kat"], 2)
        self.assertAlmostEqual(bilgi["adim"], 2 / N)
        self.assertLessEqual(bilgi["en"] * bilgi["boy"], 120)
        dolu = 0
        for i in range(bilgi["boy"]):
            for j in range(bilgi["en"]):
                enlem, boylam = bilgi["kuzey"] - i * bilgi["adim"], bilgi["bati"] + j * bilgi["adim"]
                if 37 < enlem < 38 and 32 < boylam < 33:  # karenin içi; çevresi dosyası olmayan kareler
                    dolu += 1
                    self.assertAlmostEqual(float(dizi[i, j]), deger((38 - enlem) * N, (boylam - 32) * N), places=3)
                else:
                    self.assertTrue(np.isnan(dizi[i, j]))
        self.assertEqual(dolu, (N // 2) ** 2)
        self.assertTrue((Path(self.klasor.name) / yukseklik.dosya_adi(37, 32) / "s1-0.bin").is_file())

    def test_eski_baslik_yeniden_okunur(self):
        self.yeni(kaynak((37, 32))).izgara(32.3, 37.4, 32.6, 37.7)
        yol = Path(self.klasor.name) / yukseklik.dosya_adi(37, 32) / "baslik.json"
        b = json.loads(yol.read_text(encoding="utf-8"))
        del b["surum"]
        yol.write_text(json.dumps(b), encoding="utf-8")
        k = kaynak((37, 32))
        dizi, bilgi = self.yeni(k).izgara(32.3, 37.4, 32.6, 37.7)
        self.assertGreater(k.istekler, 0)  # başlık yeniden indirildi; döşemeler diskten
        self.assertEqual(json.loads(yol.read_text(encoding="utf-8"))["surum"], yukseklik.BASLIK_SURUMU)
        self.assertFalse(np.isnan(dizi).any())

    def test_uc(self):
        from parselapp.server import Hata, Uygulama
        store = Store(Path(self.klasor.name) / "t.db")
        try:
            uyg = Uygulama(store)
            uyg.yukseklik = self.yeni(kaynak((37, 32)))
            r = uyg.yonlendir("POST", ["yukseklik"], json.dumps({"bbox": [32.3, 37.4, 32.6, 37.7]}).encode(), {})
            bilgi = json.loads(r.ek["X-Izgara"])
            dizi = np.frombuffer(r.veri, dtype="<f4").reshape(bilgi["boy"], bilgi["en"])
            self.assertAlmostEqual(float(dizi[0, 0]), deger(round((38 - bilgi["kuzey"]) * N), round((bilgi["bati"] - 32) * N)), places=3)
            self.assertIsNone(r.ad)
            for bozuk in ({"bbox": [1, 2, 3, 4]}, {"bbox": [32.6, 37.4, 32.3, 37.7]}, {}):
                with self.subTest(govde=bozuk), self.assertRaises(Hata):
                    uyg.yonlendir("POST", ["yukseklik"], json.dumps(bozuk).encode(), {})
        finally:
            store._db.close()


if __name__ == "__main__":
    unittest.main()
