"""Masaüstü başlatıcısı: sunucuyu arka planda açar, uygulamayı kendi penceresinde gösterir.

Pencere, Chrome'un (yoksa her Windows 10/11'de hazır gelen Edge'in) uygulama modudur: adres
çubuğu ve sekme yok. Tarayıcıya ayrı bir profil klasörü verildiği için pencere kapanınca tarayıcı
süreci de biter; o zaman sunucu da kapatılır. İkisi de bulunamazsa varsayılan tarayıcıda açılır.

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


def tarayici_bul():
    """Uygulama penceresini açacak tarayıcı: (ad, exe yolu). Önce Chrome; yoksa her Windows 10/11'de
    hazır gelen Edge. İkisi de yoksa (None, None)."""
    kokler = [Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
              Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
              Path(os.environ.get("LOCALAPPDATA", ""))]
    for ad, alt_yol, komut in (("chrome", "Google/Chrome/Application/chrome.exe", "chrome"),
                               ("edge", "Microsoft/Edge/Application/msedge.exe", "msedge")):
        for kok in kokler:
            if (kok / alt_yol).is_file():
                return ad, str(kok / alt_yol)
        if shutil.which(komut):
            return ad, shutil.which(komut)
    return None, None


def calisiyor_mu():
    """Bu bilgisayarda Parsel Sorgu + zaten açık mı (başka bir pencerenin sunucusu)?"""
    try:
        with urllib.request.urlopen(ADRES + "marka/isaret.svg", timeout=1.5) as r:
            return r.status == 200
    except OSError:
        return False


def pencere_ac():
    """Uygulama penceresini açar; pencere kapanana kadar bekler. Uygun tarayıcı yoksa False döner."""
    ad, exe = tarayici_bul()
    if not exe:
        return False
    # Ayrı profil: pencere kapanınca süreç biter, kullanıcının kendi tarayıcısına dokunulmaz.
    # Chrome ve Edge aynı profil klasörünü paylaşamaz.
    profil = server.VERI_KLASORU / f"pencere-{ad}"
    profil.mkdir(parents=True, exist_ok=True)
    # Edge yeni profilde Windows hesabıyla kendiliğinden oturum açıp kullanıcının eklentilerini
    # eşitliyordu (bir eklentinin karşılama sayfası ayrı pencerede açıldı). Eşitleme ve eklentiler
    # kapalı; arka plan modu da kapalı ki pencere kapanınca tarayıcı süreci gerçekten bitsin.
    komut = [exe, f"--app={ADRES}", f"--user-data-dir={profil}", "--window-size=1440,920",
             "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions",
             "--disable-background-mode", "--disable-features=Translate"]
    bayrak = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.run(komut, creationflags=bayrak, check=False)
    return True


def main():
    sahip = not calisiyor_mu()
    sunucu = None
    if sahip:
        uyg = server.Uygulama(Store(server.VERI))
        sunucu = server.Sunucu(("127.0.0.1", PORT), server.isleyici(uyg))
        threading.Thread(target=sunucu.serve_forever, daemon=True).start()
        uyg.guncelleme.baslat()  # pencere açılırken GitHub'daki son sürüme bakılır
    if not pencere_ac():
        # Chrome da Edge de yok: varsayılan tarayıcı. Sunucu açık kalmalı; pencerenin kapandığı anlaşılamaz.
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
