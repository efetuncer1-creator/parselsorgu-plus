"""Referans katmanları: OSB sınırı, plan sınırı gibi parsel olmayan KML/KMZ/GeoJSON dosyaları.

Parsel listesine girmez, dışa aktarılmaz; haritada gösterilir ve "içindeki parselleri seç" için
alan olarak kullanılır.
"""

import io
import json
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from shapely.geometry import Polygon, shape
from shapely.ops import polygonize, unary_union

from .importers import _koordinatlar, _yerel


def _kml_metni(ad, icerik):
    if Path(ad).suffix.lower() == ".kmz" or icerik[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(icerik)) as z:
            kmller = [n for n in z.namelist() if n.lower().endswith(".kml")]
            if not kmller:
                raise ValueError("KMZ içinde KML yok")
            ana = "doc.kml" if "doc.kml" in kmller else kmller[0]
            return z.read(ana)
    return icerik


def _geometriler(el):
    """Bir Placemark altındaki geometrileri GeoJSON geometri sözlüklerine çevirir."""
    for g in el.iter():
        tur = _yerel(g.tag)
        if tur == "Polygon":
            halkalar = []
            for sinir in g:
                if _yerel(sinir.tag) in ("outerBoundaryIs", "innerBoundaryIs"):
                    for c in sinir.iter():
                        if _yerel(c.tag) == "coordinates":
                            halka = _koordinatlar(c.text)
                            if len(halka) >= 3:
                                if halka[0] != halka[-1]:
                                    halka.append(halka[0])
                                halkalar.append(halka)
            if halkalar:
                yield {"type": "Polygon", "coordinates": halkalar}
        elif tur == "LineString":
            c = next((x for x in g if _yerel(x.tag) == "coordinates"), None)
            nokta = _koordinatlar(c.text if c is not None else "")
            if len(nokta) >= 2:
                yield {"type": "LineString", "coordinates": nokta}
        elif tur == "Point":
            c = next((x for x in g if _yerel(x.tag) == "coordinates"), None)
            nokta = _koordinatlar(c.text if c is not None else "")
            if nokta:
                yield {"type": "Point", "coordinates": nokta[0]}


def _ad(el):
    return (next((c.text for c in el if _yerel(c.tag) == "name"), None) or "").strip()


def kml_ozellikleri(ad, icerik):
    """Placemark'lar; her birinin katmanı içinde bulunduğu klasör yolu (Netcad katmanları klasör olur)."""
    ozellikler = []

    def gez(el, yol):
        for c in el:
            tur = _yerel(c.tag)
            if tur == "Folder":
                gez(c, yol + [_ad(c) or "Adsız klasör"])
            elif tur in ("Document", "kml"):
                gez(c, yol)
            elif tur == "Placemark":
                for geom in _geometriler(c):
                    ozellikler.append({"type": "Feature", "geometry": geom,
                                       "properties": {"ad": _ad(c), "katman": " / ".join(yol)}})

    gez(ET.fromstring(_kml_metni(ad, icerik)), [])
    return ozellikler


def cizimden(noktalar, ad="Çizim"):
    """Haritaya konan pinlerden ([[boylam, enlem], ...]) referans FeatureCollection'ı."""
    halka = [[round(float(x), 7), round(float(y), 7)] for x, y in noktalar]
    if len(halka) < 3:
        raise ValueError("Alan için en az 3 pin gerekir.")
    if halka[0] != halka[-1]:
        halka.append(halka[0])
    poligon = Polygon(halka)
    if not poligon.is_valid:
        raise ValueError("Çizgiler kendini kesiyor. Pinleri sınır boyunca sırayla yerleştir.")
    if poligon.area == 0:
        raise ValueError("Pinler bir alan oluşturmuyor.")
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [halka]},
         "properties": {"ad": ad, "katman": "Çizim"}}]}


_SINIR = re.compile(r"S[İI]N[İI]R|SNR|HUDUT|BOUNDARY|BORDER", re.I)
_OSB = re.compile(r"OSB|PLANONAMA|ONAMA", re.I)
_INDEKS = re.compile(r"PINDEX|INDEX|PAFTA|GRID|KAROLAJ", re.I)
_ALANLI = ("Polygon", "MultiPolygon", "LineString", "MultiLineString")


def sinir_katmani_oner(fc):
    """Çok katmanlı bir projede alan sınırı olması en muhtemel katman (yoksa None).

    Ad ipuçlarına bakılır: SINIR/SNR/HUDUT (+), OSB/PLANONAMA (+), az sayıda nesne (+),
    pafta indeksi/karolaj (−). Eşitlikte kısa ad seçilir (SNR_OSB > SNR_HESAP_OSB).
    """
    adaylar = {}
    for f in fc["features"]:
        k = (f.get("properties") or {}).get("katman", "")
        if k and f["geometry"]["type"] in _ALANLI:
            adaylar[k] = adaylar.get(k, 0) + 1
    if len({(f.get("properties") or {}).get("katman", "") for f in fc["features"]}) < 2:
        return None

    def puan(k):
        p = 3 * bool(_SINIR.search(k)) + 2 * bool(_OSB.search(k)) + (adaylar[k] <= 3) - 5 * bool(_INDEKS.search(k))
        return p, -len(k)

    en_iyi = max(adaylar, key=puan, default=None)
    if en_iyi is None or puan(en_iyi)[0] < 3 or alan(fc, hesap_katmani=en_iyi) is None:
        return None
    return en_iyi


