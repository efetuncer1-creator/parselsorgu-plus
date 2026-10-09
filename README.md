<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/marka/logo-koyu.svg">
    <img src="web/marka/logo.svg" alt="Parsel Sorgu +" width="360">
  </picture>
</p>

# Parsel Sorgu +

TKGM parsel sorgulama ve dışa aktarma aracı. [parselsorgu.tkgm.gov.tr](https://parselsorgu.tkgm.gov.tr/)'nin kullandığı servisten parsel bilgisi ve sınırlarını çeker, kaydeder; KML (Google Earth) ve Excel olarak dışa aktarır.

- Sorgulanan her parsel yerel bir veritabanında tutulur, **aynı parsel için TKGM'ye ikinci kez gidilmez** (TKGM IP başına günlük sorgu limiti uyguluyor).
- Haritaya tıklayarak sorguda, tıklanan nokta kayıtlı bir parselin içindeyse sorgu harcanmaz.
- Alan Yöneticisi (cadplugin) ve parselsorgu'nun kendi KML'leri, `fav_list.json` dosyaları içe aktarılabilir.
- **Alandan parsel tespiti:** OSB/plan sınırını (KML/KMZ, çok katmanlı Netcad projesi dahil) yükle ya da haritada pinle çiz; içindeki/kesişen parselleri seç, kaplanmamış boşlukları gör ve sorgu bütçesiyle TKGM'den tara; sınırla birlikte KML'e, alan içi m²'leriyle Excel'e aktar.
- Excel çıktısında köşe koordinatları **ITRF96 3°** (TUREF, EPSG:5253–5259) ya da **ED50 3°** (EPSG:2319–2325) olarak verilir. Y = sağa, X = yukarı.

## Kurulum

Python 3.11 veya üstü gerekir.

```bash
pip install -r requirements.txt
```

## Çalıştırma

Windows'ta `baslat.bat`'a çift tıkla, ya da:

```bash
python -m parselapp.server
```

Tarayıcıda `http://127.0.0.1:8765/` açılır. Sunucu sadece bu bilgisayardan erişilebilir.

Bir klasördeki KML/JSON dosyalarını komut satırından toplu içe aktarmak için:

```bash
python -m parselapp.ice_aktar "C:\yol\Export Folder"
```

## Testler

TKGM'ye bağlanmaz, örnek dosyalar uydurmadır.

```bash
python -m unittest -v
```

## Yapı

| Dosya | Görev |
|---|---|
| `parselapp/tkgm.py` | TKGM servisine bağlanan tek dosya. TKGM bir şey değiştirirse burası düzeltilir. |
| `parselapp/store.py` | SQLite kaydı, günlük sorgu sayacı |
| `parselapp/importers.py` | KML / GeoJSON içe aktarma |
| `parselapp/exporters.py` | KML ve Excel çıktısı |
| `parselapp/coords.py` | ITRF96 / ED50 3° dönüşümleri |
| `parselapp/referans.py` | Alan (referans) dosyalarını okuma, katmanlar, sınır katmanı önerisi |
| `parselapp/analiz.py` | Alan özeti, boşluklar, boşluk tarama |
| `parselapp/server.py` | Yerel sunucu ve JSON uç noktaları |
| `web/` | Harita ekranı (Leaflet) |
| `data/` | Parsel veritabanı (depoya girmez) |
| `test-kml/` | Elle deneme için gerçek KML'ler; İçe aktar ile yüklenir (depoya girmez) |

## Notlar

- Alanlar TKGM'nin verdiği tapu alanıdır; uygulama alan hesaplamaz.
- TKGM koordinatları yaklaşık 1 m hassasiyettedir (5 ondalık basamak). ED50 dönüşümü EPSG'nin Türkiye parametreleriyle yapılır (yaklaşık ±2 m).
- Veriler TKGM'ye aittir. Servisi aşırı yüklememek için istekler arasında bekleme vardır.
