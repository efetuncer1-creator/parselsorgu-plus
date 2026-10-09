# PyInstaller tanımı: pyinstaller packaging/ParselSorgu.spec --noconfirm
# Çıktı: dist/ParselSorguPlus/ParselSorguPlus.exe (klasör halinde; Inno Setup bunu kurulum dosyasına koyar)
from pathlib import Path


KOK = Path(SPECPATH).parent
WEB = KOK / "web"


def web_dosyalari():
    """Pakete yalnızca arayüz dosyaları girer: adında "test" geçen ya da "_" / "." ile başlayan
    klasör ve dosyalar (deneme kopyaları, geçici test verisi) atlanır."""
    for yol in sorted(WEB.rglob("*")):
        parcalar = yol.relative_to(WEB).parts
        if yol.is_file() and not any(p.startswith(("_", ".")) or "test" in p.lower() for p in parcalar):
            yield str(yol), str(Path("web", *parcalar[:-1]))


a = Analysis(
    [str(KOK / "packaging" / "giris.py")],
    pathex=[str(KOK)],
    datas=list(web_dosyalari()),  # pyproj verisini (proj.db) PyInstaller eklentisi ekler
    hiddenimports=["parselapp.server", "parselapp.masaustu"],
    excludes=["tkinter", "pydoc", "tests"],  # bizim testlerimiz pakete girmez
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ParselSorguPlus",
    console=False,
    icon=str(KOK / "packaging" / "ParselSorgu.ico"),
)
coll = COLLECT(exe, a.binaries, a.datas, name="ParselSorguPlus")
