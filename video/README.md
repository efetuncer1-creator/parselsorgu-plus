# Tanıtım videosu

`index.html` bir [HyperFrames](https://www.npmjs.com/package/hyperframes) kompozisyonudur (1920×1080, 39,6 sn zaman çizelgesi). Bitmiş video: [parsel-sorgu-tanitim.mp4](parsel-sorgu-tanitim.mp4) (~33 sn).

Açılıştaki dalış, `assets/dalis/` içindeki 12 uydu plakasından (yakınlaştırma 4–15, hepsi aynı noktaya ortalı) kurulur; ince plaka kaba olanın üstünde yumuşak kenarlı bir pencere olarak belirip büyür. Uygulama ekranları `site/assets`'ten gelir; fontlar (Anton, Inter, SIL OFL) `fonts/` içinde yereldir, render internete bağlı değildir.

## Render

Video 1,2 kat hızlı yayınlanır: kompozisyon saniyede 25 kareyle render edilip saniyede 30 kareyle oynatılır. Her kare kullanılır, kare atlanmaz.

```bash
npx hyperframes render . --fps 25 -o renders/tanitim-25fps.mp4
```

```bash
ffmpeg -itsscale 0.8333333 -i renders/tanitim-25fps.mp4 -r 30 -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart renders/parsel-sorgu-tanitim.mp4
```

Depodaki ve sitedeki kopyalar bundan daha sıkıştırılmış olarak üretilir (CRF 22 ve 26).

Kontrol için: `npx hyperframes lint .` ve `npx hyperframes snapshot . --at 2.5,7.5,12.5,18.5,24,33.5`.
