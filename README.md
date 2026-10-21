<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-koyu.svg">
    <img src="assets/logo.svg" alt="Parsel Sorgu +" width="360">
  </picture>
</p>

<p align="center">
  <b>TKGM parsel sorgulama, alan ve parsel analizi, eğim ve paftalı çıktı için Windows uygulaması.</b><br>
  Ücretsiz · Windows 10/11 · Kurulum yönetici izni istemez
</p>

<p align="center">
  <a href="https://github.com/efetuncer1-creator/parselsorgu-plus/releases/latest"><b>⬇ Son sürümü indir</b></a>
  &nbsp;·&nbsp;
  <a href="https://parselsorgu-plus.vercel.app">Tanıtım sitesi</a>
  &nbsp;·&nbsp;
  <a href="https://parselsorgu-plus.vercel.app/guncellemeler">Güncellemeler</a>
</p>

![Excel analizi: görüşme tablosu parsellerle eşleşmiş, parseller görüşme durumuna göre renkli](https://parselsorgu-plus.vercel.app/assets/uygulama-excel-1920.webp)

## Neler yapar

- **Sorgula:** İl, ilçe, mahalleyi yazarak seç, ada/parseli gir ya da haritada parsele tıkla. Sorgulanan her parsel bilgisayarında saklanır; **aynı parsel için TKGM'ye ikinci kez gidilmez**, günlük limitin boşa gitmez. Ada/parsel listesi ya da Excel'le **toplu sorgu**.
- **Alandan parsel tespiti:** OSB ya da plan sınırını yükle (KML, KMZ, Netcad/AutoCAD DXF) veya haritada çiz. İçindeki ve kesişen parselleri bul, boşlukları gör, sorgu bütçesiyle TKGM'den tara.
- **Analiz:** Parsel türleri, ada/parsel tablosu ve **kamulaştırma listesi** (tapu alanı, alan içi ve kalan m²).
- **Excel analizi:** Kendi tablonu (malik listesi, görüşme durumu, bedel…) Ada/Parsel sütunlarıyla parsellere eşle; dağılım grafiği ve harita renkleri.
- **Elle renklendirme:** Parselleri seç, kendi gruplarına ata (“1. etap”, “Kamulaştırılacak”…); ad ve renk senin.
- **Mekânsal analiz:** Eğim, yükseklik, bakı, güneşlenme, kazı/dolgu, eşyükselti eğrileri ve kesit (Copernicus DEM, 30 m).
- **Görsel:** Katmanlar, yazı, nokta, ölçü, çizgi, koridor, ifraz taslağı; taranmış planı kontrol noktalarıyla oturtma; lejant.
- **Çıktı ve rapor:** A4/A3 ya da paftalara bölünmüş PDF, kurum antetli PDF rapor; KML, Excel (ITRF96 / ED50 3° köşe koordinatları), DXF ve KMZ.
- **Proje:** Bütün çalışma tek `.parselsorgu` dosyasında; başka bilgisayarda TKGM'ye sorgu atmadan açılır.

<table>
  <tr>
    <td><img src="https://parselsorgu-plus.vercel.app/assets/uygulama-manuel-1200.webp" alt="Elle renklendirme: parseller üç grupta, dağılım grafiği"></td>
    <td><img src="https://parselsorgu-plus.vercel.app/assets/uygulama-mekansal-1200.webp" alt="Mekânsal analiz: eğim haritası ve özet"></td>
  </tr>
  <tr>
    <td align="center">Elle renklendirme</td>
    <td align="center">Mekânsal analiz</td>
  </tr>
  <tr>
    <td><img src="https://parselsorgu-plus.vercel.app/assets/uygulama-alan-1200.webp" alt="Alandan parsel tespiti: alan, içindeki ve kesişen parseller, boşluklar"></td>
    <td><img src="https://parselsorgu-plus.vercel.app/assets/uygulama-katmanlar-1200.webp" alt="Katmanlar: nokta, yazı, ölçü ve alan; ayarlar listenin altında"></td>
  </tr>
  <tr>
    <td align="center">Alandan parsel tespiti</td>
    <td align="center">Katmanlar</td>
  </tr>
</table>

## Kurulum

1. [Son sürümden](https://github.com/efetuncer1-creator/parselsorgu-plus/releases/latest) `ParselSorguPlus-Kurulum-x.y.z.exe` dosyasını indir ve çalıştır.
2. Kurulum dosyası henüz imzalı değil: Windows “bilgisayarınızı korudu” derse **Ek bilgi → Yine de çalıştır**.
3. Başlat menüsünden **Parsel Sorgu +**'yı aç. Uygulama kendi penceresinde açılır (Chrome; yoksa Edge). Yeni sürüm çıkınca uygulama haber verir.

- Sorgular senin bilgisayarından gider; TKGM'nin günlük sorgu limiti her kullanıcının kendisinindir.
- Verilerin (önbellek, projeler) yalnız bilgisayarında, `%LOCALAPPDATA%\ParselSorguPlus` klasöründe durur.

---

Bu depoda yalnız kurulum dosyaları ve sürüm notları yayınlanır.
