"""Koordinat dönüşümleri: WGS84 -> ITRF96 3° (TUREF) ve ED50 3°.

Dilimler (orta meridyen, DOM): 27, 30, 33, 36, 39, 42, 45.
Y = sağa (doğu), X = yukarı (kuzey); Türkiye'deki alışkanlıkla aynı.
"""

import math
from functools import lru_cache

from pyproj import Transformer
from pyproj.aoi import AreaOfInterest
from shapely.ops import transform as shapely_transform

DILIMLER = (27, 30, 33, 36, 39, 42, 45)

SISTEMLER = {
    # TUREF, ITRF96 gerçekleştirmesidir; TKGM'nin ITRF96 3° dilimleri bunlar.
    "itrf96": {"ad": "ITRF96 3°", "epsg": {27: 5253, 30: 5254, 33: 5255, 36: 5256, 39: 5257, 42: 5258, 45: 5259}},
    "ed50": {"ad": "ED50 3°", "epsg": {27: 2319, 30: 2320, 33: 2321, 36: 2322, 39: 2323, 42: 2324, 45: 2325}},
}

# Türkiye sınırları; ED50 için pyproj'un Türkiye parametrelerini seçmesini sağlar.
_TURKIYE = AreaOfInterest(west_lon_degree=25.6, south_lat_degree=35.8, east_lon_degree=44.8, north_lat_degree=42.2)


def dilim_sec(lon):
    """Boylama en yakın 3° orta meridyen."""
    dom = int(round(lon / 3.0)) * 3
    return min(max(dom, DILIMLER[0]), DILIMLER[-1])


@lru_cache(maxsize=None)
def _transformer(sistem, dom):
    epsg = SISTEMLER[sistem]["epsg"][dom]
    return Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True, area_of_interest=_TURKIYE)


def epsg_kodu(sistem, dom):
    return SISTEMLER[sistem]["epsg"][dom]


def donustur(lon, lat, sistem, dom):
    """(boylam, enlem) -> (Y, X)."""
    return _transformer(sistem, dom).transform(lon, lat)


def donustur_halka(ring, sistem, dom):
    t = _transformer(sistem, dom)
    return [t.transform(lon, lat) for lon, lat in ring]



@lru_cache(maxsize=None)
def _geri_transformer(dom):
    return Transformer.from_crs(f"EPSG:{epsg_kodu('itrf96', dom)}", "EPSG:4326", always_xy=True)


def metrik(geom, dom):
    """Shapely geometrisini (boylam/enlem) ITRF96 dilim düzlemine (metre) çevirir."""
    return shapely_transform(_transformer("itrf96", dom).transform, geom)


def cografi(geom, dom):
    """metrik()'in tersi: metre -> boylam/enlem."""
    return shapely_transform(_geri_transformer(dom).transform, geom)


# ---- çıktı sayfası için koordinat ızgarası --------------------------------------------

IZGARA_ARALIKLARI = (10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000)


@lru_cache(maxsize=None)
def _cografyaya(sistem, dom):
    epsg = SISTEMLER[sistem]["epsg"][dom]
    return Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True, area_of_interest=_TURKIYE)


def izgara(bati, guney, dogu, kuzey, sistem="itrf96", dom=None, en_cok=6):
    """Coğrafi kutuyu kesen yuvarlak Y (doğu) ve X (kuzey) değerlerindeki çizgiler.

    Aralık, kısa kenara en fazla `en_cok` çizgi düşecek en küçük yuvarlak değerdir. Çizgiler dilim
    düzleminde düzdür, haritada hafif eğridir; bu yüzden ara noktalarla [boylam, enlem] olarak döner.
    """
    dom = dom or dilim_sec((bati + dogu) / 2)
    ileri, geri = _transformer(sistem, dom), _cografyaya(sistem, dom)
    koseler = [ileri.transform(x, y) for x, y in ((bati, guney), (bati, kuzey), (dogu, guney), (dogu, kuzey))]
    y0, y1 = min(k[0] for k in koseler), max(k[0] for k in koseler)
    x0, x1 = min(k[1] for k in koseler), max(k[1] for k in koseler)
    kisa = min(y1 - y0, x1 - x0)
    aralik = next((a for a in IZGARA_ARALIKLARI if kisa / a <= en_cok), IZGARA_ARALIKLARI[-1])

    def degerler(alt, ust):
        d = math.ceil(alt / aralik) * aralik
        while d <= ust:
            yield d
            d += aralik

    def cizgi(noktalar):
        return [[round(lon, 7), round(lat, 7)] for lon, lat in (geri.transform(y, x) for y, x in noktalar)]

    adim = 16
    return {
        "sistem": SISTEMLER[sistem]["ad"], "dom": dom, "aralik": aralik,
        "yler": [{"deger": y, "noktalar": cizgi((y, x0 + (x1 - x0) * i / adim) for i in range(adim + 1))} for y in degerler(y0, y1)],
        "xler": [{"deger": x, "noktalar": cizgi((y0 + (y1 - y0) * i / adim, x) for i in range(adim + 1))} for x in degerler(x0, x1)],
    }
