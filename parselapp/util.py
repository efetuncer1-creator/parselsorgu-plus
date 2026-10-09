"""Küçük yardımcılar: Türkçe metin normalleştirme, alan metni çözme."""

import re

_TR_LOWER = str.maketrans({"I": "ı", "İ": "i"})


def tr_lower(s):
    return (s or "").translate(_TR_LOWER).lower()


def norm(s):
    """Karşılaştırma için: Türkçe küçük harf, fazla boşluk yok."""
    return re.sub(r"\s+", " ", tr_lower(s)).strip()


_ALFABE = {h: i for i, h in enumerate("abcçdefgğhıijklmnoöprsştuüvwxyz")}


def tr_sira(s):
    """Türkçe alfabe sırasına göre sıralama anahtarı (Çankırı, Ç'den sonra; İzmir, I'dan sonra)."""
    return [_ALFABE.get(h, 100 + ord(h)) for h in norm(s)]


def katla(s):
    """TKGM bazı adlarda ı harfini i'ye çevirerek veriyor ("Kirşehir", "Altindağ"); bu yüzden
    eşleştirmede ı ile i aynı sayılır."""
    return norm(s).replace("ı", "i")


def parcel_key(il, ilce, mahalle, ada, parsel):
    """Bir parselin kayıttaki benzersiz anahtarı.

    mahalleId her kaynakta yok (KML'lerde sadece adlar var), o yüzden adlarla kuruluyor.
    ı/i farkı yok sayılır: aynı parsel "Ağrı" ve "Ağri" yazımlarıyla iki kez kaydedilmesin.
    """
    return "|".join(katla(str(x if x is not None else "")) for x in (il, ilce, mahalle, ada, parsel))


def iyi_yazim(ad, aday):
    """Aynı adın iki yazımından doğrusu. TKGM'nin hatası ı'yı i'ye çevirmek, tersi olmuyor;
    o yüzden ı'sı çok olan doğrudur. aday başka bir adsa ad olduğu gibi kalır."""
    if not ad:
        return aday or ad
    if not aday or katla(ad) != katla(aday):
        return ad
    return aday if tr_lower(aday).count("ı") > tr_lower(ad).count("ı") else ad


def parse_alan(text):
    """TKGM alan metnini sayıya çevirir. Çözülemezse None.

    TKGM iki biçim kullanıyor: ada/parsel sorgusu Türkçe ("4.598,40"), haritadan (koordinatla)
    sorgu İngilizce ("29,636.19"). Kural: son ayırıcıdan sonra 1-2 hane varsa o ondalık
    ayırıcıdır, diğerleri binliktir; 3 hane varsa binlik ayırıcıdır ("3.158.004").
    """
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    t = str(text).strip().replace(" ", "")
    if not t:
        return None
    son = max(t.rfind(","), t.rfind("."))
    if son >= 0:
        tam, kesir = t[:son], t[son + 1:]
        tam = tam.replace(",", "").replace(".", "")
        t = f"{tam}.{kesir}" if len(kesir) in (1, 2) else tam + kesir
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
