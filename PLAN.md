# Parsel Sorgu Uygulaması — Plan

Amaç: TKGM Web Alan Yöneticisi'nin (cadplugin.com) yaptığı işi yapan, kodu bizde olan bir uygulama.
Tarih: 7 Ekim 2026

---

## 1. Bildiklerimiz

### TKGM servisi
Mevcut programın önbelleğinden (`wtr/Libraries/cache`) çıkarıldı. Bu bilgileri bulmak için TKGM'ye yeni sorgu atılmadı.

Adres: `https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/`

| İş | Adres |
|---|---|
| İl listesi | `idariYapi/ilListe` |
| İlçe listesi | `idariYapi/ilceListe/{ilId}` |
| Mahalle listesi | `idariYapi/mahalleListe/{ilceId}` |
| Ada/parsel ile sorgu | `parsel/{mahalleId}/{ada}/{parsel}` |
| Haritadaki noktadan sorgu | `parsel/{enlem}/{boylam}/` |

- Cevap biçimi: GeoJSON `Feature`. Geometri bir `Polygon` (WGS84, 5 ondalık basamak, yaklaşık 1 m hassasiyet).
- Gelen bilgiler (`properties`): `ilAd`, `ilceAd`, `mahalleAd`, `ilId`, `ilceId`, `mahalleId`, `adaNo`, `parselNo`, `alan` (metin olarak, `"3.899,35"` biçiminde), `nitelik`, `mevkii`, `pafta`, `zeminKmdurum`, `durum`, `ozet`, `gittigiParselListe`, `gittigiParselSebep`.
- Arka plan haritası: `https://ortofotoapi{0-3}.tkgm.gov.tr/api/tms/1.0.0/TKGM:ortofoto_3857/{z}/{x}/{y}.png`.

### Kısıtlar
- **Günlük sorgu limiti var.** 7 Ekim'de servis `403 "Günlük sorgu limitini aştınız."` cevabı verdi. Limit büyük ihtimalle IP başına. Önbellekte 1.700'den fazla koordinat sorgusu var; haritaya tıklayınca yapılan sorgular da bu limitten düşüyor.
- Servis başka sitelerden doğrudan çağrıya (CORS) izin vermiyor. Bu yüzden sadece tarayıcıda çalışan bir sayfa olmaz, araya küçük bir yerel sunucu gerekiyor.
- TKGM servisini değiştirirse uygulamanın güncellenmesi gerekir. Servise bağlanan kod tek bir dosyada toplanacak ki düzeltmesi kolay olsun.

### Elimizdeki hazır veri
Bu veriler sayesinde geliştirme ve testin çoğu TKGM'ye sorgu atmadan yapılabilir.
- `wtr/Export Folder` ve `wtr/Libraries/Export Folder` içinde 22 KML var. İçlerinde tekrarlarla birlikte yaklaşık 1.600 parsel ve sınır koordinatları bulunuyor.
- `Downloads` klasöründe parselsorgu'dan indirilmiş `tkgm-parsel-sorgu-sonuc-*.kml`, `fav_list*.json` ve `file_list*.kml` dosyaları var.
- Mevcut programın önbelleğinde ham GeoJSON cevapları da var.

---

## 2. Mimari

```
Tarayıcı (harita ekranı)  ⇄  Yerel Python sunucusu (localhost)  ⇄  TKGM servisi
                                     │
                                     └─ SQLite kaydı: her parsel bir kez sorgulanır
```

- **Sunucu:** Python ile, FastAPI (ya da hiç ek kurulum gerektirmeyen `http.server`).
- **Ekran:** Leaflet ile harita, TKGM ortofoto ve OSM arka planları. Tek bir HTML/JS dosyası.
- **Kayıt:** `parseller.db` (SQLite). Anahtar `mahalleId + ada + parsel`. Ham GeoJSON ve sorgu tarihi saklanır.
- **Sorgu yöneticisi:** Sorgular sırayla atılır, aralarında bekleme olur. Günlük sorgu sayacı tutulur; 403 gelince toplu işlem durur ve kaldığı yerden devam edebilir.
- **Çıktılar:** Ayrı bir modül.

### Klasör yapısı
```
efe-parselsorgu/
  server.py          # yerel sunucu ve uç noktalar
  tkgm.py            # TKGM servisine bağlanan TEK dosya
  store.py           # SQLite kaydı
  exporters/         # kml.py, excel.py, geojson.py, dxf.py
  importers.py       # mevcut KML/JSON dosyalarını içe aktarır
  web/index.html     # harita ekranı
  data/parseller.db
  baslat.bat         # çift tıkla çalıştırma
```

---

## 3. Aşamalar

