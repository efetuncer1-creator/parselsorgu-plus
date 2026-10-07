"""Koordinat dönüşümleri: WGS84 -> ITRF96 3° (TUREF) ve ED50 3°.

Dilimler (orta meridyen, DOM): 27, 30, 33, 36, 39, 42, 45.
Y = sağa (doğu), X = yukarı (kuzey); Türkiye'deki alışkanlıkla aynı.
"""

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
