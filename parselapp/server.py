"""Yerel sunucu: harita ekranını ve JSON uç noktalarını sunar.

Çalıştırma:  python -m parselapp.server   (ya da baslat.bat)
Sadece 127.0.0.1'i dinler; ağdaki başka cihazlar erişemez.
"""

import argparse
import json
import mimetypes
import os
import re
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from . import analiz, coords, exporters, guncelleme, proje, referans, surum, tablo
from .importers import ice_aktar
from .store import Store
from .tkgm import Bulunamadi, LimitAsildi, Tkgm, TkgmHatasi

if getattr(sys, "frozen", False):
    # Kurulum paketi (PyInstaller): arayüz paketin içinde, veri kullanıcının kendi klasöründe
    # (Program Files yazılamaz).
    KOK = Path(sys._MEIPASS)
    VERI_KLASORU = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ParselSorguPlus"
else:
    KOK = Path(__file__).resolve().parent.parent
    VERI_KLASORU = KOK / "data"
WEB = KOK / "web"
VERI = VERI_KLASORU / "parseller.db"

# Alan renkleri: parsel sarısı, seçim mavisi ve boşluk kırmızısıyla karışmayanlar, sırayla verilir.
REFERANS_RENKLERI = ("#bf5af2", "#64d2ff", "#ff9f0a", "#30d158", "#ff375f", "#ac8e68")


def ozellik(p):
    """Kayıt -> GeoJSON Feature (ham alanlar hariç)."""
    props = {k: v for k, v in p.items() if k not in ("geometri", "ham")}
    return {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": p["geometri"]},
            "properties": props}


class Hata(Exception):
    def __init__(self, durum, mesaj):
        super().__init__(mesaj)
        self.durum = durum


