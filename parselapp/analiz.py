"""Alandan parsel tespiti: bir alan (referans) içindeki parsellerin özeti, boşluklar ve boşluk tarama.

Hesaplar ITRF96 dilim düzleminde (metre) yapılır.
"""

from collections import Counter

from shapely.geometry import Point, Polygon, mapping
from shapely.ops import polylabel, unary_union

from . import coords
from .referans import ICINDE_ORAN, KESISEN_ORAN, alan as referans_alani
from .tkgm import Bulunamadi

# Bu eşiklerin altındaki boşluklar sorgulanmaz: TKGM koordinatlarının ~1 m yuvarlanmasından
# doğan şeritler ve dar yol/dere artıkları. 12 m'den dar bir yerde parsel ortası pek olmaz.
MIN_BOSLUK_M2 = 100.0
MIN_IC_YARICAP_M = 6.0


def parsel_geom(p):
    return unary_union([Polygon(pol[0], pol[1:]) for pol in p["geometri"]]).buffer(0)


class Alan:
    """Bir referansın, gizli katmanlar hariç, metrik alanı ve tarama dışı bırakılan noktaları."""

    def __init__(self, ref):
        cografi = referans_alani(ref["geojson"], ref.get("gizli") or (), ref.get("hesap_katmani"))
        if cografi is None:
            raise ValueError("Açık katmanlarda alan yok (sadece nokta ya da açık çizgi).")
        self.ref = ref
        self.dom = coords.dilim_sec(cografi.centroid.x)
        self.geom = coords.metrik(cografi, self.dom)
        self.haric = unary_union([
            coords.metrik(Point(lon, lat), self.dom).buffer(r) for lon, lat, r in ref.get("taranan") or []])

    def m(self, geom):
        return coords.metrik(geom, self.dom)

    def g(self, geom):
        return coords.cografi(geom, self.dom)


def kesisimler(alan, parseller):
    """[(parsel, parsel_m2_geom, alan içindeki m², oran)] — alana değen parseller."""
    sonuc = []
    kutu = alan.g(alan.geom).bounds
    for p in parseller:
        pg = parsel_geom(p)
        b = pg.bounds
        if b[2] < kutu[0] or b[0] > kutu[2] or b[3] < kutu[1] or b[1] > kutu[3]:
            continue
        pm = alan.m(pg)
        if pm.is_empty or not pm.intersects(alan.geom):
            continue
        ic = pm.intersection(alan.geom).area
        if ic > 0:
            sonuc.append((p, pm, ic, ic / pm.area if pm.area else 0))
    return sonuc


def _ic_yaricap(parca):
    """Parçanın sınırdan en uzak iç noktası ve o noktanın sınıra uzaklığı (iç teğet çember)."""
    nokta = polylabel(parca, tolerance=0.5)
    return nokta, parca.boundary.distance(nokta)


def bosluklar(alan, kesisim):
    """Alanın kayıtlı parsellerle kaplanmamış, sorgulanmaya değer parçaları: [(parça, nokta, yarıçap)]."""
    kapli = unary_union([pm for _, pm, _, _ in kesisim]) if kesisim else Polygon()
    kalan = alan.geom.difference(kapli).difference(alan.haric)
    parcalar = getattr(kalan, "geoms", [kalan])
    sonuc = []
    for parca in parcalar:
        if parca.geom_type != "Polygon" or parca.area < MIN_BOSLUK_M2:
            continue
        nokta, r = _ic_yaricap(parca)
        if r >= MIN_IC_YARICAP_M:
            sonuc.append((parca, nokta, r))
    return sorted(sonuc, key=lambda x: -x[0].area)


def ozet(ref, parseller):
    alan = Alan(ref)
    kes = kesisimler(alan, parseller)
    icinde = [x for x in kes if x[3] >= ICINDE_ORAN]
    kesisen = [x for x in kes if x[3] >= KESISEN_ORAN]
    kapli = unary_union([pm for _, pm, _, _ in kes]).intersection(alan.geom).area if kes else 0.0
    bos = bosluklar(alan, kes)
    nitelik = Counter()
    nitelik_alan = Counter()
    for p, _, ic, _ in kesisen:
        n = p.get("nitelik") or "Belirtilmemiş"
        nitelik[n] += 1
        nitelik_alan[n] += ic
    return {
        "alan_m2": alan.geom.area,
        "dilim": alan.dom,
        "icinde": {"adet": len(icinde), "tapu_m2": sum(p.get("alan_m2") or 0 for p, *_ in icinde),
                   "keys": [p["key"] for p, *_ in icinde]},
        "kesisen": {"adet": len(kesisen), "alan_ici_m2": sum(ic for _, _, ic, _ in kesisen),
                    "keys": [p["key"] for p, *_ in kesisen]},
        "kaplanan_oran": kapli / alan.geom.area if alan.geom.area else 0,
        "nitelikler": [{"nitelik": n, "adet": c, "alan_ici_m2": nitelik_alan[n]} for n, c in nitelik.most_common()],
        "bosluk": {
            "adet": len(bos),
            "m2": sum(b[0].area for b in bos),
            "geojson": {"type": "FeatureCollection", "features": [
                {"type": "Feature", "geometry": mapping(alan.g(parca)), "properties": {"m2": round(parca.area)}}
                for parca, _, _ in bos]},
        },
        "taranan_bos_nokta": len(ref.get("taranan") or []),
    }


def alan_ici_m2(ref, parseller):
    """Excel için: {key: (alan içindeki m², oran)}."""
    alan = Alan(ref)
    return {p["key"]: (ic, oran) for p, _, ic, oran in kesisimler(alan, parseller)}


def tara_adim(store, tkgm, ref, oturum_keys):
    """Oturumdaki parsellerin kapatmadığı en büyük boşluğun ortasındaki parseli getirir.

    Nokta önbellekteki bir parselin içindeyse TKGM'ye gidilmez (sorgu=False); değilse tek sorgu atılır.
    Dönüş: {'durum': 'bulundu'|'bos'|'tekrar'|'bitti', 'sorgu': bool, ...}. LimitAsildi ve diğer
    TKGM hataları çağırana bırakılır. Parsel çıkmayan noktalar referansın 'taranan' listesine yazılır
    ki bir daha sorgulanmasın.
    """
    onceki = set(oturum_keys)
    parseller = store.listele(list(onceki))
    alan = Alan(ref)
    bos = bosluklar(alan, kesisimler(alan, parseller))
    if not bos:
        return {"durum": "bitti"}
    parca, nokta_m, r = bos[0]
    nokta = alan.g(nokta_m)
    lon, lat = nokta.x, nokta.y
    try:
        p, sorgu = tkgm.parsel_noktadan(lat, lon)
    except Bulunamadi:
        store.referans_taranan_ekle(ref["id"], [lon, lat, round(max(r, 5.0), 1)])
        return {"durum": "bos", "sorgu": True, "nokta": [lon, lat], "kalan_bosluk": len(bos) - 1}
    if p["key"] in onceki:
        # Nokta yuvarlama payı yüzünden bilinen bir parsele düştü; burayı bir daha deneme.
        store.referans_taranan_ekle(ref["id"], [lon, lat, round(r, 1)])
        return {"durum": "tekrar", "sorgu": sorgu, "nokta": [lon, lat], "kalan_bosluk": len(bos) - 1}
    return {"durum": "bulundu", "sorgu": sorgu, "nokta": [lon, lat], "parsel": p, "kalan_bosluk": len(bos) - 1}
