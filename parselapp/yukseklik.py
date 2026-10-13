"""Yükseklik modeli: Copernicus DEM GLO-30 (ESA ve Avrupa Birliği; ücretsiz, ticari kullanım serbest).

Çözünürlük 1 yay saniyesi (~30 m). Yüzey modelidir (DSM): binalar ve ağaçlar yüksekliğe dahildir.
Veri AWS'deki açık kopyadan alınır. Her 1°x1° dosya bulut uyumlu GeoTIFF'tir: 3600x3600 nokta, 1024x1024'lük
döşemeler, deflate ve kayan nokta öngörücüsü (TIFF Predictor=3) ile sıkıştırılmış float32. Dosyanın tamamı
(~30-40 MB) değil, sadece istenen bölgeye düşen döşemeler (her biri ~1-2,5 MB) HTTP aralık isteğiyle indirilir
ve veri klasöründe saklanır: aynı bölge bir daha indirilmez, sonra internet olmadan da çalışır.

Piksel nokta olarak tanımlıdır (GTRasterTypeGeoKey = PixelIsPoint): dosyanın (0, 0) noktası tam dereceli
kuzey-batı köşesinin kendisi. Denizdeki 1°x1° karelerin dosyası yoktur; oralar boş (NaN) kalır.
"""

import json
import math
import os
import struct
import threading
import urllib.error
import urllib.request
import zlib
from collections import OrderedDict
from pathlib import Path

import numpy as np

KAYNAK = "https://copernicus-dem-30m.s3.amazonaws.com"
HUCRE = 3600  # derece başına nokta (60°'nin altındaki enlemlerde)
EN_COK_HUCRE = 1500 * 1500  # ~45 km x 45 km; daha büyüğü hem yavaş hem tarayıcıya ağır
PAY = 2  # eğim kenarda da hesaplansın diye bölgenin çevresine eklenen nokta
BASLIK_BOYU = 65536


class YukseklikHatasi(Exception):
    """Veri indirilemedi (internet yok ya da kaynak cevap vermedi)."""


def dosya_adi(guney, bati):
    """Güney-batı köşesi (tam derece) verilen 1°x1° dosyanın adı."""
    k = f"{'N' if guney >= 0 else 'S'}{abs(guney):02d}_00"
    d = f"{'E' if bati >= 0 else 'W'}{abs(bati):03d}_00"
    return f"Copernicus_DSM_COG_10_{k}_{d}_DEM"


def http_aralik(url, bas, son):
    """[bas, son] baytları; dosya yoksa (denizdeki kare) None."""
    istek = urllib.request.Request(url, headers={"Range": f"bytes={bas}-{son}", "User-Agent": "ParselSorguPlus"})
    try:
        with urllib.request.urlopen(istek, timeout=40) as y:
            return y.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):  # S3 olmayan dosyaya 403 döner
            return None
        raise YukseklikHatasi(f"Yükseklik verisi indirilemedi (sunucu {e.code}). Biraz sonra tekrar dene.") from e
    except (urllib.error.URLError, OSError) as e:
        raise YukseklikHatasi("Yükseklik verisi indirilemedi; internet bağlantısını kontrol et.") from e


# ---- TIFF başlığı ---------------------------------------------------------------------------------

_TURLER = {1: ("B", 1), 2: ("s", 1), 3: ("H", 2), 4: ("I", 4), 11: ("f", 4), 12: ("d", 8), 16: ("Q", 8)}