### Aşama 0 — Veri olmadan yapılabilecekler (bugün)
- [x] Proje iskeleti, SQLite şeması.
- [x] **İçe aktarma:** mevcut 22 KML ve indirilenlerdeki KML/JSON dosyalarını veritabanına aktarmak. Tekrarlar ayıklanır, sonuç yaklaşık 1.000 benzersiz parsel olur ve bunlar sorgu harcamadan elde edilir.
- [x] TKGM servis katmanı yazıldı; sahte cevaplarla test edildi. Gerçek servisle testi yapılmadı (limit dolu).
- [x] Harita ekranı: kayıttaki parselleri çizer, tıklayınca bilgi kartını gösterir.
- [x] KML ve Excel çıktısı (tek dosya ya da parsel başına ayrı KML, ITRF96/ED50 köşe koordinatları).

### Aşama 1 — Temel sorgu (ilk gerçek test günü)
- [ ] İl, ilçe, mahalle açılır listeleri. Liste bir kez çekilip kaydedilir.
- [ ] Ada/parsel ile sorgu ve haritaya tıklayarak sorgu.
- [ ] Sorgulanan parseller listesi: seçme, silme, gruplama.
- [ ] Günlük sorgu sayacı ekranda görünür.

### Aşama 2 — Toplu işler
- [ ] Excel'den toplu sorgu (sütunlar: il, ilçe, mahalle, ada, parsel). Önce kayıtta olanlar atlanır, sorgu sırası kaldığı yerden devam edebilir.
- [ ] Haritada alan çizip içindeki parselleri seçme. Yeni sorgu gerektirebilir; dikkatli kullanılmalı.
- [ ] GeoJSON ve DXF çıktısı.
- [ ] Alan ve çevre hesabı; tapu alanıyla hesaplanan alanın karşılaştırması.
- [ ] Çıktı seçenekleri: her parsel ayrı dosya ya da tek birleşik dosya; dosya adlandırma kuralı.

### Aşama 3 — Ekstralar
- [x] Koordinat dönüşümü (`pyproj`): ITRF96 3° ve ED50 3°. Excel ihtiyacı yüzünden Aşama 0'a çekildi.
- [ ] Netcad için koordinat listesi (TXT/CSV) çıktısı. NCZ biçimi kapalı bir biçim; ona yazmak yerine DXF ya da koordinat listesi öneriliyor.
- [ ] `baslat.bat` ya da tek dosyalık `.exe` (PyInstaller).

---