def katmanlar(fc):
    """[(katman adı, nesne sayısı), ...] dosyadaki sırayla."""
    sayac = {}
    for f in fc["features"]:
        k = (f.get("properties") or {}).get("katman", "")
        sayac[k] = sayac.get(k, 0) + 1
    return list(sayac.items())


def dosya_oku(ad, icerik):
    """Dosyayı GeoJSON FeatureCollection'a çevirir."""
    uz = Path(ad).suffix.lower()
    if uz in (".kml", ".kmz"):
        ozellikler = kml_ozellikleri(ad, icerik)
    elif uz in (".json", ".geojson"):
        veri = json.loads(icerik.decode("utf-8-sig"))
        if veri.get("type") == "FeatureCollection":
            ozellikler = veri.get("features") or []
        elif veri.get("type") == "Feature":
            ozellikler = [veri]
        else:
            ozellikler = [{"type": "Feature", "geometry": veri, "properties": {}}]
    else:
        raise ValueError(f"Desteklenmeyen dosya türü: {ad}")
    ozellikler = [f for f in ozellikler if f.get("geometry")]
    for f in ozellikler:
        props = f.setdefault("properties", {}) or {}
        f["properties"] = props
        props.setdefault("katman", str(props.get("layer") or props.get("Layer") or ""))
    if not ozellikler:
        raise ValueError("Dosyada çizilebilecek geometri bulunamadı")
    return {"type": "FeatureCollection", "features": ozellikler}


def alan(fc, gizli=(), hesap_katmani=None):
    """Referansın alan geometrisi (shapely). Poligonlar + kapalı çizgilerden oluşan sınırlar.

    Netcad gibi programlar sınırı kapalı çizgi olarak çıkarabiliyor; bunlar alana çevrilir.
    hesap_katmani verilirse sadece o katman kullanılır (görünürlüğünden bağımsız); verilmezse
    gizli olmayan bütün katmanlar. Alan yoksa None.
    """
    gizli = set(gizli)
    poligonlar, cizgiler = [], []
    for f in fc["features"]:
        katman = (f.get("properties") or {}).get("katman", "")
        if (katman != hesap_katmani) if hesap_katmani is not None else (katman in gizli):
            continue
        g = shape(f["geometry"])
        if g.geom_type in ("Polygon", "MultiPolygon"):
            poligonlar.append(g.buffer(0))  # kendini kesen halkaları düzeltir
        elif g.geom_type in ("LineString", "MultiLineString"):
            cizgiler.append(g)
    if cizgiler:
        poligonlar.extend(polygonize(unary_union(cizgiler)))
    if not poligonlar:
        return None
    return unary_union(poligonlar)


# TKGM koordinatları 5 basamak (~1 m); sınırdaki parsellerin yanlışlıkla dışarıda
# kalmaması için oranlarda küçük pay bırakılır.
ICINDE_ORAN = 0.98
KESISEN_ORAN = 0.01


# ---- görünüm (Görsel sekmesi) ----------------------------------------------------
# Kayıtta olmayan ayar varsayılanla tamamlanır; böylece eski kayıtlar da sonradan eklenen ayarlar da çalışır.

# katman_opaklik: bütün katmanın (kenar, tarama, ad) opaklığı; opaklik yalnız taramanınki
GORSEL = {"kalinlik": 3, "cizgi": "kesik", "desen": "capraz", "aralik": 9, "opaklik": 55, "etiket": True, "katman_opaklik": 100}
CIZGILER = ("duz", "kesik", "nokta")
DESENLER = ("yok", "dolu", "capraz", "ters", "yatay", "dikey", "kareli", "capraz-kareli", "nokta")
_GORSEL_SAYILAR = {"kalinlik": (0, 10, 0.5), "aralik": (4, 24, 1), "opaklik": (5, 100, 1), "katman_opaklik": (5, 100, 1)}
_RENK = re.compile(r"#[0-9a-fA-F]{6}")


def renk_duzelt(renk):
    if not isinstance(renk, str) or not _RENK.fullmatch(renk):
        raise ValueError("Renk #RRGGBB biçiminde olmalı.")
    return renk.lower()


def gorsel_duzelt(g):
    """İstemciden gelen görünümü doğrular: eksik ayar varsayılan olur, sayılar sınırlarına çekilir."""
    if not isinstance(g, dict):
        raise ValueError("Görünüm ayarları okunamadı.")
    sonuc = dict(GORSEL)
    for ad, (alt, ust, adim) in _GORSEL_SAYILAR.items():
        if ad not in g:
            continue
        deger = g[ad]
        if isinstance(deger, bool) or not isinstance(deger, (int, float)) or not math.isfinite(deger):
            raise ValueError(f"Görünüm ayarı sayı olmalı: {ad}")
        deger = round(min(ust, max(alt, deger)) / adim) * adim
        sonuc[ad] = int(deger) if float(deger).is_integer() else deger
    for ad, secenekler in (("cizgi", CIZGILER), ("desen", DESENLER)):
        if ad in g:
            if g[ad] not in secenekler:
                raise ValueError(f"Bilinmeyen {ad}: {g[ad]!r}")
            sonuc[ad] = g[ad]
    if "etiket" in g:
        if not isinstance(g["etiket"], bool):
            raise ValueError("etiket true ya da false olmalı.")
        sonuc["etiket"] = g["etiket"]
    return sonuc


def gorsel_oku(metin):
    """Kayıttaki görünüm. Bozuk bir değer varsayılana döner; alan yine açılır."""
    try:
        return gorsel_duzelt(json.loads(metin or "{}"))
    except ValueError:
        return dict(GORSEL)
