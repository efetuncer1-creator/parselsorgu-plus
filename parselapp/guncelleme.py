"""Yeni sürüm denetimi: GitHub'daki son sürümle karşılaştırılır.

Uygulama kendini güncellemez; yeni sürüm varsa açılışta kullanıcıya söylenir, kurulum dosyasını indirir.
Denetim sunucu açılınca bir kez yapılır, sonucu süreç boyunca saklanır. İnternet yoksa ya da GitHub
yanıt vermezse sessizce geçilir (uyarı çıkmaz).
"""

import json
import re
import threading
import urllib.request

DEPO = "efetuncer1-creator/parselsorgu-plus"
SON_SURUM = f"https://api.github.com/repos/{DEPO}/releases/latest"
SURUMLER = f"https://github.com/{DEPO}/releases/latest"


def parcalar(surum):
    """"v0.2.0" -> (0, 2, 0); sürüme benzemiyorsa None."""
    m = re.match(r"^v?(\d+)\.(\d+)(?:\.(\d+))?", str(surum or "").strip())
    return tuple(int(x or 0) for x in m.groups()) if m else None


def _getir(adres, zaman_asimi=5):
    istek = urllib.request.Request(adres, headers={
        "Accept": "application/vnd.github+json", "User-Agent": "ParselSorguPlus-guncelleme"})
    with urllib.request.urlopen(istek, timeout=zaman_asimi) as r:
        return json.load(r)


def denetle(simdiki, getir=_getir):
    """Dönüş: {"surum", "son", "yeni", "baslik", "indir", "sayfa"}; denetlenemediyse "son" yok."""
    sonuc = {"surum": simdiki, "yeni": False}
    if not parcalar(simdiki):
        return sonuc  # kaynaktan çalışıyor: denetlenmez
    try:
        r = getir(SON_SURUM)
    except (OSError, ValueError):
        return sonuc
    son = parcalar(r.get("tag_name"))
    if not son:
        return sonuc
    kurulum = next((a.get("browser_download_url") for a in r.get("assets") or []
                    if str(a.get("name", "")).lower().endswith(".exe")), None)
    sayfa = r.get("html_url") or SURUMLER
    baslik = str(r.get("name") or "")[:120]
    sonuc.update({
        "son": ".".join(map(str, son)), "yeni": son > parcalar(simdiki),
        "baslik": "" if parcalar(baslik) else baslik,  # adı yalnızca "v0.1.1" ise tekrar yazılmaz
        "sayfa": sayfa, "indir": kurulum or sayfa,
    })
    return sonuc


class Denetci:
    """Denetimi bir kez, arka planda yapar; sonuç hazır olana kadar bekleyen istek en çok birkaç saniye bekler."""

    def __init__(self, simdiki, getir=_getir):
        self._sonuc = None
        self._hazir = threading.Event()
        self._kilit = threading.Lock()
        self._is = threading.Thread(target=self._calis, args=(simdiki, getir), daemon=True)

    def _calis(self, simdiki, getir):
        try:
            self._sonuc = denetle(simdiki, getir)
        finally:
            self._hazir.set()

    def baslat(self):
        with self._kilit:
            if self._is.ident is None:
                self._is.start()
        return self

    def sonuc(self, bekle=8):
        self.baslat()
        self._hazir.wait(bekle)
        return self._sonuc or {"yeni": False}
