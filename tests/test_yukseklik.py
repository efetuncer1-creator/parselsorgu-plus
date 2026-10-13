"""Yükseklik modeli (parselapp/yukseklik.py); internete bağlanmaz. Copernicus dosyasının küçük bir eşi (derece
başına 8 nokta, 4x4'lük döşemeler, aynı sıkıştırma ve öngörücü) bellekte üretilir."""

import json
import math
import struct
import tempfile
import unittest
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


def tiff(bati, kuzey):
    """Kuzey-batı köşesi (bati, kuzey) olan 1°x1° dosya."""
    a = np.fromfunction(deger, (N, N), dtype=np.float64).astype(np.float32)
    dosemeler = [sikistir(a[i:i + DOSEME, j:j + DOSEME]) for i in range(0, N, DOSEME) for j in range(0, N, DOSEME)]
    geo = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 2, 2048, 0, 1, 4326]
    dis = {  # etiket -> (tür, değerler); 4 bayta sığmayanlar IFD'den sonra yazılır
        256: (3, [N]), 257: (3, [N]), 258: (3, [32]), 259: (3, [8]), 317: (3, [3]), 322: (3, [DOSEME]), 323: (3, [DOSEME]),
        324: (4, [0] * len(dosemeler)), 325: (4, [len(d) for d in dosemeler]), 339: (3, [3]),
        33550: (12, [1 / N, 1 / N, 0.0]), 33922: (12, [0.0, 0.0, 0.0, bati, kuzey, 0.0]), 34735: (3, geo),
    }
    bic = {3: "H", 4: "I", 12: "d"}
    ifd = 8
    veri_yeri = ifd + 2 + len(dis) * 12 + 4
    ekler, girdiler = b"", []
    for etiket, (tur, d) in sorted(dis.items()):
        ham = struct.pack("<" + bic[tur] * len(d), *d)
        if len(ham) <= 4:
            girdiler.append((etiket, tur, len(d), ham.ljust(4, b"\0"), None))
        else:
            girdiler.append((etiket, tur, len(d), None, veri_yeri + len(ekler)))
            ekler += ham
    doseme_yeri = veri_yeri + len(ekler)
    ofsetler, yer = [], doseme_yeri
    for d in dosemeler:
        ofsetler.append(yer)
        yer += len(d)
    # 324'ün değerleri (ofsetler) artık belli
    i324 = [g[0] for g in girdiler].index(324)
    ekler = ekler[:girdiler[i324][4] - veri_yeri] + struct.pack(f"<{len(ofsetler)}I", *ofsetler) + ekler[girdiler[i324][4] - veri_yeri + 4 * len(ofsetler):]
    v = b"II*\0" + struct.pack("<I", ifd) + struct.pack("<H", len(girdiler))
    for etiket, tur, sayi, ham, yer_ in girdiler:
        v += struct.pack("<HHI", etiket, tur, sayi) + (ham if ham is not None else struct.pack("<I", yer_))
    return v + struct.pack("<I", 0) + ekler + b"".join(dosemeler)


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
            y.izgara(30.0, 37.0, 31.0, 38.0)

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
