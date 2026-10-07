"""Klasör ya da dosyalardan toplu içe aktarma.

Kullanım:  python -m parselapp.ice_aktar <klasör veya dosya> [...]
"""

import sys
from datetime import datetime
from pathlib import Path

from .importers import ice_aktar, klasor_aktar
from .server import VERI
from .store import Store


def main(yollar):
    if not yollar:
        print(__doc__)
        return 1
    store = Store(VERI)
    for yol in map(Path, yollar):
        if yol.is_dir():
            sonuc = klasor_aktar(store, yol)
            for h in sonuc.pop("hatalar"):
                print("  HATA", h)
        else:
            tarih = datetime.fromtimestamp(yol.stat().st_mtime).isoformat(timespec="seconds")
            sonuc = ice_aktar(store, yol.name, yol.read_bytes(), tarih)
            sonuc.pop("keys")
        print(f"{yol}: {sonuc}")
    print(f"Kayıtta toplam {len(store.listele())} parsel var.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
