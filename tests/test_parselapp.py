"""Testler; TKGM'ye bağlanmaz. Çalıştırma:  python -m unittest -v"""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from openpyxl import load_workbook

from parselapp import analiz, coords, exporters, referans
from parselapp.importers import dosya_oku, ice_aktar, kml_oku
from parselapp.store import Store
from parselapp.tkgm import Bulunamadi, LimitAsildi, Tkgm
from parselapp.util import parcel_key, parse_alan

ORNEK = Path(__file__).parent / "ornekler"


def oku(ad):
    return (ORNEK / ad).read_bytes()


class GeciciStore(unittest.TestCase):
    def setUp(self):
        self.klasor = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.klasor.name) / "t.db")

    def tearDown(self):
        self.store._db.close()
        self.klasor.cleanup()


class YardimciTest(unittest.TestCase):
    def test_alan(self):
        self.assertEqual(parse_alan("4.598,40"), 4598.40)
        self.assertEqual(parse_alan("3.158.004,18"), 3158004.18)
        self.assertEqual(parse_alan("500"), 500.0)
        self.assertIsNone(parse_alan(""))
        # Haritadan (koordinatla) sorgu İngilizce biçim döndürüyor
        self.assertEqual(parse_alan("29,636.19"), 29636.19)
        self.assertEqual(parse_alan("1,234,567.5"), 1234567.5)
        self.assertEqual(parse_alan("578,84"), 578.84)
        self.assertEqual(parse_alan("578.84"), 578.84)
        self.assertEqual(parse_alan("3.158.004"), 3158004.0)

    def test_turkce_siralama(self):
        from parselapp.util import tr_sira
        iller = ["Zonguldak", "Çankırı", "İzmir", "Ağrı", "Isparta", "Şanlıurfa", "Ordu", "Ödemiş", "Uşak", "Ünye", "Cide"]
        self.assertEqual(sorted(iller, key=tr_sira),
                         ["Ağrı", "Cide", "Çankırı", "Isparta", "İzmir", "Ordu", "Ödemiş", "Şanlıurfa", "Uşak", "Ünye", "Zonguldak"])

    def test_anahtar_turkce(self):
        self.assertEqual(parcel_key("İSTANBUL", "Büyükçekmece", "  Türkoba ", 0, "53"),
                         parcel_key("istanbul", "büyükçekmece", "türkoba", "0", 53))
        # TKGM bazen ı'yı i'ye çevirerek veriyor; aynı parsel tek anahtar
        self.assertEqual(parcel_key("Ağrı", "Doğubayazıt", "Atabakan", 1, 2),
                         parcel_key("Ağri", "Doğubayazit", "ATABAKAN", 1, 2))

    def test_iyi_yazim(self):
        from parselapp.util import iyi_yazim
        self.assertEqual(iyi_yazim("Kirşehir", "Kırşehir"), "Kırşehir")
        self.assertEqual(iyi_yazim("Kırşehir", "Kirşehir"), "Kırşehir")
        self.assertEqual(iyi_yazim("Ilgaz", "İlgaz"), "Ilgaz")
        self.assertEqual(iyi_yazim("Akçaali", "Akçaali-Merkez"), "Akçaali")  # başka ad: dokunma
        self.assertEqual(iyi_yazim("Ankara", None), "Ankara")
        self.assertEqual(iyi_yazim(None, "Ankara"), "Ankara")