def baslik_coz(v, getir):
    """İlk IFD'deki (tam çözünürlük) etiketler. v: dosyanın başı; getir(bas, son): dışarıda kalan değerler için."""
    if v[:4] != b"II*\0":
        raise ValueError("Beklenmeyen dosya biçimi")
    ofs = struct.unpack_from("<I", v, 4)[0]
    n = struct.unpack_from("<H", v, ofs)[0]
    et = {}
    for i in range(n):
        etiket, tur, sayi, deger = struct.unpack_from("<HHI4s", v, ofs + 2 + i * 12)
        if tur not in _TURLER or tur == 2:
            continue
        bic, boy = _TURLER[tur]
        toplam = boy * sayi
        if toplam <= 4:
            veri = deger[:toplam]
        else:
            yer = struct.unpack("<I", deger)[0]
            veri = v[yer:yer + toplam] if yer + toplam <= len(v) else getir(yer, yer + toplam - 1)
        et[etiket] = struct.unpack("<" + bic * sayi, veri)
    geo = et.get(34735, ())
    anahtarlar = {geo[i]: geo[i + 3] for i in range(4, len(geo) - 3, 4)}
    b = {
        "en": et[256][0], "boy": et[257][0], "doseme_en": et[322][0], "doseme_boy": et[323][0],
        "ofsetler": list(et[324]), "boylar": list(et[325]),
        "sikistirma": et.get(259, (1,))[0], "ongorucu": et.get(317, (1,))[0],
        "bit": et.get(258, (0,))[0], "bicim": et.get(339, (1,))[0],
        "olcek": list(et[33550][:2]), "kose": [et[33922][3], et[33922][4]],
        "nokta": anahtarlar.get(1025) == 2,
    }
    if b["bit"] != 32 or b["bicim"] != 3 or b["sikistirma"] not in (1, 8) or b["ongorucu"] not in (1, 3):
        raise ValueError("Desteklenmeyen yükseklik dosyası biçimi")
    return b


def doseme_coz(ham, en, boy, sikistirma, ongorucu):
    """Sıkıştırılmış döşeme -> (boy, en) float32."""
    b = np.frombuffer(zlib.decompress(ham) if sikistirma == 8 else ham, dtype=np.uint8)
    if ongorucu == 3:
        # Kayan nokta öngörücüsü: satırda baytlar farkla yazılmış (toplanınca geri gelir); her satırda önce
        # bütün sayıların en anlamlı baytları, sonra ikincileri... gelir (büyük sonlu).
        b = np.cumsum(b.reshape(boy, en * 4), axis=1, dtype=np.uint8)
        b = np.ascontiguousarray(b.reshape(boy, 4, en).transpose(0, 2, 1))
        return b.view(">f4").reshape(boy, en).astype(np.float32)
    return b.view("<f4").reshape(boy, en).astype(np.float32)


# ---- ızgara ---------------------------------------------------------------------------------------

