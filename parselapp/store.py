"""SQLite kaydı.

Her parsel bir kez tutulur. Geometri her zaman GeoJSON MultiPolygon koordinatı olarak
saklanır: [poligon][halka][nokta] = [boylam, enlem].
"""

import json
import sqlite3
import threading
from datetime import datetime, date
from pathlib import Path

from shapely.geometry import Point, Polygon

from .util import parcel_key, parse_alan

ALANLAR = ("il", "ilce", "mahalle", "ada", "parsel", "il_id", "ilce_id", "mahalle_id",
           "alan", "nitelik", "mevkii", "pafta", "zemin")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS parseller (
    key         TEXT PRIMARY KEY,
    il          TEXT, ilce TEXT, mahalle TEXT, ada TEXT, parsel TEXT,
    il_id       INTEGER, ilce_id INTEGER, mahalle_id INTEGER,
    alan        TEXT,      -- TKGM'nin verdiği metin, ör. "4.598,40"
    alan_m2     REAL,
    nitelik     TEXT, mevkii TEXT, pafta TEXT, zemin TEXT,
    geometri    TEXT NOT NULL,   -- MultiPolygon koordinatları (JSON)
    ham         TEXT,            -- kaynağın ham özellikleri (JSON)
    kaynak      TEXT NOT NULL,   -- 'tkgm' ya da 'dosya:<ad>'
    kaynak_tarih TEXT NOT NULL,  -- verinin TKGM'den alındığı / dosyanın tarihi
    eklenme     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idari (
    tur      TEXT NOT NULL,   -- il / ilce / mahalle
    ust_id   INTEGER NOT NULL,
    veri     TEXT NOT NULL,
    tarih    TEXT NOT NULL,
    PRIMARY KEY (tur, ust_id)
);
CREATE TABLE IF NOT EXISTS referanslar (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ad       TEXT NOT NULL,
    renk     TEXT NOT NULL,
    gorunur  INTEGER NOT NULL DEFAULT 1,
    gizli    TEXT NOT NULL DEFAULT '[]',   -- gizlenen katman adları (JSON liste)
    taranan  TEXT NOT NULL DEFAULT '[]',   -- taramada parsel çıkmayan noktalar [[boylam, enlem, yarıçap_m]]
    hesap_katmani TEXT,                    -- alan hesabında kullanılan tek katman (NULL: tüm açık katmanlar)
    geojson  TEXT NOT NULL,
    eklenme  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sorgu_kaydi (
    zaman   TEXT NOT NULL,
    adres   TEXT NOT NULL,
    durum   INTEGER
);
"""


def _simdi():
    return datetime.now().isoformat(timespec="seconds")


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)
        kolonlar = {r[1] for r in self._db.execute("PRAGMA table_info(referanslar)")}
        for kolon in ("gizli", "taranan"):
            if kolon not in kolonlar:
                self._db.execute(f"ALTER TABLE referanslar ADD COLUMN {kolon} TEXT NOT NULL DEFAULT '[]'")
        if "hesap_katmani" not in kolonlar:
            self._db.execute("ALTER TABLE referanslar ADD COLUMN hesap_katmani TEXT")
        self._db.commit()

    # ---- parseller -------------------------------------------------------

    def kaydet(self, kayit, kaynak, kaynak_tarih=None):
        """Parseli ekler ya da günceller.

        Kural: TKGM'den canlı çekilmiş veri, dosyadan gelen veriyle ezilmez.
        Aynı türden iki kaynakta tarihi yeni olan kazanır.
        Dönüş: 'yeni', 'guncellendi' ya da 'atlandi'.
        """
        key = parcel_key(kayit["il"], kayit["ilce"], kayit["mahalle"], kayit["ada"], kayit["parsel"])
        kaynak_tarih = kaynak_tarih or _simdi()
        with self._lock:
            eski = self._db.execute("SELECT * FROM parseller WHERE key=?", (key,)).fetchone()
            if eski:
                eski_tkgm = eski["kaynak"] == "tkgm"
                yeni_tkgm = kaynak == "tkgm"
                if (eski_tkgm and not yeni_tkgm) or (eski_tkgm == yeni_tkgm and eski["kaynak_tarih"] > kaynak_tarih):
                    self._bosluklari_doldur(eski, kayit)
                    return "atlandi"
            degerler = {a: kayit.get(a) for a in ALANLAR}
            degerler.update(
                key=key,
                geometri=json.dumps(kayit["geometri"]),
                ham=json.dumps(kayit.get("ham") or {}, ensure_ascii=False),
                kaynak=kaynak,
                kaynak_tarih=kaynak_tarih,
                eklenme=_simdi(),
            )
            if eski:
                # Dosyalarda olmayan kimlik bilgilerini (mahalle_id vb.) kaybetme.
                for a in ALANLAR:
                    if degerler[a] in (None, "") and eski[a] not in (None, ""):
                        degerler[a] = eski[a]
                degerler["eklenme"] = eski["eklenme"]
            degerler["alan_m2"] = parse_alan(degerler["alan"])
            kolonlar = ", ".join(degerler)
            yer = ", ".join(f":{k}" for k in degerler)
            self._db.execute(f"INSERT OR REPLACE INTO parseller ({kolonlar}) VALUES ({yer})", degerler)
            self._db.commit()
            return "guncellendi" if eski else "yeni"

    def _bosluklari_doldur(self, eski, kayit):
        """Ezilmeyen kayıtta boş kalan alanları (ör. KML'de olmayan mahalle_id) eski kaynaktan tamamlar."""
        eksik = {a: kayit[a] for a in ALANLAR
                 if eski[a] in (None, "") and kayit.get(a) not in (None, "")}
        if "alan" in eksik:
            eksik["alan_m2"] = parse_alan(eksik["alan"])
        if eksik:
            atama = ", ".join(f"{a}=:{a}" for a in eksik)
            self._db.execute(f"UPDATE parseller SET {atama} WHERE key=:key", eksik | {"key": eski["key"]})
            self._db.commit()

    def bul(self, key):
        r = self._db.execute("SELECT * FROM parseller WHERE key=?", (key,)).fetchone()
        return _satir(r) if r else None

    def bul_id(self, mahalle_id, ada, parsel):
        r = self._db.execute(
            "SELECT * FROM parseller WHERE mahalle_id=? AND ada=? AND parsel=?",
            (mahalle_id, str(ada), str(parsel))).fetchone()
        return _satir(r) if r else None

    def listele(self, keys=None):
        """keys=None: hepsi; keys verilirse (boş liste dahil) sadece onlar."""
        if keys is not None:
            if not keys:
                return []
            yer = ",".join("?" * len(keys))
            rows = self._db.execute(f"SELECT * FROM parseller WHERE key IN ({yer})", list(keys)).fetchall()
        else:
            rows = self._db.execute("SELECT * FROM parseller").fetchall()
        sirali = sorted((_satir(r) for r in rows), key=_sira_anahtari)
        return sirali

    def noktadaki(self, boylam, enlem):
        """Noktayı içeren kayıtlı parsel (yoksa None)."""
        nokta = Point(boylam, enlem)
        for p in self.listele():
            for pol in p["geometri"]:
                if Polygon(pol[0], pol[1:]).contains(nokta):
                    return p
        return None

    def sil(self, keys):
        if not keys:
            return 0
        with self._lock:
            yer = ",".join("?" * len(keys))
            n = self._db.execute(f"DELETE FROM parseller WHERE key IN ({yer})", list(keys)).rowcount
            self._db.commit()
            return n

    # ---- idari yapı önbelleği ---------------------------------------------

    def idari_al(self, tur, ust_id=0):
        r = self._db.execute("SELECT veri FROM idari WHERE tur=? AND ust_id=?", (tur, ust_id)).fetchone()
        return json.loads(r[0]) if r else None

    def idari_kaydet(self, tur, ust_id, veri):
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO idari VALUES (?,?,?,?)",
                             (tur, ust_id, json.dumps(veri, ensure_ascii=False), _simdi()))
            self._db.commit()

    # ---- referans katmanları ------------------------------------------------

    def referans_ekle(self, ad, renk, geojson, hesap_katmani=None):
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO referanslar (ad, renk, gorunur, geojson, eklenme, hesap_katmani) VALUES (?,?,1,?,?,?)",
                (ad, renk, json.dumps(geojson, ensure_ascii=False), _simdi(), hesap_katmani))
            self._db.commit()
            return cur.lastrowid

    def referanslar(self):
        rows = self._db.execute("SELECT * FROM referanslar ORDER BY id").fetchall()
        return [_referans(r) for r in rows]

    def referans(self, ref_id):
        r = self._db.execute("SELECT * FROM referanslar WHERE id=?", (ref_id,)).fetchone()
        return _referans(r) if r else None

    def referans_guncelle(self, ref_id, **alanlar):
        izinli = {k: v for k, v in alanlar.items()
                  if k in ("ad", "renk", "gorunur", "gizli", "hesap_katmani") and v is not None}
        if "hesap_katmani" in izinli and izinli["hesap_katmani"] == "*":
            izinli["hesap_katmani"] = None  # "*": tüm açık katmanlar
        if "gizli" in izinli:
            izinli["gizli"] = json.dumps(sorted(set(izinli["gizli"])), ensure_ascii=False)
        if not izinli:
            return
        with self._lock:
            atama = ", ".join(f"{k}=:{k}" for k in izinli)
            self._db.execute(f"UPDATE referanslar SET {atama} WHERE id=:id", izinli | {"id": ref_id})
            self._db.commit()

    def referans_taranan_ekle(self, ref_id, nokta):
        with self._lock:
            r = self._db.execute("SELECT taranan FROM referanslar WHERE id=?", (ref_id,)).fetchone()
            liste = json.loads(r[0] or "[]") + [nokta]
            self._db.execute("UPDATE referanslar SET taranan=? WHERE id=?", (json.dumps(liste), ref_id))
            self._db.commit()

    def referans_tarama_sifirla(self, ref_id):
        with self._lock:
            self._db.execute("UPDATE referanslar SET taranan='[]' WHERE id=?", (ref_id,))
            self._db.commit()

    def referanslari_temizle(self):
        with self._lock:
            n = self._db.execute("DELETE FROM referanslar").rowcount
            self._db.commit()
            return n

    def referans_sil(self, ref_id):
        with self._lock:
            n = self._db.execute("DELETE FROM referanslar WHERE id=?", (ref_id,)).rowcount
            self._db.commit()
            return n

    # ---- sorgu sayacı -------------------------------------------------------

    def sorgu_yaz(self, adres, durum):
        with self._lock:
            self._db.execute("INSERT INTO sorgu_kaydi VALUES (?,?,?)", (_simdi(), adres, durum))
            self._db.commit()

    def bugunku_sorgu(self):
        bugun = date.today().isoformat()
        r = self._db.execute(
            "SELECT COUNT(*), SUM(durum=403) FROM sorgu_kaydi WHERE zaman >= ?", (bugun,)).fetchone()
        return {"toplam": r[0] or 0, "limit_hatasi": r[1] or 0}


def _satir(r):
    d = dict(r)
    d["geometri"] = json.loads(d["geometri"])
    d["ham"] = json.loads(d["ham"] or "{}")
    return d


def _referans(r):
    d = dict(r)
    d["geojson"] = json.loads(d["geojson"])
    d["gorunur"] = bool(d["gorunur"])
    d["gizli"] = json.loads(d.get("gizli") or "[]")
    d["taranan"] = json.loads(d.get("taranan") or "[]")
    return d


def _sayi(s):
    try:
        return (0, int(s))
    except (TypeError, ValueError):
        return (1, str(s))


def _sira_anahtari(p):
    return (p["il"] or "", p["ilce"] or "", p["mahalle"] or "", _sayi(p["ada"]), _sayi(p["parsel"]))