class IceAktarmaTest(GeciciStore):
    def test_alan_yoneticisi_kml(self):
        kayitlar = kml_oku(oku("alan_yoneticisi.kml"))
        self.assertEqual(len(kayitlar), 2)  # etiket noktası atlanır
        k = kayitlar[0]
        self.assertEqual((k["il"], k["ilce"], k["mahalle"], k["ada"], k["parsel"]),
                         ("Örnekil", "Örnekilçe", "Deneme", "12", "5"))
        self.assertEqual(k["alan"], "1.234,50")
        self.assertEqual(k["nitelik"], "Tarla")
        self.assertEqual(len(k["geometri"][0][0]), 5)
        self.assertEqual(kayitlar[1]["ada"], "0")  # boş ada -> 0

    def test_parselsorgu_kml_kayan_nokta_temizlenir(self):
        k = kml_oku(oku("parselsorgu.kml"))[0]
        self.assertEqual(k["geometri"][0][0][0], [31.4, 41.2])
        self.assertEqual(k["parsel"], "5")

    def test_fav_list_json(self):
        k = dosya_oku("fav_list.json", oku("fav_list.json"))[0]
        self.assertEqual(k["mahalle_id"], 100)
        self.assertEqual(k["geometri"][0][0][1], [31.4014, 41.201])
        self.assertEqual(k["zemin"], "Ana Taşınmaz")

    def test_tekrarlar_ve_tarih_kurali(self):
        r1 = ice_aktar(self.store, "alan_yoneticisi.kml", oku("alan_yoneticisi.kml"), "2025-01-01T00:00:00")
        self.assertEqual({k: r1[k] for k in ("yeni", "guncellendi", "atlandi")}, {"yeni": 2, "guncellendi": 0, "atlandi": 0})
        self.assertEqual(len(r1["keys"]), 2)
        # Daha eski tarihli dosya yenisini ezmez
        r2 = ice_aktar(self.store, "parselsorgu.kml", oku("parselsorgu.kml"), "2024-01-01T00:00:00")
        self.assertEqual(r2["atlandi"], 1)
        self.assertEqual(len(r2["keys"]), 1)  # atlanan parsel de oturuma eklenir
        # Daha yeni tarihli dosya günceller
        r3 = ice_aktar(self.store, "parselsorgu.kml", oku("parselsorgu.kml"), "2026-01-01T00:00:00")
        self.assertEqual(r3["guncellendi"], 1)
        p = self.store.bul(parcel_key("Örnekil", "Örnekilçe", "Deneme", "12", "5"))
        self.assertEqual(p["nitelik"], "Bahçe")
        self.assertEqual(p["pafta"], "X00a00a0a")  # yeni dosyada olmayan bilgi korunur
        self.assertEqual(len(self.store.listele()), 2)

    def test_eski_dosya_bos_alanlari_doldurur(self):
        kayit = dosya_oku("fav_list.json", oku("fav_list.json"))[0]
        kml_hali = {k: v for k, v in kayit.items() if k not in ("mahalle_id", "zemin")}
        self.store.kaydet(dict(kml_hali, nitelik="Yeni"), "dosya:yeni.kml", "2026-01-01T00:00:00")
        self.assertEqual(self.store.kaydet(kayit, "dosya:fav_list.json", "2025-01-01T00:00:00"), "atlandi")
        p = self.store.bul_id(100, "12", "7")
        self.assertEqual(p["nitelik"], "Yeni")  # ezilmedi
        self.assertEqual(p["zemin"], "Ana Taşınmaz")  # ama boşluk dolduruldu

    def test_turkce_yazim_farki_tek_kayit(self):
        kayit = {"il": "Ağri", "ilce": "Doğubayazit", "mahalle": "Atabakan", "ada": "1", "parsel": "2",
                 "alan": "100", "geometri": [[[[30, 40], [30.001, 40], [30.001, 40.001], [30, 40]]]]}
        self.store.kaydet(kayit, "tkgm")
        self.assertEqual(self.store.kaydet(kayit | {"il": "Ağrı", "ilce": "Doğubayazıt"}, "dosya:a.kml"), "atlandi")
        hepsi = self.store.listele()
        self.assertEqual(len(hepsi), 1)
        self.assertEqual((hepsi[0]["il"], hepsi[0]["ilce"]), ("Ağrı", "Doğubayazıt"))
        self.assertEqual(hepsi[0]["kaynak"], "tkgm")

    def test_ayni_yerin_yazimlari_birlesir(self):
        geo = [[[[30, 40], [30.001, 40], [30.001, 40.001], [30, 40]]]]
        self.store.kaydet({"il": "Ağri", "ilce": "Doğubayazit", "mahalle": "Atabakan", "ada": "1", "parsel": "1",
                           "geometri": geo}, "dosya:eski.kml")
        ice_aktar_sonrasi = {"il": "Ağrı", "ilce": "Doğubayazıt", "mahalle": "Atabakan", "ada": "1", "parsel": "2",
                             "geometri": geo}
        self.store.kaydet(ice_aktar_sonrasi, "dosya:yeni.kml")
        self.store.yazimlari_birlestir()
        self.assertEqual({(p["il"], p["ilce"]) for p in self.store.listele()}, {("Ağrı", "Doğubayazıt")})

    def test_eski_anahtarlar_yenilenir(self):
        import sqlite3
        db = Path(self.klasor.name) / "eski.db"
        Store(db)._db.close()
        c = sqlite3.connect(db)
        geo = json.dumps([[[[30, 40], [30.001, 40], [30.001, 40.001], [30, 40]]]])
        for key, il, kaynak, tarih in (("ağri|x|y|1|2", "Ağri", "tkgm", "2026-10-01"),
                                       ("ağrı|x|y|1|2", "Ağrı", "dosya:a.kml", "2026-10-05")):
            c.execute("INSERT INTO parseller (key, il, ilce, mahalle, ada, parsel, mahalle_id, geometri, kaynak,"
                      " kaynak_tarih, eklenme) VALUES (?,?,'X','Y','1','2',?,?,?,?,?)",
                      (key, il, 7 if kaynak == "tkgm" else None, geo, kaynak, tarih, tarih))
        c.execute("PRAGMA user_version = 0"); c.commit(); c.close()
        s = Store(db)
        hepsi = s.listele()
        s._db.close()
        self.assertEqual(len(hepsi), 1)
        p = hepsi[0]
        self.assertEqual((p["key"], p["il"], p["kaynak"], p["mahalle_id"]), ("ağri|x|y|1|2", "Ağrı", "tkgm", 7))

    def test_tkgm_verisi_dosyayla_ezilmez(self):
        kayit = dosya_oku("fav_list.json", oku("fav_list.json"))[0]
        self.store.kaydet(kayit, "tkgm", "2020-01-01T00:00:00")
        kayit2 = dict(kayit, nitelik="Değişmiş")
        self.assertEqual(self.store.kaydet(kayit2, "dosya:x.kml", "2030-01-01T00:00:00"), "atlandi")

    def test_bos_secim_hepsi_demek_degil(self):
        ice_aktar(self.store, "alan_yoneticisi.kml", oku("alan_yoneticisi.kml"))
        self.assertEqual(self.store.listele([]), [])
        self.assertEqual(len(self.store.listele()), 2)
        self.assertEqual(self.store.sil([]), 0)

    def test_noktadaki_parsel(self):
        ice_aktar(self.store, "alan_yoneticisi.kml", oku("alan_yoneticisi.kml"))
        self.assertEqual(self.store.noktadaki(31.4002, 41.20015)["parsel"], "5")
        self.assertIsNone(self.store.noktadaki(31.5, 41.5))


