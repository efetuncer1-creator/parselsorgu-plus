"""Mevcut dosyalardan parsel içe aktarma.

Desteklenen biçimler:
- Alan Yöneticisi (cadplugin) KML'i: bilgiler SimpleData içindeki HTML tabloda.
- parselsorgu.tkgm.gov.tr KML'i ve bu uygulamanın KML çıktısı: ExtendedData/Data alanları.
- GeoJSON: TKGM servis cevabı, parselsorgu "fav_list.json" (koordinatları {"0":..} sözlüğü
  olarak yazılmış hâli dahil).
"""

import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

from .util import norm, parcel_key

UZANTILAR = (".kml", ".json", ".geojson")

# KML / HTML etiketleri -> kayıt alanları
_ETIKETLER = {
    "il": "il", "ilce": "ilce", "ilçe": "ilce", "mahalle": "mahalle",
    "ada": "ada", "parsel": "parsel", "parselno": "parsel", "parsel no": "parsel",
    "alan": "alan", "tapu alanı": "alan", "tapu alani": "alan",
    "nitelik": "nitelik", "mevkii": "mevkii", "mevki": "mevkii", "pafta": "pafta",
    "zemin": "zemin", "zemin durumu": "zemin",
    "mahalle_id": "mahalle_id",
}


def _alan_adi(etiket):
    return _ETIKETLER.get(norm(html.unescape(etiket)))


def _yerel(tag):
    return tag.rsplit("}", 1)[-1]


def _cocuklar(el, ad):
    return [c for c in el.iter() if _yerel(c.tag) == ad]


def _koordinatlar(metin):
    nokta = []
    for parca in (metin or "").split():
        p = parca.split(",")
        if len(p) >= 2:
            nokta.append([round(float(p[0]), 7), round(float(p[1]), 7)])
    return nokta


def _kml_poligonlar(placemark):
    poligonlar = []
    for pol in _cocuklar(placemark, "Polygon"):
        halkalar = []
        for sinir in ("outerBoundaryIs", "innerBoundaryIs"):
            for b in [c for c in pol if _yerel(c.tag) == sinir]:
                for c in _cocuklar(b, "coordinates"):
                    halka = _koordinatlar(c.text)
                    if len(halka) >= 3:
                        halkalar.append(halka)
        if halkalar:
            poligonlar.append(halkalar)
    return poligonlar


_HTML_SATIR = re.compile(r"<td>\s*(.*?)\s*</td>\s*<td>\s*(.*?)\s*</td>", re.S | re.I)


def _html_tablo(metin):
    sonuc = {}
    for etiket, deger in _HTML_SATIR.findall(metin or ""):
        alan = _alan_adi(re.sub(r"<[^>]+>", "", etiket))
        if alan:
            sonuc[alan] = html.unescape(re.sub(r"<[^>]+>", "", deger)).strip()
    return sonuc


def _kml_bilgiler(placemark):
    bilgi, ham = {}, {}
    for d in _cocuklar(placemark, "Data"):
        etiket = d.get("name", "")
        v = next((c.text for c in d if _yerel(c.tag) == "value"), None)
        ham[etiket] = v
        alan = _alan_adi(etiket)
        if alan and v is not None:
            bilgi[alan] = v.strip()
    for sd in _cocuklar(placemark, "SimpleData"):
        metin = sd.text or ""
        if "<td" in metin:
            bilgi.update({k: v for k, v in _html_tablo(metin).items() if k not in bilgi})
        else:
            alan = _alan_adi(sd.get("name", ""))
            if alan and alan not in bilgi:
                bilgi[alan] = metin.strip()
    if "il" not in bilgi:
        desc = next((c.text for c in placemark if _yerel(c.tag) == "description"), "")
        bilgi.update({k: v for k, v in _html_tablo(desc).items() if k not in bilgi})
    if ham:
        bilgi["ham"] = ham
    return bilgi


def kml_oku(metin):
    """KML metninden parsel kayıtları. Bilgisi ya da poligonu eksik olanlar atlanır."""
    kok = ET.fromstring(metin.encode("utf-8") if isinstance(metin, str) else metin)
    kayitlar = []
    for pm in _cocuklar(kok, "Placemark"):
        poligonlar = _kml_poligonlar(pm)
        if not poligonlar:
            continue
        bilgi = _kml_bilgiler(pm)
        if not all(bilgi.get(a) not in (None, "") for a in ("il", "ilce", "mahalle", "parsel")):
            continue
        if not bilgi.get("ada"):
            bilgi["ada"] = "0"  # TKGM adasız parselleri ada 0 ile tutar
        if str(bilgi.get("mahalle_id", "")).isdigit():
            bilgi["mahalle_id"] = int(bilgi["mahalle_id"])
        else:
            bilgi.pop("mahalle_id", None)
        bilgi["geometri"] = poligonlar
        kayitlar.append(bilgi)
    return kayitlar