class Yukseklik:
    def __init__(self, klasor, aralik=http_aralik, kaynak=KAYNAK, hucre=HUCRE):
        self.klasor = Path(klasor)
        self._aralik = aralik
        self._kaynak = kaynak
        self.hucre = hucre
        self._kilit = threading.Lock()
        self._basliklar = {}
        self._bloklar = OrderedDict()  # son kullanılan çözülmüş döşemeler (her biri ~4 MB)

    def _url(self, ad):
        return f"{self._kaynak}/{ad}/{ad}.tif"

    def _yaz(self, yol, veri):
        yol.parent.mkdir(parents=True, exist_ok=True)
        gecici = yol.with_name(f"{yol.name}.{os.getpid()}.{threading.get_ident()}.gecici")
        gecici.write_bytes(veri)
        os.replace(gecici, yol)

    def _baslik(self, ad, sayac):
        if ad in self._basliklar:
            return self._basliklar[ad]
        yol = self.klasor / ad / "baslik.json"
        if yol.is_file():
            b = json.loads(yol.read_text(encoding="utf-8"))
        else:
            url = self._url(ad)
            v = self._aralik(url, 0, BASLIK_BOYU - 1)
            if v is None:
                b = {"yok": True}
            else:
                sayac[0] += len(v)
                b = baslik_coz(v, lambda bas, son: self._aralik(url, bas, son))
            self._yaz(yol, json.dumps(b).encode("utf-8"))
        if not b.get("yok"):
            beklenen = 1 / self.hucre
            if (b["en"], b["boy"]) != (self.hucre, self.hucre) or any(abs(o - beklenen) > 1e-9 for o in b["olcek"]) or not b["nokta"]:
                raise ValueError("Bu enlemdeki yükseklik verisi desteklenmiyor.")
        self._basliklar[ad] = b
        return b

    def _doseme(self, ad, b, k, sayac):
        anahtar = (ad, k)
        with self._kilit:
            if anahtar in self._bloklar:
                self._bloklar.move_to_end(anahtar)
                return self._bloklar[anahtar]
        yol = self.klasor / ad / f"{k}.bin"
        if yol.is_file():
            ham = yol.read_bytes()
        else:
            ham = self._aralik(self._url(ad), b["ofsetler"][k], b["ofsetler"][k] + b["boylar"][k] - 1)
            if ham is None or len(ham) != b["boylar"][k]:
                raise YukseklikHatasi("Yükseklik verisi eksik indirildi; tekrar dene.")
            sayac[0] += len(ham)
            self._yaz(yol, ham)
        a = doseme_coz(ham, b["doseme_en"], b["doseme_boy"], b["sikistirma"], b["ongorucu"])
        with self._kilit:
            self._bloklar[anahtar] = a
            while len(self._bloklar) > 12:
                self._bloklar.popitem(last=False)
        return a

    def izgara(self, bati, guney, dogu, kuzey):
        """Kutuyu (ve çevresinde PAY kadar noktayı) kaplayan yükseklik ızgarası.

        Dönüş: (dizi, bilgi). dizi[satır, sütun] metre (float32, kuzeyden güneye, batıdan doğuya; yoksa NaN).
        bilgi: ilk noktanın boylamı/enlemi ("bati", "kuzey"), nokta aralığı ("adim", derece), boyut,
        denizde kalan yer var mı ("eksik") ve bu istekte indirilen bayt ("indirilen").
        """
        n = self.hucre
        i0, i1 = math.floor((90 - kuzey) * n) - PAY, math.ceil((90 - guney) * n) + PAY
        j0, j1 = math.floor((bati + 180) * n) - PAY, math.ceil((dogu + 180) * n) + PAY
        boy, en = i1 - i0 + 1, j1 - j0 + 1
        if boy * en > EN_COK_HUCRE:
            raise ValueError("Bölge çok büyük: yükseklik en fazla ~45 km x 45 km'lik bölge için hesaplanır.")
        dizi = np.full((boy, en), np.nan, dtype=np.float32)
        sayac = [0]
        eksik = False
        for ti in range(i0 // n, i1 // n + 1):
            for tj in range(j0 // n, j1 // n + 1):
                ad = dosya_adi(89 - ti, tj - 180)  # karenin kuzeyi 90 - ti
                b = self._baslik(ad, sayac)
                # Bu karedeki satır/sütun aralığı (karenin içinde)
                r0, r1 = max(i0, ti * n) - ti * n, min(i1, ti * n + n - 1) - ti * n
                c0, c1 = max(j0, tj * n) - tj * n, min(j1, tj * n + n - 1) - tj * n
                if b.get("yok"):
                    eksik = True
                    continue
                if abs(b["kose"][0] - (tj - 180)) > 1e-9 or abs(b["kose"][1] - (90 - ti)) > 1e-9:
                    raise ValueError("Yükseklik dosyasının konumu beklenenden farklı.")
                dw, dh = b["doseme_en"], b["doseme_boy"]
                yan = math.ceil(b["en"] / dw)
                for bi in range(r0 // dh, r1 // dh + 1):
                    for bj in range(c0 // dw, c1 // dw + 1):
                        a = self._doseme(ad, b, bi * yan + bj, sayac)
                        rr0, rr1 = max(r0, bi * dh), min(r1, bi * dh + dh - 1)
                        cc0, cc1 = max(c0, bj * dw), min(c1, bj * dw + dw - 1)
                        dizi[ti * n + rr0 - i0:ti * n + rr1 - i0 + 1, tj * n + cc0 - j0:tj * n + cc1 - j0 + 1] = \
                            a[rr0 - bi * dh:rr1 - bi * dh + 1, cc0 - bj * dw:cc1 - bj * dw + 1]
        # Copernicus denizi 0 m düz yazar; dosyası olmayan kareler NaN
        bilgi = {"bati": j0 / n - 180, "kuzey": 90 - i0 / n, "adim": 1 / n, "en": en, "boy": boy,
                 "eksik": eksik or bool(np.isnan(dizi).any()), "indirilen": sayac[0]}
        return dizi, bilgi
