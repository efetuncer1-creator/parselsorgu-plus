"""Proje dosyası (.parselsorgu): kaydedilmiş bir çalışmanın sunucuya geri yüklenen kısmı.

Dosyanın kendisini tarayıcı yazar ve okur (notlar, lejant, çıktı düzeni, görseller orada). Sunucuya
yalnızca parseller ve alanlar gelir: parseller kayda (kaynak ve tarihleriyle), alanlar yeni kimlikle
referanslar tablosuna yazılır. Başka bilgisayarda açılan proje de TKGM'ye sorgu atmadan yüklenir.
"""

import math

from .importers import geometri_coz
from .referans import gorsel_duzelt, renk_duzelt
from .util import parcel_key

_PARSEL_ALANLARI = ("il", "ilce", "mahalle", "ada", "parsel")
_DIGER_ALANLAR = ("il_id", "ilce_id", "mahalle_id", "alan", "nitelik", "mevkii", "pafta", "zemin")


def _parsel(f):
    if not isinstance(f, dict) or not isinstance(f.get("properties"), dict):
        raise ValueError("Projedeki bir parsel okunamadı.")
    p = f["properties"]
    if not all(isinstance(p.get(a), str) and p[a].strip() for a in _PARSEL_ALANLARI):
        raise ValueError("Projedeki bir parselin il, ilçe, mahalle, ada ya da parsel bilgisi eksik.")
    try:
        geometri = geometri_coz(f.get("geometry"))
    except (TypeError, ValueError, IndexError):
        geometri = []
    if not geometri:
        raise ValueError(f"{p['ada']}/{p['parsel']} parselinin sınırı okunamadı.")
    kayit = {a: p[a] for a in _PARSEL_ALANLARI} | {a: p.get(a) for a in _DIGER_ALANLAR} | {"geometri": geometri}
    kaynak = p.get("kaynak")
    if kaynak != "tkgm" and not (isinstance(kaynak, str) and kaynak.startswith("dosya:")):
        kaynak = "dosya:proje"
    tarih = p.get("kaynak_tarih") if isinstance(p.get("kaynak_tarih"), str) else None
    return kayit, kaynak, tarih


def _sayi_mi(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _alan(a):
    if not isinstance(a, dict):
        raise ValueError("Projedeki bir alan okunamadı.")
    ad = a.get("ad")
    if not isinstance(ad, str) or not ad.strip():
        raise ValueError("Projedeki bir alanın adı yok.")
    fc = a.get("geojson")
    if not (isinstance(fc, dict) and fc.get("type") == "FeatureCollection" and isinstance(fc.get("features"), list)
            and all(isinstance(f, dict) and isinstance(f.get("geometry"), dict) for f in fc["features"])):
        raise ValueError(f"\"{ad}\" alanının sınırı okunamadı.")
    gizli = a.get("gizli") or []
    hesap = a.get("hesap_katmani")
    taranan = a.get("taranan") or []
    if not (isinstance(gizli, list) and all(isinstance(g, str) for g in gizli)) or not (hesap is None or isinstance(hesap, str)):
        raise ValueError(f"\"{ad}\" alanının katman bilgisi okunamadı.")
    if not (isinstance(taranan, list) and all(isinstance(t, list) and len(t) == 3 and all(map(_sayi_mi, t)) for t in taranan)):
        raise ValueError(f"\"{ad}\" alanının taranan noktaları okunamadı.")
    return {
        "ad": ad.strip()[:120], "renk": renk_duzelt(a.get("renk")), "geojson": fc, "gizli": gizli,
        "hesap_katmani": hesap, "gorsel": gorsel_duzelt(a.get("gorsel") or {}),
        "gorunur": a.get("gorunur", True) is not False, "taranan": taranan,
    }


def yukle(store, parseller, alanlar):
    """Önce hepsi doğrulanır (bozuk dosya yarım yüklenmesin), sonra yazılır.

    Dönüş: {"keys": parsel anahtarları (dosyadaki sırayla), "alanlar": yeni alan kimlikleri (aynı sırayla)}.
    """
    if not isinstance(parseller, list) or not isinstance(alanlar, list):
        raise ValueError("Proje dosyası okunamadı.")
    parsel_kayitlari = [_parsel(f) for f in parseller]
    alan_kayitlari = [_alan(a) for a in alanlar]
    keys = []
    for kayit, kaynak, tarih in parsel_kayitlari:
        store.kaydet(kayit, kaynak, tarih)
        key = parcel_key(*(kayit[a] for a in _PARSEL_ALANLARI))
        if key not in keys:
            keys.append(key)
    if parsel_kayitlari:
        store.yazimlari_birlestir()
    kimlikler = []
    for a in alan_kayitlari:
        ref_id = store.referans_ekle(a["ad"], a["renk"], a["geojson"], a["hesap_katmani"])
        store.referans_guncelle(ref_id, gorunur=int(a["gorunur"]), gizli=a["gizli"], gorsel=a["gorsel"], taranan=a["taranan"])
        kimlikler.append(ref_id)
    return {"keys": keys, "alanlar": kimlikler}