class KoordinatTest(unittest.TestCase):
    def test_dilim(self):
        self.assertEqual(coords.dilim_sec(31.42), 30)
        self.assertEqual(coords.dilim_sec(31.6), 33)
        self.assertEqual(coords.dilim_sec(26.0), 27)
        self.assertEqual(coords.dilim_sec(44.9), 45)

    def test_itrf96_ed50(self):
        y, x = coords.donustur(30.0, 41.0, "itrf96", 30)
        self.assertAlmostEqual(y, 500000.0, delta=0.01)  # orta meridyende Y = 500.000
        self.assertAlmostEqual(x, 4540000, delta=10000)
        y2, x2 = coords.donustur(30.0, 41.0, "ed50", 30)
        # ED50 ile ITRF96 arası Türkiye'de birkaç yüz metre değil, ~70-200 m civarı fark
        self.assertTrue(20 < abs(x2 - x) < 300)


class DisaAktarmaTest(GeciciStore):
    def setUp(self):
        super().setUp()
        ice_aktar(self.store, "alan_yoneticisi.kml", oku("alan_yoneticisi.kml"))
        ice_aktar(self.store, "fav_list.json", oku("fav_list.json"))
        self.parseller = self.store.listele()

    def test_kml_geri_okunur(self):
        geri = kml_oku(exporters.kml(self.parseller))
        self.assertEqual(len(geri), 3)
        anahtarlar = {parcel_key(k["il"], k["ilce"], k["mahalle"], k["ada"], k["parsel"]) for k in geri}
        self.assertEqual(anahtarlar, {p["key"] for p in self.parseller})
        fav = next(k for k in geri if k["parsel"] == "7")
        self.assertEqual(fav["mahalle_id"], 100)

    def test_kml_ayri_zip(self):
        z = zipfile.ZipFile(io.BytesIO(exporters.kml_ayri_zip(self.parseller)))
        self.assertEqual(len(z.namelist()), 3)
        self.assertIn("Örnekil-Örnekilçe-Deneme-12-5.kml", z.namelist())

    def test_excel(self):
        veri, dom = exporters.excel(self.parseller, "itrf96")
        self.assertEqual(dom, 30)
        wb = load_workbook(io.BytesIO(veri))
        ws = wb["Parseller"]
        self.assertEqual(ws["G1"].value, "Tapu Alanı (m²)")
        alanlar = [ws.cell(row=r, column=7).value for r in range(2, 5)]
        self.assertEqual(sorted(alanlar), [500.0, 1234.5, 2000.0])
        self.assertEqual(ws["G5"].value, "=SUM(G2:G4)")
        wk = wb["Koordinatlar"]
        self.assertIn("EPSG:5254", wk["A1"].value)
        # 12/5 dış halkası 5 nokta, kapanış noktası tekrarlanmaz -> 4 satır
        satirlar = [r for r in wk.iter_rows(min_row=5, values_only=True) if r[1] == "12/5"]
        self.assertEqual(len(satirlar), 4)

    def test_excel_ed50_sabit_dilim(self):
        _, dom = exporters.excel(self.parseller, "ed50", "33")
        self.assertEqual(dom, 33)
        with self.assertRaises(ValueError):
            exporters.excel(self.parseller, "ed50", "31")


