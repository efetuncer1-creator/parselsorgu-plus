# PyInstaller tanımı: pyinstaller packaging/ParselSorgu.spec --noconfirm
# Çıktı: dist/ParselSorguPlus/ParselSorguPlus.exe (klasör halinde; Inno Setup bunu kurulum dosyasına koyar)
from pathlib import Path


KOK = Path(SPECPATH).parent

a = Analysis(
    [str(KOK / "packaging" / "giris.py")],
    pathex=[str(KOK)],
    datas=[(str(KOK / "web"), "web")],  # pyproj verisini (proj.db) PyInstaller eklentisi ekler
    hiddenimports=["parselapp.server", "parselapp.masaustu"],
    excludes=["tkinter", "pydoc"],
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