class Uygulama:
    def __init__(self, store):
        self.store = store
        self.tkgm = Tkgm(store)
        self.guncelleme = guncelleme.Denetci(surum.SURUM)  # sunucu açılınca baslat(); yoksa ilk istekte

    # Her uç nokta (yöntem, yol parçaları) ile seçilir.
    def yonlendir(self, yontem, parcalar, govde, basliklar):
        match (yontem, parcalar):
            # Oturum: ekranda görünen parseller ve alanlar sadece o sayfa açıkken yaşar.
            # Parseller ayrıca önbellekte kalır; tekrar sorgulanınca TKGM'ye gidilmez.
            case ("POST", ["oturum", "yeni"]):
                return {"temizlenen_alan": self.store.referanslari_temizle()}
            case ("POST", ["parseller", "getir"]):
                keys = _json(govde).get("keys") or []
                return {"type": "FeatureCollection", "features": [ozellik(p) for p in self.store.listele(keys)]}
            case ("GET", ["sayac"]):
                return self.store.bugunku_sorgu()
            case ("GET", ["guncelleme"]):
                return self.guncelleme.sonuc()
            case ("GET", ["iller"]):
                return self._tkgm(self.tkgm.iller)
            case ("GET", ["ilceler", il_id]):
                return self._tkgm(self.tkgm.ilceler, int(il_id))
            case ("GET", ["mahalleler", ilce_id]):
                return self._tkgm(self.tkgm.mahalleler, int(ilce_id))
            case ("POST", ["sorgu"]):
                g = _json(govde)
                p, yeni = self._tkgm(self.tkgm.parsel, g["mahalleId"], g["ada"], g["parsel"], bool(g.get("yenile")))
                return {"parsel": ozellik(p), "tkgmdenGeldi": yeni}
            case ("POST", ["sorgu-nokta"]):
                g = _json(govde)
                p, yeni = self._tkgm(self.tkgm.parsel_noktadan, g["enlem"], g["boylam"], bool(g.get("yenile")))
                return {"parsel": ozellik(p), "tkgmdenGeldi": yeni}
            case ("POST", ["ice-aktar"]):
                ad = unquote(basliklar.get("X-Dosya-Adi", "dosya.kml"))
                try:
                    return ice_aktar(self.store, ad, govde, basliklar.get("X-Dosya-Tarih") or None)
                except Exception as e:
                    raise Hata(HTTPStatus.BAD_REQUEST, f"{ad} okunamadı: {e}") from e
            case ("POST", ["tablo-excel"]):
                g = _json(govde)
                try:
                    veri = exporters.tablo_excel(g.get("sayfalar"))
                except ValueError as e:
                    raise Hata(HTTPStatus.BAD_REQUEST, str(e)) from e
                ad = re.sub(r'[\\/:*?"<>|]+', "-", str(g.get("dosyaAdi") or "analiz"))[:80] or "analiz"
                return _Dosya(veri, f"{ad}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            case ("POST", ["disa-aktar"]):
                return self._disa_aktar(_json(govde))
            case ("GET", ["referanslar"]):
                return self.store.referanslar()
            case ("POST", ["proje", "yukle"]):
                # Proje dosyasındaki parseller ve alanlar; dosyanın geri kalanını tarayıcı kurar.
                g = _json(govde)
                try:
                    sonuc = proje.yukle(self.store, g.get("parseller") or [], g.get("alanlar") or [])
                except ValueError as e:
                    raise Hata(HTTPStatus.BAD_REQUEST, str(e)) from e
                return {"keys": sonuc["keys"], "alanlar": [self.store.referans(i) for i in sonuc["alanlar"]]}
            case ("POST", ["izgara"]):
                return self._izgara(_json(govde))
            case ("POST", ["tablo-oku"]):
                ad = unquote(basliklar.get("X-Dosya-Adi", "tablo.xlsx"))
                try:
                    return tablo.oku(ad, govde)
                except ValueError as e:
                    raise Hata(HTTPStatus.BAD_REQUEST, str(e)) from e
            case ("POST", ["referanslar"]):
                return self._referans_ekle(govde, basliklar)
            case ("POST", ["referanslar", "cizim"]):
                g = _json(govde)
                ad = (g.get("ad") or "").strip() or f"Çizim {len(self.store.referanslar()) + 1}"
                try:
                    fc = referans.cizimden(g["noktalar"], ad)
                except ValueError as e:
                    raise Hata(HTTPStatus.BAD_REQUEST, str(e)) from e
                return self.store.referans(self.store.referans_ekle(ad, self._yeni_renk(), fc))
            case ("POST", ["referanslar", ref_id, "ozet"]):
                keys = _json(govde).get("keys") or []
                return self._analiz(analiz.ozet, self._referans_al(ref_id), self.store.listele(keys))
            case ("POST", ["referanslar", ref_id, "tara"]):
                keys = _json(govde).get("keys") or []
                sonuc = self._tkgm(self._analiz, analiz.tara_adim, self.store, self.tkgm, self._referans_al(ref_id), keys)
                if "parsel" in sonuc:
                    sonuc["parsel"] = ozellik(sonuc["parsel"])
                return sonuc
            case ("POST", ["referanslar", ref_id, "alan-ici"]):
                # Analiz sekmesi: alana değen (ya da kapsam "icinde" ise tamamen içinde kalan) parsellerin
                # alan içindeki m² ve oranı; eşikler alan özetindekilerle aynı.
                g = _json(govde)
                esik = referans.ICINDE_ORAN if g.get("kapsam") == "icinde" else referans.KESISEN_ORAN
                sonuc = self._analiz(analiz.alan_ici_m2, self._referans_al(ref_id), self.store.listele(g.get("keys") or []))
                return {k: [round(m2, 2), round(oran, 4)] for k, (m2, oran) in sonuc.items() if oran >= esik}
            case ("POST", ["referanslar", ref_id, "tarama-sifirla"]):
                self.store.referans_tarama_sifirla(int(ref_id))
                return self._referans_al(ref_id)
            case ("POST", ["referanslar", ref_id, "guncelle"]):
                g = _json(govde)
                try:
                    renk = None if g.get("renk") is None else referans.renk_duzelt(g["renk"])
                    gorsel = None if g.get("gorsel") is None else referans.gorsel_duzelt(g["gorsel"])
                except ValueError as e:
                    raise Hata(HTTPStatus.BAD_REQUEST, str(e)) from e
                self.store.referans_guncelle(int(ref_id), ad=g.get("ad"), renk=renk, gizli=g.get("gizli"),
                                             hesap_katmani=g.get("hesapKatmani"), gorsel=gorsel,
                                             gorunur=None if g.get("gorunur") is None else int(bool(g["gorunur"])))
                return self._referans_al(ref_id)
            case ("POST", ["referanslar", ref_id, "sil"]):
                return {"silinen": self.store.referans_sil(int(ref_id))}
        raise Hata(HTTPStatus.NOT_FOUND, "Bilinmeyen adres")

    def _izgara(self, g):
        """Çıktı sayfasındaki koordinat ızgarası. bbox: [batı, güney, doğu, kuzey] (WGS84)."""
        try:
            bati, guney, dogu, kuzey = (float(v) for v in g["bbox"])
            sistem = g.get("sistem", "itrf96")
            dom = int(g["dilim"]) if g.get("dilim") not in (None, "", "otomatik") else None
            if sistem not in coords.SISTEMLER or (dom is not None and dom not in coords.DILIMLER):
                raise ValueError
            if not (bati < dogu and guney < kuzey and 25 <= bati and dogu <= 46 and 35 <= guney and kuzey <= 43):
                raise ValueError
        except (KeyError, TypeError, ValueError) as e:
            raise Hata(HTTPStatus.BAD_REQUEST, "Izgara için Türkiye içinde geçerli bir alan gerekli.") from e
        return coords.izgara(bati, guney, dogu, kuzey, sistem, dom)

    def _referans_al(self, ref_id):
        r = self.store.referans(int(ref_id), dokun=True)
        if not r:
            raise Hata(HTTPStatus.NOT_FOUND, "Referans bulunamadı.")
        return r

    def _referans_ekle(self, govde, basliklar):
        ad = unquote(basliklar.get("X-Dosya-Adi", "referans.kml"))
        try:
            fc = referans.dosya_oku(ad, govde)
        except Exception as e:
            raise Hata(HTTPStatus.BAD_REQUEST, f"{ad} okunamadı: {e}") from e
        ref_id = self.store.referans_ekle(Path(ad).stem, self._yeni_renk(), fc, referans.sinir_katmani_oner(fc))
        return self.store.referans(ref_id)

    def _yeni_renk(self):
        return REFERANS_RENKLERI[len(self.store.referanslar()) % len(REFERANS_RENKLERI)]

    @staticmethod
    def _analiz(fonk, *args):
        try:
            return fonk(*args)
        except ValueError as e:
            raise Hata(HTTPStatus.BAD_REQUEST, str(e)) from e

    def _tkgm(self, fonk, *args):
        try:
            return fonk(*args)
        except LimitAsildi as e:
            raise Hata(HTTPStatus.TOO_MANY_REQUESTS, str(e)) from e
        except Bulunamadi as e:
            raise Hata(HTTPStatus.NOT_FOUND, str(e)) from e
        except TkgmHatasi as e:
            raise Hata(HTTPStatus.BAD_GATEWAY, str(e)) from e

    def _disa_aktar(self, g):
        parseller = self.store.listele(g.get("keys") or [])
        if not parseller:
            raise Hata(HTTPStatus.BAD_REQUEST, "Dışa aktarılacak parsel seçilmedi.")
        bicim = g.get("bicim", "kml")
        ref = self._referans_al(g["referansId"]) if g.get("referansId") else None
        if bicim == "kml":
            if g.get("ayriDosyalar") and len(parseller) > 1:
                return _Dosya(exporters.kml_ayri_zip(parseller), exporters.dosya_adi(parseller, ".zip"),
                              "application/zip")
            return _Dosya(exporters.kml(parseller, referans=ref), exporters.dosya_adi(parseller, ".kml"),
                          "application/vnd.google-earth.kml+xml")
        if bicim == "excel":
            alan_ici = self._analiz(analiz.alan_ici_m2, ref, parseller) if ref else None
            try:
                veri, _ = exporters.excel(parseller, g.get("sistem", "itrf96"), g.get("dilim", "otomatik"),
                                          alan_ici, ref["ad"] if ref else None)
            except ValueError as e:
                raise Hata(HTTPStatus.BAD_REQUEST, str(e)) from e
            return _Dosya(veri, exporters.dosya_adi(parseller, ".xlsx"),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        raise Hata(HTTPStatus.BAD_REQUEST, f"Bilinmeyen biçim: {bicim}")


class _Dosya:
    def __init__(self, veri, ad, tur):
        self.veri, self.ad, self.tur = veri, ad, tur


def _json(govde):
    try:
        return json.loads(govde or b"{}")
    except ValueError as e:
        raise Hata(HTTPStatus.BAD_REQUEST, "Geçersiz JSON") from e


def isleyici(uygulama):
    class Isleyici(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # konsolu sessiz tut

        def do_GET(self):
            self._isle("GET")

        def do_POST(self):
            self._isle("POST")

        def _isle(self, yontem):
            yol = urlparse(self.path).path
            if yol.startswith("/api/"):
                return self._api(yontem, yol)
            if yontem == "GET":
                return self._statik(yol)
            self._yanit(HTTPStatus.METHOD_NOT_ALLOWED, b"", "text/plain")

        def _api(self, yontem, yol):
            uzunluk = int(self.headers.get("Content-Length") or 0)
            govde = self.rfile.read(uzunluk) if uzunluk else b""
            parcalar = [unquote(p) for p in yol[len("/api/"):].strip("/").split("/") if p]
            try:
                sonuc = uygulama.yonlendir(yontem, parcalar, govde, self.headers)
            except Hata as e:
                return self._json(e.durum, {"hata": str(e)})
            except (KeyError, ValueError, TypeError) as e:
                return self._json(HTTPStatus.BAD_REQUEST, {"hata": f"Eksik ya da hatalı bilgi: {e}"})
            if isinstance(sonuc, _Dosya):
                ad = quote(sonuc.ad)
                return self._yanit(HTTPStatus.OK, sonuc.veri, sonuc.tur,
                                   {"Content-Disposition": f"attachment; filename*=UTF-8''{ad}"})
            self._json(HTTPStatus.OK, sonuc)

        def _statik(self, yol):
            hedef = (WEB / (yol.lstrip("/") or "index.html")).resolve()
            if not hedef.is_relative_to(WEB) or not hedef.is_file():
                return self._yanit(HTTPStatus.NOT_FOUND, "Bulunamadı".encode(), "text/plain; charset=utf-8")
            tur = mimetypes.guess_type(hedef.name)[0] or "application/octet-stream"
            if tur.startswith("text/") or tur.endswith("javascript"):
                tur += "; charset=utf-8"
            self._yanit(HTTPStatus.OK, hedef.read_bytes(), tur, {"Cache-Control": "no-cache"})

        def _json(self, durum, veri):
            self._yanit(durum, json.dumps(veri, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8")

        def _yanit(self, durum, veri, tur, ek=None):
            self.send_response(durum)
            self.send_header("Content-Type", tur)
            self.send_header("Content-Length", str(len(veri)))
            for k, v in (ek or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(veri)

    return Isleyici


class Sunucu(ThreadingHTTPServer):
    # Windows'ta SO_REUSEADDR aynı portu ikinci bir sunucunun da açmasına izin veriyor; o zaman
    # istekler eski ve yeni sunucu arasında bölünür (9 Ekim 2026'da bir alanın silinmesine yol açtı).
    allow_reuse_address = os.name != "nt"


def main():
    ap = argparse.ArgumentParser(description="Parsel Sorgu + yerel sunucusu")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--veri", default=str(VERI), help="SQLite dosyası")
    ap.add_argument("--tarayici-acma", action="store_true", help="Tarayıcıyı otomatik açma")
    a = ap.parse_args()

    adres = f"http://127.0.0.1:{a.port}/"
    try:
        uyg = Uygulama(Store(a.veri))
        sunucu = Sunucu(("127.0.0.1", a.port), isleyici(uyg))
    except OSError:
        # Uygulama zaten açık: ikinci sunucu başlatma, açık olanı tarayıcıda göster.
        print(f"Parsel Sorgu + zaten çalışıyor: {adres}")
        if not a.tarayici_acma:
            webbrowser.open(adres)
        return
    print(f"Parsel Sorgu + çalışıyor: {adres}  (kapatmak için Ctrl+C)")
    uyg.guncelleme.baslat()
    if not a.tarayici_acma:
        threading.Timer(0.8, webbrowser.open, (adres,)).start()
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