### Aşama 0 sonucu (7 Ekim 2026)
- Mevcut KML'lerden 1.070 benzersiz parsel kayda alındı, TKGM'ye hiç sorgu atılmadı.
- 21 otomatik test geçiyor.
- Aşama 1'in kodu da yazıldı (il/ilçe/mahalle seçimi, ada/parsel ve haritadan sorgu), ama gerçek TKGM ile denenmedi.
- ~~**Yarın ilk iş:** gerçek TKGM testi~~ (9 Ekim'de yapıldı, aşağıya bkz.) (il listesi, bir parsel sorgusu, haritadan bir sorgu) ve TKGM ortofoto katmanı. Bugün ortofoto servisi her karo için boş görüntü döndürdü; şimdilik varsayılan altlık Esri uydu görüntüsü.

### Eklenenler (7 Ekim 2026, öğleden sonra)
- [x] Liste varsayılan olarak boş; gerçek KML'ler `test-kml/` klasöründe, isteyince içe aktarılır.
- [x] Parsele tıklayınca bilgi kartı açılmaz; aktif parselde "⋯" düğmesi çıkar, kart ona tıklayınca açılır.
- [x] **Referans katmanları:** OSB/plan sınırı ya da bütün proje KML/KMZ'si. Katmanlar (KML klasörleri, Netcad katmanları) ayrı ayrı açılıp kapanır. "İçindekileri seç" (%98+) ve "Kesişenleri seç" (%1+) sadece açık katmanlardaki alanı kullanır; kapalı çizgiler alana çevrilir.
- [x] TKGM bağlantısı boşta kapanınca ilk istek düşüyordu; bağlantı hatalarında otomatik yeniden deneme eklendi.
- Not: TKGM ortofoto karoları tarayıcıda `Cross-Origin-Resource-Policy` yüzünden yüklenmiyor (NotSameOrigin), doğrudan çekince de boş geliyor. TKGM bunları kendi sitesi dışında kullanılmaya kapatmış görünüyor; Esri uydu altlığı devam.

### Alandan parsel tespiti (7 Ekim 2026, akşam)
- [x] Arayüz iki sekmeye ayrıldı: **Parsel sorgu** ve **Alandan tespit** (solda dikey sekme çubuğu).
- [x] Alan belirleme: KML/KMZ/GeoJSON sınır dosyası ya da haritada pinle çizim (sürüklenebilir pinler, ilk pine tıklayınca kapanır, Ctrl+Z/Esc/Enter).
- [x] Çok katmanlı projelerde **alan sınırı katmanı** seçimi; ad ipuçlarıyla otomatik öneri (SNR/SINIR/HUDUT + OSB, pafta indeksi hariç). Hesaplar sadece bu katmanla; diğer katmanlar çizgi olarak görünür.
- [x] Alan özeti: büyüklük (m² / dönüm), tamamen içindeki ve kesişen parseller, tapu toplamı, kaplanma oranı, nitelik dağılımı.
- [x] Boşlukları göster; **boşlukları TKGM'den tara** (kullanıcının verdiği sorgu bütçesiyle, en büyük boşluğun iç teğet çember merkezinden; parsel çıkmayan noktalar işaretlenir; 12 m'den dar / 100 m²'den küçük artıklar sorgulanmaz).
- [x] Alan dışa aktarma: KML'e sınır klasörü, Excel'e "alan içinde m²" ve oran sütunları.
- Tarama gerçek TKGM ile henüz denenmedi (limit); sahte cevaplarla test edildi.
- İsim: **Parsel Sorgu +** (9 Ekim 2026). Logo: mavi artı = parsel köşe noktası, sarı merkez = parsel rengi; harfler elle çizildi (araclar/marka_uret.py).

### Oturum ve önbellek (7 Ekim 2026, akşam)
- [x] Sayfa açılışı/yenileme = yeni oturum: parsel listesi, harita ve alanlar boş başlar.
- [x] Parseller arka planda önbellekte kalır (data/parseller.db); yeni oturumda tekrar sorgulanınca/haritadan tıklanınca/taramada TKGM'ye gidilmeden gelir. "Listeden çıkar" sadece oturumdan çıkarır.
- [x] Alan özeti, seçim ve tarama sadece oturumdaki parsellerle çalışır; tarama önbellekteki parselleri sorgu harcamadan oturuma ekler.
- [x] Tarayıcının prompt/confirm kutuları gömülü tarayıcıda "iptal" sayıldığı için alan kapanmıyordu → uygulama içi pencere. Alan çift tıklamayla ve Enter ile de kapanır.

### Canlı TKGM testi ve düzeltmeler (9 Ekim 2026)
- [x] Canlı test: il/ilçe/mahalle listeleri, ada/parsel sorgusu, haritadan sorgu, önbellek ve boşluk tarama gerçek TKGM ile çalışıyor (10 sorgu).
- [x] Hata: haritadan (koordinatla) sorgu alanı İngilizce biçimde döndürüyor ("29,636.19"); çözücü iki biçimi de okuyor, alan metni Türkçe biçimde saklanıyor, önbellekteki 112 kayıt düzeltildi.
- [x] TKGM servisi parselsorgu'nun Referer/Origin başlıkları olmadan da cevap veriyor; uygulama artık kendi adıyla istek atıyor.
- [x] İl/ilçe/mahalle Türkçe alfabe sırasında; yazarak aranabilen liste, seçince sonraki liste açılır.
- [x] Uydu üstüne açılıp kapanan yer adları/sınırlar/yollar katmanı (Esri Reference).
- [x] Yakın zoomda "Map data not yet available" yerine bir üst seviyenin görüntüsü büyütülür (blankTile=false + yedek karo).
- [x] TKGM ortofoto seçeneği kaldırıldı: karoları her istekte boş geliyor, dış kullanıma kapalı.
- [x] Seçim çubuğundan KML/Excel düğmeleri kaldırıldı; limit dolunca sayaçta sadece "Limit doldu" ve alttan "TKGM günlük sorgu limiti aşıldı." uyarısı.

### Açılır listeler, tarama deseni, sunucu (9 Ekim 2026, öğleden sonra)
- [x] Koordinat sistemi, dilim ve alan sınırı da uygulamanın kendi listesine geçti (tarayıcı listesi Windows koyu temada okunmuyordu); aşağıda yer yoksa yukarı açılır.
- [x] Yakın zoom hızlandı: bölgede görüntünün bittiği seviye öğrenilir, sonraki karolar doğrudan oradan istenir (zoom 20'de 12 karo için ~24 yerine 13 istek).
- [x] Alanların içi çapraz çizgili (SVG deseni), seçili alanın çizgileri daha belirgin.
- [x] "Önbelleği atla" anahtarı "Her zaman güncel halini TKGM'den al" oldu, açıklamasıyla.
- [x] Hata: Windows'ta iki sunucu aynı portu açabiliyordu, istekler eski koda gidiyordu ve yeni oturum bir alanı sildi. Artık ikinci başlatma "zaten çalışıyor" deyip çıkar; yeni oturum sadece 24 saattir kullanılmayan alanları temizler. Silinen alan aynı numarayla geri yüklendi.

### Paylaşım: kurulum, GitHub, site, video (9 Ekim 2026, akşam)
- [x] Masaüstü uygulaması: `parselapp/masaustu.py` sunucuyu açar, Chrome'u (yoksa Edge'i) ayrı profille uygulama penceresi olarak açar; pencere kapanınca sunucu da kapanır. Eşitleme, eklentiler ve arka plan modu kapalı (Edge yeni profilde Windows hesabıyla oturum açıp eklenti indiriyordu).
- [x] Kurulum dosyası: PyInstaller (`packaging/ParselSorgu.spec`) + Inno Setup (`packaging/kurulum.iss`). `v*` etiketi gönderilince GitHub Actions (`.github/workflows/surum.yml`) test edip derler ve Releases'a ekler. Veri `%LOCALAPPDATA%\ParselSorguPlus`'ta.
- [x] Açık depo: github.com/efetuncer1-creator/parselsorgu-plus, ilk sürüm v0.1.0.
- [x] Kapsamlı test: 51 birim testi, 52 API kontrolü, arayüz baştan sona. Bulunan hatalar: ad penceresinde Enter iptal ediyordu, çizimi bitiren Enter pencereyi anında kapatıyordu, seçici satırının sadece küçük bir kısmı tıklanıyordu, alan değişince eski tarama sonucu kalıyordu, açık temada altlık seçici okunmuyordu.
- [x] TKGM'nin ı/i hatası: anahtarda ı ile i aynı sayılır, adlar idari listelerden düzeltilir, aynı yerin yazımları birleştirilir (tek seferlik veritabanı geçişi). TKGM'nin hiç doğru vermediği adlar (ör. "Altindağ") düzeltilemiyor.
- [x] Tarayıcıya ait öğeler (doğrulama balonu, title ipuçları, renk seçici, arama "x"i, sayı okları, katman işaret kutuları) uygulamanın kendi bileşenleriyle değişti.
- [x] Tanıtım sitesi (`site/`, Vercel: parselsorgu-plus.vercel.app). Görüntüler Konya/Çumra'da çizilen bir alanın uygulamanın kendi taramasıyla (40 sorgu, 38 parsel) doldurulmasıyla alındı; kullanıcının iş verisi kullanılmadı.
- [x] Tanıtım videosu (`video/`, HyperFrames, 35 sn, 1920×1080).

## 4. Test planı
- **Veri olmadan:** içe aktarma, çıktılar ve harita ekranı mevcut KML'ler ve önbellekteki cevaplarla test edilir.
- **Dışa aktarma kontrolü:** çıkan KML'ler Google Earth'te, DXF'ler Netcad/AutoCAD'de açılır. Alanlar tapu alanıyla karşılaştırılır.
- **Gerçek sorgu:** test günü başına en fazla yaklaşık 20 sorgu. İl/ilçe/mahalle listeleri birkaç sorgu harcar, gerisi parsel sorgusu.
- **Karşılaştırma:** aynı parsel için Alan Yöneticisi'nin ve bizim uygulamanın çıktısı yan yana konup kontrol edilir.

---

## 5. Kararlar (7 Ekim 2026)
1. **Çıktılar:** Öncelik KML ve Excel. DXF ve GeoJSON sonraya kaldı.
2. **Koordinat sistemleri:** ITRF96 3° (TUREF / TM27–TM45, EPSG:5253–5259) ve ED50 3° (EPSG:2319–2325). ED50 için EPSG'nin Türkiye dönüşümü kullanılıyor ("ED50 to WGS 84 (30)", yaklaşık ±2 m). Excel'e köşe koordinatları Y (sağa) ve X (yukarı) olarak yazılıyor.
3. **İş büyüklüğü:** İşe göre değişiyor. Toplu sorgunun limitte durup kaldığı yerden devam edebilmesi gerekiyor.
4. **Kullanan kişi:** İlk aşamada tek kullanıcı. Daha sonra kaynak koduyla birlikte GitHub'a yüklenecek. Bu yüzden müşteri/parsel verisi depoya girmemeli (`data/` klasörü `.gitignore`'da, testlerde sadece uydurma veri).
5. **Tasarım:** Önce çalışan, sade bir arayüz. Görsel tasarım daha sonra mevcut design skill'leriyle yapılacak. Renkler ve boşluklar şimdiden CSS değişkenlerinde toplanıyor ki sonradan kolay değişsin.
