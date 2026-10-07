"""TKGM MEGSİS servisine bağlanan TEK dosya.

TKGM servisinde bir şey değişirse düzeltilecek yer burası. Adresler parselsorgu.tkgm.gov.tr
web uygulamasının kullandıklarıyla aynı.

Servis IP başına günlük sorgu limiti uyguluyor; aşılınca 403 ve
"Günlük sorgu limitini aştınız." dönüyor. Her istek kayda yazılır, sayaç oradan okunur.
"""

import threading
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .importers import geometri_coz, tkgm_ozellik

API = "https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api"
BEKLEME_SN = 1.5  # ardışık istekler arasında en az bu kadar beklenir

_BASLIKLAR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://parselsorgu.tkgm.gov.tr/",
    "Origin": "https://parselsorgu.tkgm.gov.tr",
}


class TkgmHatasi(Exception):
    pass


class LimitAsildi(TkgmHatasi):
    pass


class Bulunamadi(TkgmHatasi):
    pass


class Tkgm:
    def __init__(self, store, oturum=None):
        self.store = store
        if oturum is None:
            oturum = requests.Session()
            # Boşta kalan bağlantıyı TKGM kapatınca ilk istek düşüyordu; bağlantı hatalarında
            # yeniden dene. Sadece bağlantı/okuma hatası: 403 gibi cevaplar tekrarlanmaz.
            tekrar = Retry(total=2, connect=2, read=1, status=0, backoff_factor=0.5,
                           allowed_methods=["GET"], raise_on_status=False)
            oturum.mount("https://", HTTPAdapter(max_retries=tekrar))
        self.oturum = oturum
        self.oturum.headers.update(_BASLIKLAR)
        self._kilit = threading.Lock()
        self._son = 0.0

    def _get(self, yol):
        adres = f"{API}/{yol}"
        with self._kilit:
            bekle = self._son + BEKLEME_SN - time.monotonic()
            if bekle > 0:
                time.sleep(bekle)
            try:
                r = self.oturum.get(adres, timeout=30)
            except requests.RequestException as e:
                self.store.sorgu_yaz(adres, None)
                raise TkgmHatasi(f"TKGM'ye bağlanılamadı: {e}") from e
            finally:
                self._son = time.monotonic()
        self.store.sorgu_yaz(adres, r.status_code)
        if r.status_code == 403 and "limit" in r.text.lower():
            raise LimitAsildi("TKGM günlük sorgu limiti doldu. Yarın tekrar deneyin.")
        if r.status_code == 404 or not r.text.strip() or r.text.strip() == "null":
            raise Bulunamadi("Parsel bulunamadı.")
        if r.status_code != 200:
            raise TkgmHatasi(f"TKGM hata döndürdü ({r.status_code}): {r.text[:200]}")
        try:
            return r.json()
        except ValueError as e:
            raise TkgmHatasi(f"TKGM cevabı okunamadı: {r.text[:200]}") from e

    # ---- idari yapı (kayıtta tutulur, bir kez çekilir) ------------------------

    def _idari(self, tur, yol, ust_id, yenile):
        if not yenile:
            kayitli = self.store.idari_al(tur, ust_id)
            if kayitli is not None:
                return kayitli
        veri = self._get(yol)
        liste = sorted(
            ({"id": f["properties"]["id"], "ad": f["properties"]["text"]} for f in veri.get("features", [])),
            key=lambda x: x["ad"])
        self.store.idari_kaydet(tur, ust_id, liste)
        return liste

    def iller(self, yenile=False):
        return self._idari("il", "idariYapi/ilListe", 0, yenile)

    def ilceler(self, il_id, yenile=False):
        return self._idari("ilce", f"idariYapi/ilceListe/{int(il_id)}", int(il_id), yenile)

    def mahalleler(self, ilce_id, yenile=False):
        return self._idari("mahalle", f"idariYapi/mahalleListe/{int(ilce_id)}", int(ilce_id), yenile)

    # ---- parsel ---------------------------------------------------------------

    def _parsel_kaydet(self, veri):
        if not isinstance(veri, dict) or "properties" not in veri:
            raise Bulunamadi("Parsel bulunamadı.")
        kayit = tkgm_ozellik(veri["properties"])
        kayit["geometri"] = geometri_coz(veri.get("geometry"))
        if not kayit["geometri"]:
            raise Bulunamadi("Parselin geometrisi yok.")
        self.store.kaydet(kayit, "tkgm")
        return self.store.bul_id(kayit["mahalle_id"], kayit["ada"], kayit["parsel"])

    def parsel(self, mahalle_id, ada, parsel, yenile=False):
        """Önce kayda bakar; yoksa (ya da yenile=True ise) TKGM'den çeker."""
        if not yenile:
            kayitli = self.store.bul_id(int(mahalle_id), str(ada), str(parsel))
            if kayitli:
                return kayitli, False
        veri = self._get(f"parsel/{int(mahalle_id)}/{int(ada)}/{int(parsel)}")
        return self._parsel_kaydet(veri), True

    def parsel_noktadan(self, enlem, boylam, yenile=False):
        """Haritada tıklanan noktadaki parsel. Nokta kayıtlı bir parselin içindeyse sorgu harcanmaz."""
        if not yenile:
            kayitli = self.store.noktadaki(float(boylam), float(enlem))
            if kayitli:
                return kayitli, False
        veri = self._get(f"parsel/{float(enlem):.6f}/{float(boylam):.6f}/")
        return self._parsel_kaydet(veri), True
