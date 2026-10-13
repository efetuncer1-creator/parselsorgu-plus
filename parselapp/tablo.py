"""Haritaya ya da çıktı sayfasına konacak tabloları okur (Excel .xlsx/.xlsm, CSV).

Hücreler Excel'de göründüğü gibi metne çevrilir: sayılar hücrenin kendi biçimiyle (ondalık basamak sayısı,
binlik ayırıcı, yüzde; "Genel" biçimde olduğu gibi), Türkçe virgülle; tarihler gün.ay.yıl.
Çok büyük sayfalar kesilir (1.000 satır, 50 sütun): haritada ve sayfada bütün tablo gösterilir, ama binlerce
satırlık bir liste harita ekranını ve proje dosyasını kilitlemesin.
"""

import csv
import io
import re
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

EN_FAZLA_SATIR = 1000
EN_FAZLA_SUTUN = 50


def _turkce(metin):
    """"1,234.5" -> "1.234,5" (binlik nokta, ondalık virgül)."""
    return metin.replace(",", " ").replace(".", ",").replace(" ", ".")


def _sayi(deger, bicim):
    """Sayıyı Excel'in hücre biçimiyle gösterdiği gibi yazar. Desteklenen: Genel; 0, 0.00, #,##0.00 gibi
    ondalık ve binlik ayırıcılı biçimler; # ile isteğe bağlı basamaklar (0.0#); yüzde."""
    b = (bicim or "General").split(";")[0]                      # yalnız artı sayılar bölümü
    b = re.sub(r'"[^"]*"|\\.|\[[^\]]*\]|_.|\*.', "", b)          # tırnaklı metin, kaçışlar, [Renk], boşluk/doldurma
    if b in ("General", "@") or not re.search(r"[0#?]", b):
        # Genel: en çok 10 anlamlı basamak, binlik ayırıcı yok
        metin = f"{deger:.10g}"
        if "e" in metin:
            metin = f"{deger:.0f}" if abs(deger) >= 1 else f"{deger:.10f}".rstrip("0").rstrip(".")
        return metin.replace(".", ",")
    if "%" in b:
        deger *= 100
    tam, _, kesir = b.partition(".")
    kesir = re.match(r"[0#?]*", kesir).group()
    en_az, en_cok = kesir.count("0"), len(kesir)
    metin = f"{deger:,.{en_cok}f}" if "," in tam else f"{deger:.{en_cok}f}"
    while en_cok > en_az and metin.endswith("0"):              # isteğe bağlı (#) basamaklardaki sondaki sıfırlar
        metin, en_cok = metin[:-1], en_cok - 1
    metin = _turkce(metin.rstrip(".")) if en_cok == 0 else _turkce(metin)
    return metin + ("%" if "%" in b else "")


def _metin(deger, bicim=None):
    if deger is None:
        return ""
    if isinstance(deger, bool):
        return "Evet" if deger else "Hayır"
    if isinstance(deger, datetime):
        return deger.strftime("%d.%m.%Y %H:%M") if (deger.hour, deger.minute) != (0, 0) else deger.strftime("%d.%m.%Y")
    if isinstance(deger, date):
        return deger.strftime("%d.%m.%Y")
    if isinstance(deger, (int, float)):
        return _sayi(deger, bicim)
    return str(deger).strip()


def _kirp(satirlar):
    """Boş sondaki satır ve sütunları atar, sınırları uygular. (satırlar, kesildi mi)"""
    satirlar = [[_metin(h) for h in s] for s in satirlar]
    while satirlar and not any(satirlar[-1]):
        satirlar.pop()
    genislik = max((max((i + 1 for i, h in enumerate(s) if h), default=0) for s in satirlar), default=0)
    kesildi = len(satirlar) > EN_FAZLA_SATIR or genislik > EN_FAZLA_SUTUN
    satirlar = [(s + [""] * genislik)[:min(genislik, EN_FAZLA_SUTUN)] for s in satirlar[:EN_FAZLA_SATIR]]
    return satirlar, kesildi


def oku(ad, icerik):
    """{"sayfalar": [{"ad", "satirlar", "kesildi"}]}; boş sayfalar atlanır."""
    uzanti = Path(ad).suffix.lower()
    if uzanti == ".csv":
        # Türkçe Excel CSV'yi çoğunlukla Windows-1254 ile kaydeder; UTF-8 değilse o denenir.
        try:
            metin = icerik.decode("utf-8-sig")
        except UnicodeDecodeError:
            metin = icerik.decode("cp1254", errors="replace")
        try:
            lehce = csv.Sniffer().sniff(metin[:4096], delimiters=";,\t")
        except csv.Error:
            lehce = type("Lehce", (csv.excel,), {"delimiter": ";" if metin.count(";") > metin.count(",") else ","})
        satirlar, kesildi = _kirp(list(csv.reader(io.StringIO(metin), lehce)))
        sayfalar = [{"ad": Path(ad).stem, "satirlar": satirlar, "kesildi": kesildi}]
    elif uzanti in (".xlsx", ".xlsm"):
        try:
            kitap = load_workbook(io.BytesIO(icerik), read_only=True, data_only=True)
        except Exception as e:
            raise ValueError(f"{ad} Excel dosyası olarak açılamadı.") from e
        sayfalar = []
        for sayfa in kitap.worksheets:
            # Bazı programlar sayfanın kullanılan alanını yanlış yazar (ör. "A1"); hızlı okuma ona güvenip
            # tabloyu tek hücre sanmasın.
            sayfa.reset_dimensions()
            ham = []
            for s in sayfa.iter_rows():  # hücre biçimi (number_format) için değerlerle birlikte
                ham.append([_metin(h.value, getattr(h, "number_format", None)) for h in s])
                if len(ham) > EN_FAZLA_SATIR + 200:  # sondaki boşlukları atabilmek için biraz fazlası
                    break
            satirlar, kesildi = _kirp(ham)
            if satirlar:
                sayfalar.append({"ad": sayfa.title, "satirlar": satirlar, "kesildi": kesildi})
        kitap.close()
    elif uzanti == ".xls":
        raise ValueError("Eski .xls biçimi okunamıyor; Excel'de .xlsx olarak kaydedip tekrar dene.")
    else:
        raise ValueError("Tablo için Excel (.xlsx) ya da CSV dosyası seç.")
    if not sayfalar:
        raise ValueError(f"{ad} içinde dolu hücre yok.")
    return {"sayfalar": sayfalar}
