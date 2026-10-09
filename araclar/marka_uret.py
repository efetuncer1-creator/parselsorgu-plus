"""Parsel Sorgu + marka dosyalarını web/marka/ içine üretir: python araclar/marka_uret.py

Harfler yazı tipinden değil, buradaki çizgi yollarından çizilir (yükseklik 100, çizgi kalınlığı 22),
böylece logo hiçbir yazı tipine bağlı değildir. Bir harfi düzeltmek için HARFLER'i değiştirip
betiği yeniden çalıştır.
"""

from pathlib import Path

KLASOR = Path(__file__).resolve().parent.parent / "web" / "marka"

MAVI, MAVI_KOYU, SARI = "#0062d6", "#3d9bff", "#ffd60a"
MUREKKEP, BEYAZ = "#141518", "#f2f2f7"

# (genişlik, çizim) — çizim, 0..100 yüksekliğinde ve verilen genişlikte çizgi yolu
HARFLER = {
    "P": (52, '<path d="M11 100V11H22A20 20 0 0 1 22 51H11" stroke-linejoin="miter"/>'),
    "A": (52, '<path d="M11 100V26A15 15 0 0 1 41 26V100M11 64H41"/>'),
    "R": (52, '<path d="M11 100V11H22A20 20 0 0 1 22 51H11M24 51L42 100" stroke-linejoin="miter"/>'),
    "S": (52, '<path d="M41 27C41 16 34 11 26 11C17 11 11 17 11 27C11 39 20 44 26 47C33 51 41 57 41 72C41 84 34 89 26 89C17 89 11 83 11 73"/>'),
    "E": (44, '<path d="M44 11H11V89H44M11 50H38" stroke-linejoin="miter"/>'),
    "L": (44, '<path d="M11 0V89H44" stroke-linejoin="miter"/>'),
    "O": (52, '<rect x="11" y="11" width="30" height="78" rx="15"/>'),
    "G": (52, '<path d="M41 30V26A15 15 0 0 0 11 26V74A15 15 0 0 0 41 74V54H27" stroke-linejoin="miter"/>'),
    "U": (52, '<path d="M11 0V74A15 15 0 0 0 41 74V0"/>'),
}
ARALIK = 8      # harf arası
BOSLUK = 34     # kelime arası (tek satırlı yazıda)


def kelime(metin, x=0, y=0):
    """Metni harf yollarıyla yazar; dönüş: (svg parçası, genişlik)."""
    parcalar, imlec = [], 0
    for h in metin:
        if h == " ":
            imlec += BOSLUK
            continue
        g, cizim = HARFLER[h]
        parcalar.append(f'<g transform="translate({x + imlec} {y})">{cizim}</g>')
        imlec += g + ARALIK
    return "".join(parcalar), imlec - ARALIK


def arti(renk, nokta, kalinlik=40):
    """216x216 büyük artı; ortasında parsel köşe noktası. Kollar harf çizgisinden ~1,8 kat kalın."""
    a = 108 - kalinlik / 2
    return (f'<g fill="{renk}"><rect x="{a:g}" y="0" width="{kalinlik}" height="216"/><rect x="0" y="{a:g}" width="216" height="{kalinlik}"/></g>'
            f'<rect x="{a:g}" y="{a:g}" width="{kalinlik}" height="{kalinlik}" fill="{nokta}"/>')


def isaret_govde(zemin=MAVI, arti_renk="#ffffff", nokta=SARI, kalinlik=32):
    """Uygulama işareti: yuvarlak kare içinde artı ve köşe noktası (216x216).

    Küçük boyutlarda ince kollar ve nokta kaybolur; kalinlik optik boyut ayarıdır
    (32: işaret ve başlık, 40: 16 piksellik favicon).
    """
    a = 108 - kalinlik / 2
    return (f'<rect width="216" height="216" rx="52" fill="{zemin}"/>'
            f'<g fill="{arti_renk}"><rect x="{a:g}" y="40" width="{kalinlik}" height="136"/><rect x="40" y="{a:g}" width="136" height="{kalinlik}"/></g>'
            f'<rect x="{a:g}" y="{a:g}" width="{kalinlik}" height="{kalinlik}" fill="{nokta}"/>')


def kilit(arti_renk, yazi_renk):
    """Ana logo: büyük artı + iki satır PARSEL / SORGU."""
    ust, g1 = kelime("PARSEL", 240, 0)
    alt, g2 = kelime("SORGU", 240, 116)
    genislik = 240 + max(g1, g2)
    yazi = f'<g fill="none" stroke="{yazi_renk}" stroke-width="22">{ust}{alt}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {genislik} 216" role="img" aria-label="Parsel Sorgu +">'
            f'<title>Parsel Sorgu +</title>{arti(arti_renk, SARI)}{yazi}</svg>\n')


def yaz(ad, icerik):
    (KLASOR / ad).write_text(icerik, encoding="utf-8")
    print("yazıldı:", ad)


def ikon_png(boyut):
    """Uygulama işaretinin piksel görüntüsü (Pillow). Kenarlar için 4 kat büyük çizip küçültülür."""
    from PIL import Image, ImageDraw
    k = 4
    b = boyut * k
    olcek = b / 216
    kalinlik = 40 if boyut <= 32 else 32  # küçük boyutta optik kalınlık
    a = (108 - kalinlik / 2) * olcek
    img = Image.new("RGBA", (b, b), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, b - 1, b - 1], radius=52 * olcek, fill=MAVI)
    d.rectangle([a, 40 * olcek, a + kalinlik * olcek, 176 * olcek], fill="#ffffff")
    d.rectangle([40 * olcek, a, 176 * olcek, a + kalinlik * olcek], fill="#ffffff")
    d.rectangle([a, a, a + kalinlik * olcek, a + kalinlik * olcek], fill=SARI)
    return img.resize((boyut, boyut), Image.LANCZOS)


def ikonlar():
    """Windows simgesi (.ico, 16-256) ve web için PNG'ler."""
    boyutlar = [16, 24, 32, 48, 64, 128, 256]
    resimler = [ikon_png(n) for n in boyutlar]
    ico = KLASOR.parent.parent / "packaging" / "ParselSorgu.ico"
    ico.parent.mkdir(exist_ok=True)
    resimler[-1].save(ico, format="ICO", sizes=[(n, n) for n in boyutlar], append_images=resimler[:-1])
    print("yazıldı:", ico.relative_to(KLASOR.parent.parent))
    for n in (192, 512):
        ikon_png(n).save(KLASOR / f"ikon-{n}.png")
        print(f"yazıldı: ikon-{n}.png")


if __name__ == "__main__":
    yaz("logo.svg", kilit(MAVI, MUREKKEP))
    yaz("logo-koyu.svg", kilit(MAVI_KOYU, BEYAZ))
    yaz("isaret.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 216 216" role="img" aria-label="Parsel Sorgu +">'
                      f'<title>Parsel Sorgu +</title>{isaret_govde()}</svg>\n')
    tek, g = kelime("PARSEL SORGU")
    yaz("kelime.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {g} 100" role="img" aria-label="Parsel Sorgu +">'
                      f'<g fill="none" stroke="currentColor" stroke-width="22">{tek}</g></svg>\n')
    ikonlar()