class ReferansTest(GeciciStore):
    def setUp(self):
        super().setUp()
        ice_aktar(self.store, "alan_yoneticisi.kml", oku("alan_yoneticisi.kml"))
        ice_aktar(self.store, "fav_list.json", oku("fav_list.json"))
        self.fc = referans.dosya_oku("osb_sinir.kml", oku("osb_sinir.kml"))

    def test_okuma(self):
        turler = sorted(f["geometry"]["type"] for f in self.fc["features"])
        self.assertEqual(turler, ["LineString", "Point", "Polygon"])
        self.assertEqual(self.fc["features"][0]["properties"]["ad"], "1. Etap")

    def test_kmz(self):
        tampon = io.BytesIO()
        with zipfile.ZipFile(tampon, "w") as z:
            z.writestr("doc.kml", oku("osb_sinir.kml"))
        fc = referans.dosya_oku("osb.kmz", tampon.getvalue())
        self.assertEqual(len(fc["features"]), 3)

    def test_kapali_cizgi_alan_sayilir(self):
        alan = referans.alan(self.fc)
        self.assertEqual(alan.geom_type, "MultiPolygon")  # poligon + çizgiden oluşan alan
        self.assertEqual(len(alan.geoms), 2)

    def test_icindeki_ve_kesisen_parseller(self):
        parseller = self.store.listele()
        anahtar = {p["parsel"]: p["key"] for p in parseller}
        o = analiz.ozet({"geojson": self.fc, "gizli": [], "taranan": []}, parseller)
        icinde, kesisen = o["icinde"]["keys"], o["kesisen"]["keys"]
        self.assertEqual(icinde, [anahtar["5"]])                     # 12/5 tamamen 1. etapta
        self.assertEqual(sorted(kesisen), sorted([anahtar["5"], anahtar["1"]]))  # 13/1 2. etaba kısmen giriyor
        self.assertNotIn(anahtar["7"], kesisen)                      # 12/7 dışarıda

    def test_katmanlar(self):
        self.assertEqual(referans.katmanlar(self.fc), [("Deneme OSB", 3)])
        kml = (b'<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Proje</name>'
               b'<Folder><name>KADASTRO</name><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>'
               b'31.3999,41.1999 31.40045,41.1999 31.40045,41.20035 31.3999,41.1999</coordinates></LinearRing>'
               b'</outerBoundaryIs></Polygon></Placemark></Folder>'
               b'<Folder><name>PL</name><Folder><name>ALAN</name><Placemark><Polygon><outerBoundaryIs><LinearRing>'
               b'<coordinates>31.4005,41.1999 31.4008,41.1999 31.4008,41.2002 31.4005,41.1999</coordinates>'
               b'</LinearRing></outerBoundaryIs></Polygon></Placemark></Folder></Folder></Document></kml>')
        fc = referans.dosya_oku("proje.kml", kml)
        self.assertEqual(referans.katmanlar(fc), [("KADASTRO", 1), ("PL / ALAN", 1)])
        self.assertEqual(len(referans.alan(fc).geoms), 2)
        self.assertEqual(referans.alan(fc, ["PL / ALAN"]).geom_type, "Polygon")  # gizli katman hesaba girmez
        self.assertIsNone(referans.alan(fc, ["KADASTRO", "PL / ALAN"]))

    def test_alani_olmayan_referans(self):
        fc = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [31.4, 41.2]}, "properties": {}}]}
        self.assertIsNone(referans.alan(fc))
        with self.assertRaises(ValueError):
            analiz.ozet({"geojson": fc, "gizli": [], "taranan": []}, self.store.listele())

    def test_kayit(self):
        ref_id = self.store.referans_ekle("Deneme OSB", "#2b7bff", self.fc)
        self.store.referans_guncelle(ref_id, gorunur=0, renk="#ff0000", gizli=["PL", "PL"], baska="yok sayılır")
        r = self.store.referans(ref_id)
        self.assertEqual((r["ad"], r["renk"], r["gorunur"], r["gizli"]), ("Deneme OSB", "#ff0000", False, ["PL"]))
        self.assertEqual(len(r["geojson"]["features"]), 3)
        self.assertEqual(self.store.referans_sil(ref_id), 1)
        self.assertEqual(self.store.referanslar(), [])

    def test_bos_dosya_hata_verir(self):
        with self.assertRaises(ValueError):
            referans.dosya_oku("bos.kml", b'<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>')


