"""Haritaya ya da çıktı sayfasına konacak tabloları okur (Excel .xlsx/.xlsm, CSV).

Hücreler Excel'de göründüğü gibi metne çevrilir: sayılar hücrenin kendi biçimiyle (ondalık basamak sayısı,
binlik ayırıcı, yüzde; "Genel" biçimde olduğu gibi), Türkçe virgülle; tarihler gün.ay.yıl.
Excel'in görünüşü de gelir: kalın/italik, yazı ve dolgu rengi, hizalama (biçimsiz sayı ve tarih sağa, Excel
gibi) ve sütun genişlikleri. Sayfa başına "stiller" (0: biçimsiz) ve hücre başına stil numarası ("stil").
Çok büyük sayfalar kesilir (1.000 satır, 50 sütun): haritada ve sayfada bütün tablo gösterilir, ama binlerce
satırlık bir liste harita ekranını ve proje dosyasını kilitlemesin.
"""

import csv
import io
import re
import zipfile
from datetime import date, datetime
from xml.etree import ElementTree
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


_HIZA = {"left": "l", "justify": "l", "fill": "l", "center": "c", "centerContinuous": "c", "distributed": "c", "right": "r"}


def _renk(renk):
    """openpyxl rengi -> "#rrggbb". Tema ve indeks renkleri çözülmez (None: varsayılan)."""
    if renk is None or getattr(renk, "type", None) != "rgb" or not isinstance(renk.rgb, str):
        return None
    v = renk.rgb
    return f"#{v[2:].lower()}" if re.fullmatch(r"[0-9A-Fa-f]{8}", v) and v[:2] != "00" else None


def _stil(hucre):
    """Hücrenin görünüşü: k kalın, i italik, r yazı rengi, d dolgu, h hizalama (l/c/r)."""
    s = {}
    yazi = getattr(hucre, "font", None)
    if yazi is not None:
        if yazi.b:
            s["k"] = 1
        if yazi.i:
            s["i"] = 1
        r = _renk(yazi.color)
        if r and r != "#000000":
            s["r"] = r
    dolgu = getattr(hucre, "fill", None)
    if dolgu is not None and dolgu.fill_type == "solid":
        d = _renk(dolgu.fgColor)
        if d and d != "#ffffff":
            s["d"] = d
    hiza = getattr(getattr(hucre, "alignment", None), "horizontal", None)
    deger = hucre.value
    if hiza in _HIZA:
        s["h"] = _HIZA[hiza]
    elif isinstance(deger, (int, float, date)) and not isinstance(deger, bool):
        s["h"] = "r"  # Excel'in "genel" hizası: sayı ve tarih sağa
    return s


def _sutun_genislikleri(icerik, yol):
    """Sayfanın <cols> tanımından sütun genişlikleri (Excel karakter birimi), {sütun no: genişlik}; varsayılan
    genişlik "*" anahtarında. Okunamazsa boş."""
    genislik = {}
    try:
        with zipfile.ZipFile(io.BytesIO(icerik)) as z, z.open(yol.lstrip("/")) as f:
            for _, el in ElementTree.iterparse(f, events=("start",)):
                ad = el.tag.rsplit("}", 1)[-1]
                if ad == "sheetData":
                    break  # sütun tanımları hücrelerden önce gelir
                if ad == "sheetFormatPr" and el.get("defaultColWidth"):
                    genislik["*"] = float(el.get("defaultColWidth"))
                if ad == "col" and el.get("width"):
                    for j in range(int(el.get("min")) - 1, min(int(el.get("max")), EN_FAZLA_SUTUN)):
                        genislik[j] = round(float(el.get("width")), 2)
    except (KeyError, ValueError, zipfile.BadZipFile, ElementTree.ParseError):
        return {}
    return genislik


def _kirp(satirlar):
    """satırlar: [[(metin, stil no), ...]]. Boş sondaki satır ve sütunları atar, sınırları uygular.
    (metinler, stil numaraları, kesildi mi)"""
    satirlar = [list(s) for s in satirlar]
    while satirlar and not any(m for m, _ in satirlar[-1]):
        satirlar.pop()
    genislik = max((max((i + 1 for i, (m, _) in enumerate(s) if m), default=0) for s in satirlar), default=0)
    kesildi = len(satirlar) > EN_FAZLA_SATIR or genislik > EN_FAZLA_SUTUN
    g = min(genislik, EN_FAZLA_SUTUN)
    satirlar = [(s + [("", 0)] * genislik)[:g] for s in satirlar[:EN_FAZLA_SATIR]]
    return [[m for m, _ in s] for s in satirlar], [[n for _, n in s] for s in satirlar], kesildi


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
        satirlar, _, kesildi = _kirp([[(_metin(h), 0) for h in s] for s in csv.reader(io.StringIO(metin), lehce)])
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
            ham, stiller = [], {(): 0}  # aynı görünüşteki hücreler aynı stil numarasını alır
            for s in sayfa.iter_rows():  # biçim ve görünüş için hücreler (yalnız değerler değil)
                satir = []
                for h in s:
                    st = tuple(sorted(_stil(h).items())) if h.value not in (None, "") else ()
                    satir.append((_metin(h.value, getattr(h, "number_format", None)), stiller.setdefault(st, len(stiller))))
                ham.append(satir)
                if len(ham) > EN_FAZLA_SATIR + 200:  # sondaki boşlukları atabilmek için biraz fazlası
                    break
            satirlar, stil, kesildi = _kirp(ham)
            if satirlar:
                genislik = _sutun_genislikleri(icerik, sayfa._worksheet_path)
                sayfalar.append({
                    "ad": sayfa.title, "satirlar": satirlar, "kesildi": kesildi,
                    "stiller": [dict(st) for st in sorted(stiller, key=stiller.get)], "stil": stil,
                    "genislikler": [genislik.get(j, genislik.get("*", 8.43)) for j in range(len(satirlar[0]))],
                })
        kitap.close()
    elif uzanti == ".xls":
        raise ValueError("Eski .xls biçimi okunamıyor; Excel'de .xlsx olarak kaydedip tekrar dene.")
    else:
        raise ValueError("Tablo için Excel (.xlsx) ya da CSV dosyası seç.")
    if not sayfalar:
        raise ValueError(f"{ad} içinde dolu hücre yok.")
    return {"sayfalar": sayfalar}