# ---- GeoJSON -----------------------------------------------------------------

def _listeye(x):
    """parselsorgu'nun {"0": .., "1": ..} biçimini listeye çevirir."""
    if isinstance(x, dict) and x and all(k.isdigit() for k in x):
        return [_listeye(x[k]) for k in sorted(x, key=int)]
    if isinstance(x, list):
        return [_listeye(v) for v in x]
    return x


def geometri_coz(geom):
    """GeoJSON Polygon / MultiPolygon -> [poligon][halka][nokta]."""
    if not geom:
        return []
    tur = geom.get("type")
    koord = _listeye(geom.get("coordinates"))
    if tur == "Polygon":
        koord = [koord]
    elif tur != "MultiPolygon":
        return []
    return [[[[round(float(p[0]), 7), round(float(p[1]), 7)] for p in halka] for halka in pol]
            for pol in koord]


def tkgm_ozellik(props):
    """TKGM servisinin özellik adlarını kayıt alanlarına çevirir."""
    return {
        "il": props.get("ilAd"), "ilce": props.get("ilceAd"), "mahalle": props.get("mahalleAd"),
        "ada": str(props.get("adaNo", "0")), "parsel": str(props.get("parselNo", "")),
        "il_id": props.get("ilId"), "ilce_id": props.get("ilceId"), "mahalle_id": props.get("mahalleId"),
        "alan": props.get("alan"), "nitelik": props.get("nitelik"), "mevkii": props.get("mevkii"),
        "pafta": props.get("pafta"), "zemin": props.get("zeminKmdurum"),
        "ham": props,
    }


def geojson_oku(veri):
    if isinstance(veri, (str, bytes)):
        veri = json.loads(veri)
    if isinstance(veri, list):
        ozellikler = veri
    elif veri.get("type") == "FeatureCollection":
        ozellikler = _listeye(veri.get("features")) or []
    else:
        ozellikler = [veri]
    kayitlar = []
    for f in ozellikler:
        if not isinstance(f, dict):
            continue
        props = f.get("properties") or {}
        if "parselNo" not in props:
            continue
        kayit = tkgm_ozellik(props)
        kayit["geometri"] = geometri_coz(f.get("geometry"))
        if kayit["geometri"]:
            kayitlar.append(kayit)
    return kayitlar


# ---- dosya / klasör ------------------------------------------------------------

def dosya_oku(ad, icerik):
    """Dosya adı ve içeriğinden (bytes) kayıtlar."""
    uz = Path(ad).suffix.lower()
    if uz == ".kml":
        return kml_oku(icerik)
    if uz in (".json", ".geojson"):
        return geojson_oku(icerik.decode("utf-8-sig"))
    raise ValueError(f"Desteklenmeyen dosya türü: {ad}")


def ice_aktar(store, ad, icerik, tarih=None):
    """Bir dosyayı kayda aktarır.

    Dönüş: {'yeni': n, 'guncellendi': n, 'atlandi': n, 'keys': [dosyadaki parsellerin anahtarları]}.
    'atlandi' olanlar da (kayıtta daha yenisi var) keys'e girer: dosyadaki parsel oturuma eklenir.
    """
    sayac = {"yeni": 0, "guncellendi": 0, "atlandi": 0}
    keys = []
    for kayit in dosya_oku(ad, icerik):
        sayac[store.kaydet(kayit, f"dosya:{Path(ad).name}", tarih)] += 1
        key = parcel_key(kayit["il"], kayit["ilce"], kayit["mahalle"], kayit["ada"], kayit["parsel"])
        if key not in keys:
            keys.append(key)
    store.yazimlari_birlestir()
    return sayac | {"keys": keys}


def klasor_aktar(store, klasor):
    """Klasördeki (alt klasörler dahil) tüm desteklenen dosyaları aktarır."""
    toplam = {"dosya": 0, "yeni": 0, "guncellendi": 0, "atlandi": 0, "hatalar": []}
    for yol in sorted(Path(klasor).rglob("*")):
        if yol.suffix.lower() not in UZANTILAR or not yol.is_file():
            continue
        tarih = datetime.fromtimestamp(yol.stat().st_mtime).isoformat(timespec="seconds")
        try:
            sonuc = ice_aktar(store, yol.name, yol.read_bytes(), tarih)
        except Exception as e:  # bozuk dosya tüm aktarımı durdurmasın
            toplam["hatalar"].append(f"{yol.name}: {e}")
            continue
        toplam["dosya"] += 1
        for k in ("yeni", "guncellendi", "atlandi"):
            toplam[k] += sonuc[k]
    return toplam