class _Cevap:
    def __init__(self, durum, govde):
        self.status_code = durum
        self.text = govde if isinstance(govde, str) else json.dumps(govde)

    def json(self):
        return json.loads(self.text)


class _SahteOturum:
    def __init__(self, cevaplar):
        self.cevaplar = list(cevaplar)
        self.istekler = []
        self.headers = {}

    def get(self, adres, timeout=None):
        self.istekler.append(adres)
        return self.cevaplar.pop(0)


class TkgmTest(GeciciStore):
    def setUp(self):
        super().setUp()
        import parselapp.tkgm as t
        self._bekleme, t.BEKLEME_SN = t.BEKLEME_SN, 0

    def tearDown(self):
        import parselapp.tkgm as t
        t.BEKLEME_SN = self._bekleme
        super().tearDown()

    def _parsel_cevabi(self):
        return json.loads(oku("fav_list.json"))["features"][0] | {
            "geometry": {"type": "Polygon", "coordinates": [[[31.401, 41.201], [31.4014, 41.201], [31.4014, 41.2013], [31.401, 41.201]]]}}

    def test_parsel_bir_kez_sorgulanir(self):
        oturum = _SahteOturum([_Cevap(200, self._parsel_cevabi())])
        t = Tkgm(self.store, oturum)
        p, yeni = t.parsel(100, "12", "7")
        self.assertTrue(yeni)
        self.assertEqual(p["kaynak"], "tkgm")
        p2, yeni2 = t.parsel(100, "12", "7")
        self.assertFalse(yeni2)
        self.assertEqual(len(oturum.istekler), 1)
        self.assertTrue(oturum.istekler[0].endswith("/parsel/100/12/7"))
        self.assertEqual(self.store.bugunku_sorgu()["toplam"], 1)

    def test_nokta_sorgusu_kayittaysa_istek_atmaz(self):
        oturum = _SahteOturum([_Cevap(200, self._parsel_cevabi())])
        t = Tkgm(self.store, oturum)
        t.parsel(100, 12, 7)
        p, yeni = t.parsel_noktadan(41.2011, 31.4012)
        self.assertFalse(yeni)
        self.assertEqual(p["parsel"], "7")
        self.assertEqual(len(oturum.istekler), 1)

    def test_limit(self):
        t = Tkgm(self.store, _SahteOturum([_Cevap(403, '"Günlük sorgu limitini aştınız."')]))
        with self.assertRaises(LimitAsildi):
            t.parsel(100, 1, 1)
        self.assertEqual(self.store.bugunku_sorgu(), {"toplam": 1, "limit_hatasi": 1})

    def test_bulunamadi(self):
        t = Tkgm(self.store, _SahteOturum([_Cevap(200, "null")]))
        with self.assertRaises(Bulunamadi):
            t.parsel(100, 1, 999)

    def test_adlar_idari_listeden_duzeltilir(self):
        cevap = self._parsel_cevabi()
        cevap["properties"] = cevap["properties"] | {"ilAd": "Kirşehir", "ilId": 62}
        self.store.idari_kaydet("il", 0, [{"id": 62, "ad": "Kırşehir"}])
        t = Tkgm(self.store, _SahteOturum([_Cevap(200, cevap)]))
        p, _ = t.parsel(100, 12, 7)
        self.assertEqual(p["il"], "Kırşehir")

    def test_liste_gelince_kayitli_adlar_duzelir(self):
        cevap = self._parsel_cevabi()
        cevap["properties"] = cevap["properties"] | {"mahalleAd": "Sinanli"}
        liste = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": None, "properties": {"text": "Sinanlı", "id": 100}}]}
        t = Tkgm(self.store, _SahteOturum([_Cevap(200, cevap), _Cevap(200, liste)]))
        p, _ = t.parsel(100, 12, 7)
        self.assertEqual(p["mahalle"], "Sinanli")
        t.mahalleler(10)
        self.assertEqual(self.store.bul_id(100, "12", "7")["mahalle"], "Sinanlı")

    def test_idari_liste_kaydedilir(self):
        cevap = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": None, "properties": {"text": "Zonguldak", "id": 89}},
            {"type": "Feature", "geometry": None, "properties": {"text": "Adana", "id": 23}}]}
        oturum = _SahteOturum([_Cevap(200, cevap)])
        t = Tkgm(self.store, oturum)
        self.assertEqual(t.iller(), [{"id": 23, "ad": "Adana"}, {"id": 89, "ad": "Zonguldak"}])
        self.assertEqual(t.iller()[0]["ad"], "Adana")
        self.assertEqual(len(oturum.istekler), 1)


if __name__ == "__main__":
    unittest.main()
