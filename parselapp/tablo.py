"""Haritaya ya da çıktı sayfasına konacak tabloları okur (Excel .xlsx/.xlsm, CSV).

Hücreler ekranda göründüğü gibi metne çevrilir: ondalıklar Türkçe virgülle, tarihler gün.ay.yıl.
Çok büyük sayfalar kesilir; tablo haritada okunacak boyda kalmalı.
"""

import csv
import io
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

EN_FAZLA_SATIR = 60
EN_FAZLA_SUTUN = 15


def _metin(deger):
    if deger is None:
        return ""
    if isinstance(deger, bool):
        return "Evet" if deger else "Hayır"
    if isinstance(deger, datetime):
        return deger.strftime("%d.%m.%Y %H:%M") if (deger.hour, deger.minute) != (0, 0) else deger.strftime("%d.%m.%Y")
    if isinstance(deger, date):
        return deger.strftime("%d.%m.%Y")
    if isinstance(deger, float):
        if deger.is_integer():
            return str(int(deger))
        return f"{deger:,.2f}".replace(",", " ").replace(".", ",").replace(" ", ".").rstrip("0").rstrip(",")
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
        metin = icerik.decode("utf-8-sig", errors="replace")
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
            ham = []
            for s in sayfa.iter_rows(values_only=True):
                ham.append(list(s))
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
