"""Sürüm notunu site/guncellemeler.json'dan üretir.

GitHub derlemesi bir "v1.2.3" etiketinde bunu çalıştırır; o sürümün notu yoksa ya da
taslak olarak işaretliyse hata verir ve sürüm yayınlanmaz.

    python packaging/surum_notu.py v1.2.3 dist/surum-notu.md
"""

import json
import os
import re
import sys
from datetime import date
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
KAYNAK = KOK / "site" / "guncellemeler.json"
SITE = "https://parselsorgu-plus.vercel.app/guncellemeler"
TUR = {"yeni": "Yeni", "iyilestirme": "İyileştirme", "duzeltme": "Düzeltme"}
AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
         "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]


class NotHatasi(ValueError):
    pass


def surum_sirasi(surum):
    return tuple(int(p) for p in surum.split("."))


def kontrol(veri):
    """Dosyanın biçimini doğrular; sorun varsa NotHatasi verir."""
    surumler = veri.get("surumler")
    if not isinstance(surumler, list) or not surumler:
        raise NotHatasi("'surumler' listesi boş ya da yok.")
    onceki = None
    for s in surumler:
        no = s.get("surum", "")
        if not re.fullmatch(r"\d+\.\d+\.\d+", str(no)):
            raise NotHatasi(f"Sürüm numarası 1.2.3 biçiminde olmalı: {no!r}")
        try:
            gun = date.fromisoformat(s.get("tarih", ""))
        except (TypeError, ValueError):
            raise NotHatasi(f"v{no}: tarih YYYY-AA-GG biçiminde olmalı.") from None
        if not str(s.get("baslik", "")).strip():
            raise NotHatasi(f"v{no}: başlık boş.")
        if not s.get("notlar"):
            raise NotHatasi(f"v{no}: en az bir not gerekli.")
        for n in s["notlar"]:
            if n.get("tur") not in TUR:
                raise NotHatasi(f"v{no}: not türü {', '.join(TUR)} olmalı: {n.get('tur')!r}")
            if not str(n.get("metin", "")).strip():
                raise NotHatasi(f"v{no}: boş not var.")
        if "taslak" in s and not isinstance(s["taslak"], bool):
            raise NotHatasi(f"v{no}: 'taslak' true ya da false olmalı.")
        if onceki:
            if surum_sirasi(no) >= surum_sirasi(onceki[0]):
                raise NotHatasi(f"Sürümler en yeni üstte olacak şekilde sıralı olmalı: v{onceki[0]} ardından v{no}")
            if gun > onceki[1]:
                raise NotHatasi(f"v{no} tarihi, daha yeni v{onceki[0]} sürümünden sonra olamaz.")
        onceki = (no, gun)


def oku(yol=KAYNAK):
    veri = json.loads(Path(yol).read_text(encoding="utf-8"))
    kontrol(veri)
    return veri


def tarih_yaz(iso):
    g = date.fromisoformat(iso)
    return f"{g.day} {AYLAR[g.month - 1]} {g.year}"


def bul(veri, etiket):
    no = etiket.removeprefix("v")
    s = next((s for s in veri["surumler"] if s["surum"] == no), None)
    if s is None:
        raise NotHatasi(f"v{no} için sürüm notu yok. site/guncellemeler.json'a ekleyip etiketi yeniden gönder.")
    if s.get("taslak"):
        raise NotHatasi(f"v{no} hâlâ taslak. site/guncellemeler.json'da \"taslak\": true satırını kaldırıp etiketi yeniden gönder.")
    return s


def baslik(s):
    return f"v{s['surum']} · {s['baslik']}"


def not_yaz(s):
    satirlar = [f"## {s['baslik']}", f"_{tarih_yaz(s['tarih'])}_", ""]
    for tur, ad in TUR.items():
        notlar = [n["metin"] for n in s["notlar"] if n["tur"] == tur]
        if notlar:
            satirlar += [f"**{ad}**", *(f"- {m}" for m in notlar), ""]
    satirlar += [
        f"**Kurulum:** `ParselSorguPlus-Kurulum-{s['surum']}.exe` dosyasını indirip çalıştır. "
        "Eski sürümün üstüne kurulur; önbelleğin ve alanların yerinde kalır.",
        "",
        f"Tüm güncellemeler: {SITE}",
        "",
    ]
    return "\n".join(satirlar)


def main(argv):
    # The Windows console (and the Actions runner) default to a legacy code page.
    for akis in (sys.stdout, sys.stderr):
        akis.reconfigure(encoding="utf-8")
    if len(argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        s = bul(oku(), argv[1])
    except NotHatasi as e:
        print(f"::error::{e}", file=sys.stderr)
        return 1
    hedef = Path(argv[2])
    hedef.parent.mkdir(parents=True, exist_ok=True)
    hedef.write_text(not_yaz(s), encoding="utf-8")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"baslik={baslik(s)}\n")
    print(f"{baslik(s)} → {hedef}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
