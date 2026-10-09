"""Masaüstü başlatıcısı: sunucuyu arka planda açar, uygulamayı kendi penceresinde gösterir.

Pencere, Windows 10/11'de hazır bulunan Edge'in uygulama modudur (adres çubuğu ve sekme yok).
Edge'e ayrı bir profil klasörü verildiği için pencere kapanınca Edge süreci de biter; o zaman
sunucu da kapatılır. Edge bulunamazsa varsayılan tarayıcıda açılır.

Kurulum paketinin giriş noktası budur (packaging/ParselSorgu.spec).
"""

import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

from . import server
from .store import Store

PORT = int(os.environ.get("PARSELSORGU_PORT", "8765"))  # deneme için değiştirilebilir
ADRES = f"http://127.0.0.1:{PORT}/"


def edge_bul():
    adaylar = [
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Edge/Application/msedge.exe",
    ]
    for aday in adaylar:
        if aday.is_file():
            return str(aday)
    return shutil.which("msedge")


def calisiyor_mu():
    """Bu bilgisayarda Parsel Sorgu + zaten açık mı (başka bir pencerenin sunucusu)?"""
    try:
        with urllib.request.urlopen(ADRES + "marka/isaret.svg", timeout=1.5) as r:
            return r.status == 200
    except OSError:
        return False


def pencere_ac():
    """Uygulama penceresini açar; pencere kapanana kadar bekler. Edge yoksa False döner."""
    edge = edge_bul()
    if not edge:
        return False
    profil = server.VERI_KLASORU / "pencere"
    profil.mkdir(parents=True, exist_ok=True)
    # Edge yeni profilde Windows hesabıyla kendiliğinden oturum açıp kullanıcının eklentilerini
    # eşitliyordu (bir eklentinin karşılama sayfası ayrı pencerede açıldı). Eşitleme ve eklentiler
    # kapalı; arka plan modu da kapalı ki pencere kapanınca Edge süreci gerçekten bitsin.
    komut = [edge, f"--app={ADRES}", f"--user-data-dir={profil}", "--window-size=1440,920",
             "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions",
             "--disable-background-mode", "--disable-features=Translate"]
    bayrak = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.run(komut, creationflags=bayrak, check=False)
    return True


def main():
    sahip = not calisiyor_mu()
    sunucu = None
    if sahip:
        sunucu = server.Sunucu(("127.0.0.1", PORT), server.isleyici(server.Uygulama(Store(server.VERI))))
        threading.Thread(target=sunucu.serve_forever, daemon=True).start()
    if not pencere_ac():
        # Edge yok: varsayılan tarayıcı. Sunucu açık kalmalı; pencerenin kapandığı anlaşılamaz.
        webbrowser.open(ADRES)
        if sahip:
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                pass
    if sunucu:
        sunucu.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
