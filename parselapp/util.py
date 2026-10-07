"""Küçük yardımcılar: Türkçe metin normalleştirme, alan metni çözme."""

import re

_TR_LOWER = str.maketrans({"I": "ı", "İ": "i"})


def tr_lower(s):
    return (s or "").translate(_TR_LOWER).lower()


def norm(s):
    """Karşılaştırma için: Türkçe küçük harf, fazla boşluk yok."""
    return re.sub(r"\s+", " ", tr_lower(s)).strip()


def parcel_key(il, ilce, mahalle, ada, parsel):
    """Bir parselin kayıttaki benzersiz anahtarı.

    mahalleId her kaynakta yok (KML'lerde sadece adlar var), o yüzden adlarla kuruluyor.
    """
    return "|".join(norm(str(x if x is not None else "")) for x in (il, ilce, mahalle, ada, parsel))


def parse_alan(text):
    """TKGM alan metnini sayıya çevirir: "4.598,40" -> 4598.4. Çözülemezse None."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    t = str(text).strip().replace(" ", "")
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def fmt_alan(value):
    """4598.4 -> "4.598,40" (TKGM biçimi)."""
    if value is None:
        return ""
    s = f"{value:,.2f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")
