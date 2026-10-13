"use strict";

// ================================================================================
// Eğim ve yükseklik: Copernicus DEM GLO-30 (30 m)
// ================================================================================
// Sunucu bölgenin yükseklik ızgarasını verir (/api/yukseklik): ilk seferde internetten indirilir, sonra veri
// klasöründen gelir. Eğim, sınıflar, haritadaki görüntü, alan ve parsel istatistikleri ve kesit tarayıcıda
// hesaplanır. Eğim Horn yöntemiyle (3x3 komşuluk) yüzde olarak bulunur: %100 = 45°.
// Bu sekmedeki görüntü önizlemedir; "Katman olarak ekle" onu Görsel sekmesine kilitli bir görsel olarak koyar:
// çıktıya, projeye ve lejanta öyle girer. 30 m'lik yüzey modelidir (binalar ve ağaçlar dahil): ön değerlendirme
// içindir. app.js (harita, durum, notlar, lejant) ve analiz.js'teki (tablolar, Excel) yardımcıları kullanır.

// Sıralı renkler (açıktan koyuya, renk körlüğünde de sıra okunur): eğim ColorBrewer YlOrRd, yükseklik viridis.
const EGIM_RENKLERI = ["#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"]; // en açık ton beyaz kağıtta seçilmiyor
const KOT_RENKLERI = ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"];
const EGIM_SINIRLARI = [2, 5, 10, 15, 20, 30]; // %; imar ve jeolojik etütlerde yaygın sınırlar
const KOT_ARALIKLARI = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];
const EGIM_HUCRE = 3600, EGIM_EN_COK = 1500 * 1500, EGIM_KATLAR = [1, 2, 4, 8]; // parselapp/yukseklik.py ile aynı
const EGIM_ONIZLEME_SATIR = 8;

const egim = {
  kapsam: "alan", alanId: null,
  tur: "egim", acik: true, opaklik: 70, kirp: true, kabartma: false, siniflar: [...EGIM_SINIRLARI], kotAraligi: 0,
  iz: null, // yükseklik ızgarası: { veri, egim, golge?, bati, kuzey, adim, en, boy } (bati/kuzey: ilk noktanın yeri)
  bolge: null, sonuc: null, goruntu: null, katman: null,
  surum: 0, zamanlayici: 0, cizim: 0,
};
try {
  const k = JSON.parse(localStorage.getItem("egim") || "{}");
  if (["alan", "secili", "tumu"].includes(k.kapsam)) egim.kapsam = k.kapsam;
  if (["egim", "yukseklik"].includes(k.tur)) egim.tur = k.tur;
  if (Number.isFinite(k.opaklik)) egim.opaklik = Math.min(100, Math.max(10, k.opaklik));
  if (typeof k.kirp === "boolean") egim.kirp = k.kirp;
  if (typeof k.kabartma === "boolean") egim.kabartma = k.kabartma;
  if (Array.isArray(k.siniflar) && sinirlarGecerli(k.siniflar)) egim.siniflar = k.siniflar;
  if (KOT_ARALIKLARI.includes(k.kotAraligi)) egim.kotAraligi = k.kotAraligi;
} catch { /* varsayılanlar */ }
const egimKaydet = () => {
  const { kapsam, tur, opaklik, kirp, kabartma, siniflar, kotAraligi } = egim;
  try { localStorage.setItem("egim", JSON.stringify({ kapsam, tur, opaklik, kirp, kabartma, siniflar, kotAraligi })); } catch { /* önemli değil */ }
};
const egimSekmesinde = () => !$("panel-egim").hidden;

function sinirlarGecerli(s) {
  return s.length >= 1 && s.length <= 8 && s.every((v, i) => Number.isFinite(v) && v > 0 && v < 1000 && (i === 0 || v > s[i - 1]));
}

// ---- sınıflar ve renkler ------------------------------------------------------------------------------

// k renk: paletten eşit aralıkla (ara tonlar doğrusal karışım)
function paletRenkleri(palet, k) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Array.from({ length: k }, (_, i) => {
    const t = k === 1 ? 0.5 : (i * (palet.length - 1)) / (k - 1), a = Math.floor(t), b = Math.min(palet.length - 1, a + 1), f = t - a;
    const [r1, g1, b1] = rgb(palet[a]), [r2, g2, b2] = rgb(palet[b]);
    return `#${[r1 + (r2 - r1) * f, g1 + (g2 - g1) * f, b1 + (b2 - b1) * f].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  });
}

const sinirMetni = (v) => sayi(v, Number.isInteger(v) ? 0 : 1);

function egimSiniflari() {
  const s = egim.siniflar, renk = paletRenkleri(EGIM_RENKLERI, s.length + 1);
  return renk.map((r, i) => ({
    alt: i ? s[i - 1] : 0, ust: s[i] ?? Infinity, renk: r,
    ad: i === s.length ? `%${sinirMetni(s[i - 1])} ve üzeri` : `%${i ? sinirMetni(s[i - 1]) : 0}–${sinirMetni(s[i])}`,
  }));
}

// Yükseklik sınıfları bölgenin en düşük ve en yüksek kotundan: aralık otomatikse en fazla 8 sınıf
function kotSiniflari(enAz, enCok) {
  const fark = Math.max(enCok - enAz, 0.1);
  let adim = egim.kotAraligi || KOT_ARALIKLARI.find((a) => fark / a <= 8) || 500;
  if (fark / adim > 24) adim = KOT_ARALIKLARI.find((a) => fark / a <= 24) || 500; // çok ince aralık okunmaz
  const bas = Math.floor(enAz / adim) * adim, k = Math.max(1, Math.ceil((enCok - bas) / adim));
  const renk = paletRenkleri(KOT_RENKLERI, k);
  return renk.map((r, i) => ({ alt: bas + i * adim, ust: bas + (i + 1) * adim, renk: r, ad: `${sinirMetni(bas + i * adim)}–${sinirMetni(bas + (i + 1) * adim)} m` }));
}

const sinifBul = (v, siniflar) => { let i = 0; while (i < siniflar.length - 1 && v >= siniflar[i].ust) i++; return i; };

// ---- ızgara -------------------------------------------------------------------------------------------

async function yukseklikAl([bati, guney, dogu, kuzey]) {
  const r = await postJson("yukseklik", { bbox: [bati, guney, dogu, kuzey] });
  const bilgi = JSON.parse(r.headers.get("X-Izgara"));
  const iz = { ...bilgi, veri: new Float32Array(await r.arrayBuffer()) };
  iz.egim = egimIzgarasi(iz);
  return iz;
}

// Horn yöntemi: 3x3 komşulukla doğu-batı ve kuzey-güney eğimleri; sonuç yüzde (100 · tan α). Kenarda NaN.
// Aynı türevlerden gölgeli kabartma (ışık kuzeybatıdan, 45° yükseklikten; ESRI'nin formülü) de çıkar.
function egimIzgarasi({ veri, en, boy, adim, kuzey }, golge = null) {
  const e = new Float32Array(en * boy).fill(NaN);
  const zenit = (45 * Math.PI) / 180, azimut = ((360 - 315 + 90) * Math.PI) / 180;
  for (let i = 1; i < boy - 1; i++) {
    const [mx, my] = metreOlcegi(kuzey - i * adim), dx = 8 * adim * mx, dy = 8 * adim * my;
    for (let j = 1; j < en - 1; j++) {
      const k = i * en + j;
      const a = veri[k - en - 1], b = veri[k - en], c = veri[k - en + 1], d = veri[k - 1], f = veri[k + 1];
      const g = veri[k + en - 1], h = veri[k + en], ii = veri[k + en + 1];
      const x = (c + 2 * f + ii - a - 2 * d - g) / dx, y = (g + 2 * h + ii - a - 2 * b - c) / dy;
      e[k] = 100 * Math.hypot(x, y);
      if (golge) {
        const s = Math.atan(Math.hypot(x, y));
        let baki = Math.atan2(y, -x);
        if (baki < 0) baki += 2 * Math.PI;
        golge[k] = Math.max(0, Math.cos(zenit) * Math.cos(s) + Math.sin(zenit) * Math.sin(s) * Math.cos(azimut - baki));
      }
    }
  }
  return e;
}

function golgeIzgarasi(iz) {
  if (!iz.golge) {
    iz.golge = new Float32Array(iz.en * iz.boy).fill(NaN);
    egimIzgarasi(iz, iz.golge);
  }
  return iz.golge;
}

// Çift doğrusal ara değer; ızgara dışında ya da boş komşuda NaN.
function ornekle(dizi, iz, enlem, boylam) {
  const x = (boylam - iz.bati) / iz.adim, y = (iz.kuzey - enlem) / iz.adim;
  const j = Math.floor(x), i = Math.floor(y);
  if (j < 0 || i < 0 || j >= iz.en - 1 || i >= iz.boy - 1) return NaN;
  const fx = x - j, fy = y - i, k = i * iz.en + j;
  return (dizi[k] * (1 - fx) + dizi[k + 1] * fx) * (1 - fy) + (dizi[k + iz.en] * (1 - fx) + dizi[k + iz.en + 1] * fx) * fy;
}

// Sunucunun bu kutu için seçeceği nokta aralığı: büyük bölgede küçültülmüş kopya (yukseklik.py izgara ile aynı kural)
function beklenenAdim([w, s, e, n]) {
  for (const f of EGIM_KATLAR) {
    const satir = Math.ceil(((n - s) * EGIM_HUCRE) / f) + 6, sutun = Math.ceil(((e - w) * EGIM_HUCRE) / f) + 6;
    if (satir * sutun <= EGIM_EN_COK) return f / EGIM_HUCRE;
  }
  return Infinity;
}

// Izgaranın kuzey-güney nokta aralığı (10 m'ye yuvarlı): tam çözünürlükte ~30 m, büyük bölgede 60/120/240 m
const egimCozunurlugu = (iz) => Math.max(10, Math.round((iz.adim * metreOlcegi(iz.kuzey)[1]) / 10) * 10);
const egimKaynagi = () => `Copernicus DEM GLO-30, ${egim.iz?.kat > 1 ? `~${egimCozunurlugu(egim.iz)}` : 30} m`;

// Kutu ızgaranın eğimi hesaplanmış (kenar dışı) kısmında mı?
const izgaraKapsar = (iz, [w, s, e, n]) => !!iz && w >= iz.bati + iz.adim && e <= iz.bati + (iz.en - 2) * iz.adim
  && n <= iz.kuzey - iz.adim && s >= iz.kuzey - (iz.boy - 2) * iz.adim;

// Izgara kutuyu kaplıyor ve kutuya göre yeterince ince mi (büyük bölgeden kalan kaba ızgara küçük bölgede kullanılmaz)
const izgaraUygun = (iz, kutu) => izgaraKapsar(iz, kutu) && iz.adim <= beklenenAdim(kutu) * 1.0001;

// Kutunun çevresine pay: harita görüntüsü kırpılmadığında çevre de görünsün
function payliKutu([w, s, e, n]) {
  const pw = Math.max(0.002, (e - w) * 0.08), ph = Math.max(0.002, (n - s) * 0.08);
  return [w - pw, s - ph, e + pw, n + ph];
}

// ---- bölge: alan ya da parseller ---------------------------------------------------------------------

const poligonlari = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);

function kutusu(halkalar) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const h of halkalar) for (const [x, y] of h) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

function tumKoordinatlar(g) {
  if (g.type === "Point") return [[g.coordinates]];
  if (g.type === "LineString" || g.type === "MultiPoint") return [g.coordinates];
  if (g.type === "Polygon" || g.type === "MultiLineString") return g.coordinates;
  if (g.type === "MultiPolygon") return g.coordinates.flat();
  if (g.type === "GeometryCollection") return g.geometries.flatMap(tumKoordinatlar);
  return [];
}

function egimBolgesi() {
  if (egim.kapsam === "alan") {
    const r = referanslar.get(egim.alanId)?.veri;
    if (!r) return { hata: referanslar.size ? "Bir alan seç ya da bölgeyi değiştir." : "Henüz alan yok: Alan sekmesinde sınır yükle ya da çiz, ya da parselleri seç." };
    const fs = sinirFc(r).features;
    let poligonlar = fs.flatMap((f) => poligonlari(f.geometry));
    const kutu = kutusu(fs.flatMap((f) => tumKoordinatlar(f.geometry)));
    if (!Number.isFinite(kutu[0])) return { hata: "Alanda geometri yok." };
    const acik = !poligonlar.length; // kapalı sınır yoksa (sadece çizgiler) bütün kutu
    if (acik) poligonlar = [[[[kutu[0], kutu[1]], [kutu[2], kutu[1]], [kutu[2], kutu[3]], [kutu[0], kutu[3]], [kutu[0], kutu[1]]]]];
    return { tur: "alan", ad: r.ad, poligonlar, kutu, alan: r, acik };
  }
  const keys = egim.kapsam === "secili" ? [...durum.secili] : [...durum.parseller.keys()];
  const parseller = keys.map((k) => durum.parseller.get(k)).filter(Boolean);
  if (!parseller.length) return { hata: egim.kapsam === "secili" ? "Seçili parsel yok: listeden ya da haritadan parsel seç." : "Listede parsel yok." };
  const poligonlar = parseller.flatMap((f) => poligonlari(f.geometry));
  return { tur: "parsel", ad: egim.kapsam === "secili" ? "Seçili parseller" : "Listedeki parseller", poligonlar, kutu: kutusu(poligonlar.map((p) => p[0])), parseller };
}

// ---- istatistik -------------------------------------------------------------------------------------

// Poligonun içine düşen ızgara noktaları, satır satır (çift-tek kuralı: delikler dışarıda). fn(i, j)
function hucreleriGez(iz, pol, fn) {
  const kenarlar = [];
  for (const h of pol) for (let a = 0, b = h.length - 1; a < h.length; b = a++) if (h[a][1] !== h[b][1]) kenarlar.push([h[b][0], h[b][1], h[a][0], h[a][1]]);
  const [, s, , n] = kutusu([pol[0]]);
  const i0 = Math.max(0, Math.ceil((iz.kuzey - n) / iz.adim)), i1 = Math.min(iz.boy - 1, Math.floor((iz.kuzey - s) / iz.adim));
  for (let i = i0; i <= i1; i++) {
    const enlem = iz.kuzey - i * iz.adim, xs = [];
    for (const [x1, y1, x2, y2] of kenarlar) if ((y1 > enlem) !== (y2 > enlem)) xs.push(x1 + ((enlem - y1) * (x2 - x1)) / (y2 - y1));
    xs.sort((a, b) => a - b);
    for (let t = 0; t + 1 < xs.length; t += 2) {
      const j0 = Math.max(0, Math.ceil((xs[t] - iz.bati) / iz.adim)), j1 = Math.min(iz.en - 1, Math.floor((xs[t + 1] - iz.bati) / iz.adim));
      for (let j = j0; j <= j1; j++) fn(i, j);
    }
  }
}

// Noktalar üzerinden: kot (en az, en çok, ortalama), eğim (ortalama, en çok), sınıfların alanı (m²).
// tekil: üst üste binen poligonlarda nokta bir kez sayılır (alanın birden çok parçası olabilir).
function topla(iz, poligonlar, siniflar, tekil = false) {
  const t = { n: 0, alan: 0, kotMin: Infinity, kotMax: -Infinity, kotTop: 0, egimN: 0, egimTop: 0, egimMax: -Infinity, sinif: new Float64Array(siniflar.length) };
  const gorulen = tekil && poligonlar.length > 1 ? new Uint8Array(iz.en * iz.boy) : null;
  const satirAlani = new Map();
  for (const pol of poligonlar) {
    hucreleriGez(iz, pol, (i, j) => {
      const k = i * iz.en + j;
      if (gorulen) { if (gorulen[k]) return; gorulen[k] = 1; }
      const z = iz.veri[k];
      if (!Number.isFinite(z)) return;
      let a = satirAlani.get(i);
      if (a === undefined) { const [mx, my] = metreOlcegi(iz.kuzey - i * iz.adim); a = iz.adim * mx * iz.adim * my; satirAlani.set(i, a); }
      t.n++; t.alan += a; t.kotTop += z;
      if (z < t.kotMin) t.kotMin = z;
      if (z > t.kotMax) t.kotMax = z;
      const e = iz.egim[k];
      if (Number.isFinite(e)) {
        t.egimN++; t.egimTop += e;
        if (e > t.egimMax) t.egimMax = e;
        t.sinif[sinifBul(e, siniflar)] += a;
      }
    });
  }
  t.kotOrt = t.n ? t.kotTop / t.n : NaN;
  t.egimOrt = t.egimN ? t.egimTop / t.egimN : NaN;
  return t;
}

// Bir parsel: içine nokta düşmüyorsa (~900 m²'den küçük) ortasındaki değer
function parselIstatistigi(iz, f, siniflar) {
  const t = topla(iz, poligonlari(f.geometry), siniflar);
  if (t.n) return t;
  const p = icNokta(f), z = ornekle(iz.veri, iz, p.lat, p.lng), e = ornekle(iz.egim, iz, p.lat, p.lng);
  const sinif = new Float64Array(siniflar.length);
  if (Number.isFinite(e)) sinif[sinifBul(e, siniflar)] = 1;
  return { n: 0, kotMin: z, kotMax: z, kotOrt: z, egimOrt: e, egimMax: e, sinif };
}

// ---- hesap -----------------------------------------------------------------------------------------

function egimDurumYaz(metin) { $("egimDurum").textContent = metin; }

async function egimHesapla() {
  const surum = ++egim.surum;
  const b = egimBolgesi();
  if (b.hata) { egim.bolge = null; egim.sonuc = { hata: b.hata }; return egimCiz(); }
  // Alanda: alana değen parseller (Analiz'deki eşikle); ızgara onları da kaplasın
  if (b.tur === "alan") {
    const keys = [...durum.parseller.keys()];
    let ic = {};
    try { ic = keys.length ? await postJson(`referanslar/${b.alan.id}/alan-ici`, { keys, kapsam: "kesisen" }) : {}; } catch (e) {
      if (surum === egim.surum) { egim.sonuc = { hata: e.message }; egimCiz(); }
      return;
    }
    if (surum !== egim.surum) return;
    b.parseller = keys.filter((k) => ic[k]).map((k) => durum.parseller.get(k));
    if (b.parseller.length) {
      const p = kutusu(b.parseller.flatMap((f) => poligonlari(f.geometry).map((x) => x[0])));
      b.kutu = [Math.min(b.kutu[0], p[0]), Math.min(b.kutu[1], p[1]), Math.max(b.kutu[2], p[2]), Math.max(b.kutu[3], p[3])];
    }
  }
  const istek = payliKutu(b.kutu);
  if (!izgaraUygun(egim.iz, istek)) {
    egim.sonuc = null;
    egimCiz();
    egimDurumYaz("Yükseklik modeli alınıyor… İlk kullanımda internetten indirilir (bölge başına birkaç MB).");
    let iz;
    try { iz = await yukseklikAl(istek); } catch (e) {
      if (surum === egim.surum) { egim.sonuc = { hata: e.message }; egimCiz(); }
      return;
    }
    if (surum !== egim.surum) return;
    egim.iz = iz;
    if (iz.indirilen) mesaj(`Yükseklik modeli indirildi (${sayi(iz.indirilen / 1048576, 1)} MB); bu bölge artık internetsiz de çalışır.`, "basari");
  }
  egim.bolge = b;
  egimIstatistik();
  egimCiz();
  egimHaritaZamanla(0);
}

function egimIstatistik() {
  const iz = egim.iz, b = egim.bolge, siniflar = egimSiniflari();
  const ozet = topla(iz, b.poligonlar, siniflar, true);
  const parseller = (b.parseller || []).map((f) => ({ p: f.properties, f, t: parselIstatistigi(iz, f, siniflar) }))
    .sort((x, y) => parselSirasi(x.p, y.p));
  egim.sonuc = { ozet, parseller, siniflar };
}

// ---- tablolar ---------------------------------------------------------------------------------------

const yuvarla = (v, b = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** b) / 10 ** b : null);

function siniflarTablosu() {
  const { ozet, siniflar } = egim.sonuc, toplam = ozet.sinif.reduce((a, v) => a + v, 0);
  return {
    ad: "Eğim sınıfları",
    sutunlar: [{ ad: "Eğim", tur: "metin" }, { ad: "Alan (m²)", tur: "sayi" }, { ad: "Pay", tur: "yuzde" }],
    satirlar: siniflar.map((c, i) => [c.ad, yuvarla(ozet.sinif[i], 2), toplam ? ozet.sinif[i] / toplam : 0]),
    toplam: ["Toplam", yuvarla(toplam, 2), toplam ? 1 : 0],
  };
}

function ozetTablosu() {
  const o = egim.sonuc.ozet;
  return {
    ad: "Yükseklik ve eğim",
    sutunlar: [{ ad: "Ölçü", tur: "metin" }, { ad: "Değer", tur: "ondalik" }],
    satirlar: [["En düşük kot (m)", yuvarla(o.kotMin)], ["En yüksek kot (m)", yuvarla(o.kotMax)], ["Kot farkı (m)", yuvarla(o.kotMax - o.kotMin)],
      ["Ortalama kot (m)", yuvarla(o.kotOrt)], ["Ortalama eğim (%)", yuvarla(o.egimOrt)], ["En büyük eğim (%)", yuvarla(o.egimMax)]],
  };
}

function parselEgimTablosu() {
  const siniflar = egim.sonuc.siniflar;
  return {
    ad: "Parsel eğimleri",
    sutunlar: [{ ad: "Mahalle", tur: "metin" }, { ad: "Ada", tur: "kod" }, { ad: "Parsel", tur: "kod" },
      { ad: "Ort. kot (m)", tur: "ondalik" }, { ad: "En düşük (m)", tur: "ondalik" }, { ad: "En yüksek (m)", tur: "ondalik" },
      { ad: "Kot farkı (m)", tur: "ondalik" }, { ad: "Ort. eğim (%)", tur: "ondalik" }, { ad: "En büyük eğim (%)", tur: "ondalik" },
      { ad: "Baskın eğim", tur: "metin" }],
    satirlar: egim.sonuc.parseller.map(({ p, t }) => {
      const baskin = t.sinif.reduce((m, v, i, a) => (v > a[m] ? i : m), 0);
      return [p.mahalle, p.ada, p.parsel, yuvarla(t.kotOrt), yuvarla(t.kotMin), yuvarla(t.kotMax), yuvarla(t.kotMax - t.kotMin),
        yuvarla(t.egimOrt), yuvarla(t.egimMax), t.sinif[baskin] > 0 ? siniflar[baskin].ad : ""];
    }),
  };
}

// ---- ekran ------------------------------------------------------------------------------------------

function egimAlanlariniDoldur() {
  const sec = $("egimAlan");
  const alanlar = katmanSirasi.filter((id) => referanslar.has(id)).map((id) => referanslar.get(id).veri);
  if (!referanslar.has(egim.alanId)) egim.alanId = referanslar.has(aktifAlan) ? aktifAlan : alanlar[0]?.id ?? null;
  sec.innerHTML = alanlar.map((r) => `<option value="${r.id}">${esc(r.ad)}</option>`).join("");
  sec.disabled = !alanlar.length;
  if (egim.alanId != null) sec.value = String(egim.alanId);
  sec.dispatchEvent(new Event("change"));
  document.querySelectorAll("input[name=egimKapsam]").forEach((x) => { x.checked = x.value === egim.kapsam; });
  $("egimAlanSatiri").hidden = egim.kapsam !== "alan" || !alanlar.length;
}

function egimCiz() {
  const s = egim.sonuc;
  const kutular = ["egimOzetKutu", "egimHaritaKutu", "egimParselKutu"];
  const bos = !referanslar.size && !durum.parseller.size;
  $("egimBos").hidden = !bos;
  if (bos || !s || s.hata) {
    kutular.forEach((id) => { $(id).hidden = true; });
    egimDurumYaz(bos ? "" : s?.hata || "Hesaplanıyor…");
    egimKatmaniniGoster();
    return;
  }
  const o = s.ozet, b = egim.bolge;
  const kaba = egim.iz.kat > 1 ? ` · bölge büyük olduğu için ~${egimCozunurlugu(egim.iz)} m çözünürlük` : "";
  egimDurumYaz(o.n ? `${b.ad}: ${sayi(o.alan / 10000, 1)} ha${b.acik ? " (kapalı sınır yok; bütün kutu)" : ""}${kaba}` : "Bölgede yükseklik verisi yok (deniz ya da bölge çok küçük).");
  $("egimOzetKutu").hidden = $("egimHaritaKutu").hidden = !o.n;
  $("egimParselKutu").hidden = !s.parseller.length;
  if (o.n) {
    $("egimOzetAlt").textContent = egimKaynagi();
    const rakam = (ad, deger) => `<div><dt>${ad}</dt><dd>${deger}</dd></div>`;
    $("egimRakamlar").innerHTML = rakam("En düşük kot", `${sayi(o.kotMin, 1)} m`) + rakam("En yüksek kot", `${sayi(o.kotMax, 1)} m`)
      + rakam("Kot farkı", `${sayi(o.kotMax - o.kotMin, 1)} m`) + rakam("Ortalama kot", `${sayi(o.kotOrt, 1)} m`)
      + rakam("Ortalama eğim", `%${sayi(o.egimOrt, 1)}`) + rakam("En büyük eğim", `%${sayi(o.egimMax, 1)}`);
    const t = siniflarTablosu();
    $("egimSiniflar").innerHTML = `<div class="analiz-tablo-kap"><table class="analiz-tablo">
      <thead><tr><th>Eğim</th><th class="sag">Alan</th><th class="sag">Pay</th></tr></thead>
      <tbody>${t.satirlar.map((r, i) => `<tr><td class="pay-zemin" style="--pay:${Math.round(r[2] * 100)}%"><span class="egim-renk" style="background:${s.siniflar[i].renk}"></span>${esc(r[0])}</td>
        <td class="sag">${sayi(r[1] / 10000, 2)} ha</td><td class="sag">%${sayi(r[2] * 100, 1)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }
  if (s.parseller.length) {
    $("egimParselAdet").textContent = s.parseller.length;
    $("egimParsel").innerHTML = onizlemeTablosu(parselEgimTablosu(), { enCok: EGIM_ONIZLEME_SATIR });
  }
  egimHaritaPaneliDoldur();
}

function egimHaritaPaneliDoldur() {
  $("egimAcik").checked = egim.acik;
  document.querySelectorAll("input[name=egimTur]").forEach((x) => { x.checked = x.value === egim.tur; });
  document.querySelectorAll("[data-egim-tur]").forEach((el) => { el.hidden = el.dataset.egimTur !== egim.tur; });
  if (document.activeElement !== $("egimSinirlari")) $("egimSinirlari").value = egim.siniflar.map(sinirMetni).join(" ");
  $("egimKotAraligi").value = String(egim.kotAraligi);
  $("egimKotAraligi").dispatchEvent(new Event("change"));
  $("egimKabartma").checked = egim.kabartma;
  $("egimKirp").checked = egim.kirp;
  $("egimOpaklik").value = egim.opaklik;
  kaydiriciDoldur($("egimOpaklik"));
  $("egimOpaklikKutu").dataset.deger = egim.opaklik;
  if (document.activeElement !== $("egimOpaklikKutu")) $("egimOpaklikKutu").value = sayiYaz(egim.opaklik);
  const siniflar = haritaSiniflari();
  $("egimLejantOnizleme").innerHTML = siniflar ? siniflar.map((c) => `<li><span class="egim-renk" style="background:${c.renk}"></span>${esc(c.ad)}</li>`).join("") : "";
}

const haritaSiniflari = () => (!egim.sonuc?.ozet?.n ? null : egim.tur === "egim" ? egim.sonuc.siniflar : kotSiniflari(egim.sonuc.ozet.kotMin, egim.sonuc.ozet.kotMax));

// ---- harita görüntüsü ---------------------------------------------------------------------------------
// Görüntü Web Mercator'da doğrusal kurulur (satır enlemleri izdüşümden): haritaya da Görsel'deki görsel
// katmanına da kaymadan oturur. Değer piksel başına çift doğrusal ara değerle alınıp sınıflanır; sınıf
// sınırları 30 m'lik basamak yerine yumuşak çizgi olur.

// enAz/enCok: görüntünün genişliği (piksel); ızgara noktası başına ~10 piksel, katmanda ~16
function egimGoruntusu(enCok, enAz = 512, carpan = 10) {
  const iz = egim.iz, b = egim.bolge, siniflar = haritaSiniflari();
  const dizi = egim.tur === "egim" ? iz.egim : iz.veri, golge = egim.tur === "yukseklik" && egim.kabartma ? golgeIzgarasi(iz) : null;
  // Kırpılıyorsa bölgenin kutusu, değilse paylı kutu; ızgaranın eğimi olan kısmıyla sınırlı
  const [w0, s0, e0, n0] = egim.kirp ? b.kutu : payliKutu(b.kutu);
  const w = Math.max(w0, iz.bati + iz.adim), e = Math.min(e0, iz.bati + (iz.en - 2) * iz.adim);
  const n = Math.min(n0, iz.kuzey - iz.adim), s = Math.max(s0, iz.kuzey - (iz.boy - 2) * iz.adim);
  const crs = L.CRS.EPSG3857, gb = crs.project(L.latLng(s, w)), kd = crs.project(L.latLng(n, e));
  const hucre = (e - w) / iz.adim;
  let en = Math.min(enCok, Math.max(enAz, Math.round(hucre * carpan)));
  let boy = Math.round((en * (kd.y - gb.y)) / (kd.x - gb.x));
  if (boy > enCok) { en = Math.round((en * enCok) / boy); boy = enCok; }
  en = Math.max(1, en); boy = Math.max(1, boy);
  const tuval = document.createElement("canvas");
  tuval.width = en; tuval.height = boy;
  const ctx = tuval.getContext("2d");
  const resim = ctx.createImageData(en, boy), p = resim.data;
  const renkler = siniflar.map((c) => [1, 3, 5].map((i) => parseInt(c.renk.slice(i, i + 2), 16)));
  const bAdim = (e - w) / en;
  for (let y = 0; y < boy; y++) {
    const enlem = crs.unproject(L.point(gb.x, kd.y - ((y + 0.5) * (kd.y - gb.y)) / boy)).lat;
    for (let x = 0; x < en; x++) {
      const boylam = w + (x + 0.5) * bAdim, v = ornekle(dizi, iz, enlem, boylam);
      if (!Number.isFinite(v)) continue;
      const [r, g, bb] = renkler[sinifBul(v, siniflar)], o = (y * en + x) * 4;
      const k = golge ? 0.35 + 0.65 * Math.min(1, (ornekle(golge, iz, enlem, boylam) || 0.7) / 0.85) : 1;
      p[o] = r * k; p[o + 1] = g * k; p[o + 2] = bb * k; p[o + 3] = 255;
    }
  }
  ctx.putImageData(resim, 0, 0);
  if (egim.kirp) {
    // Bölgenin poligonları ayrı bir maskeye tek tek (delikleriyle) çizilir; üst üste binenler birleşir
    const maske = document.createElement("canvas");
    maske.width = en; maske.height = boy;
    const m = maske.getContext("2d"), kx = en / (kd.x - gb.x), ky = boy / (kd.y - gb.y);
    for (const pol of b.poligonlar) {
      const yol = new Path2D();
      for (const h of pol) h.forEach(([x, y], i) => {
        const q = crs.project(L.latLng(y, x)), px = (q.x - gb.x) * kx, py = (kd.y - q.y) * ky;
        i ? yol.lineTo(px, py) : yol.moveTo(px, py);
      });
      m.fill(yol, "evenodd");
    }
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maske, 0, 0);
  }
  const merkez = crs.unproject(L.point((gb.x + kd.x) / 2, (gb.y + kd.y) / 2));
  return {
    tuval, en, boy, sinir: [[s, w], [n, e]], siniflar,
    merkez: [merkez.lat, merkez.lng], genislik: ((e - w) / 360) * 40075016.686 * Math.cos((merkez.lat * Math.PI) / 180),
  };
}

const tuvalBlob = (tuval) => new Promise((coz, red) => tuval.toBlob((b) => (b ? coz(b) : red(new Error("Görüntü oluşturulamadı."))), "image/png"));

async function egimHaritaCiz() {
  const cizim = ++egim.cizim;
  if (!egimSekmesinde() || !egim.iz || !egim.sonuc?.ozet?.n) { egimKatmaniniGoster(); return; }
  const g = egimGoruntusu(1600);
  const url = URL.createObjectURL(await tuvalBlob(g.tuval));
  if (cizim !== egim.cizim) { URL.revokeObjectURL(url); return; }
  if (egim.goruntu) URL.revokeObjectURL(egim.goruntu.url);
  egim.goruntu = { ...g, url, tuval: null };
  egimKatmaniniGoster();
}

function egimHaritaZamanla(ms = 120) {
  clearTimeout(egim.zamanlayici);
  egim.zamanlayici = setTimeout(egimHaritaCiz, ms);
}

// Önizleme: alanların üstünde, parsellerin altında; tıklamayı engellemez. Sadece bu sekmedeyken görünür.
harita.createPane("egim").style.zIndex = 355;
harita.getPane("egim").style.pointerEvents = "none";
function egimKatmaniniGoster() {
  egim.katman?.remove();
  egim.katman = null;
  if (!egimSekmesinde() || !egim.acik || !egim.goruntu || !egim.sonuc?.ozet?.n) return;
  egim.katman = L.imageOverlay(egim.goruntu.url, egim.goruntu.sinir, { pane: "egim", opacity: egim.opaklik / 100, interactive: false }).addTo(harita);
}

// Görsel sekmesine kilitli görsel olarak; sınıflar katmana bağlı lejant öğeleri olur (katmanla gider).
async function egimKatmanEkle(buton) {
  if (!egim.iz || !egim.sonuc?.ozet?.n) return;
  yukleniyor(buton, true);
  try {
    const g = egimGoruntusu(2400, 1024, 16);
    const url = URL.createObjectURL(await tuvalBlob(g.tuval));
    const egimMi = egim.tur === "egim";
    const ad = `${egimMi ? "Eğim" : "Yükseklik"} · ${egim.bolge.ad}`;
    const n = notEkle("gorsel", { ad, url, en: g.en, boy: g.boy, merkez: g.merkez, genislik: g.genislik, aci: 0,
      opaklik: egim.opaklik, karistir: false, kilit: true, sayfa: 1, sayfaSayisi: 1 }, false);
    if ($("egimLejant").checked) {
      lejant.ogeler.push(...g.siniflar.map((c, i) => ({ tur: "ozel", k: `egim-${n.id}-${i}`, ad: `${egimMi ? "Eğim" : "Kot"} ${c.ad}`, renk: c.renk, sekil: "dolu", not: n.id })));
      lejant.acik = true;
      lejantDegisti();
    }
    // Aynı görüntü iki kez durmasın: önizleme kapanır
    egim.acik = false;
    egimHaritaPaneliDoldur();
    egimKatmaniniGoster();
    mesaj(`"${ad}" Görsel sekmesine kilitli katman olarak eklendi; çıktıya ve projeye girer.`, "basari");
  } catch (e) { mesaj(e.message, true); } finally { yukleniyor(buton, false); }
}

// ---- imleçteki kot ve eğim ------------------------------------------------------------------------------

const egimImlec = Object.assign(document.createElement("div"), { className: "egim-imlec cam", hidden: true });
egimImlec.setAttribute("aria-hidden", "true");
document.body.append(egimImlec);
harita.on("mousemove", (e) => {
  const iz = egim.iz;
  const kot = iz && egimSekmesinde() ? ornekle(iz.veri, iz, e.latlng.lat, e.latlng.lng) : NaN;
  egimImlec.hidden = !Number.isFinite(kot);
  if (egimImlec.hidden) return;
  const eg = ornekle(iz.egim, iz, e.latlng.lat, e.latlng.lng);
  egimImlec.textContent = `${sayi(kot, 1)} m${Number.isFinite(eg) ? ` · %${sayi(eg, 1)} eğim` : ""}`;
  egimImlec.style.left = `${e.originalEvent.clientX + 14}px`;
  egimImlec.style.top = `${e.originalEvent.clientY + 16}px`;
});
harita.on("mouseout", () => { egimImlec.hidden = true; });

// ---- kesit: haritada çizilen hat boyunca yükseklik --------------------------------------------------------

const kesit = { noktalar: [], cizgi: null, isaretler: [], lastik: null, iz: null, ornekler: null, imlec: null };

function kesitModu(acik) {
  if (acik) {
    if (durum.mod === "sorgu") sorguModu(false);
    if (durum.mod === "cizim") cizimIptal();
    if (durum.mod?.startsWith("not-")) notModu(null);
    kesitTemizle();
    durum.mod = "kesit";
    harita.doubleClickZoom.disable(); // çift tıklama hattı bitirir
  } else if (durum.mod === "kesit") {
    durum.mod = null;
    setTimeout(() => { if (!durum.mod) harita.doubleClickZoom.enable(); }, 400);
  }
  $("kesitCiz").setAttribute("aria-pressed", acik);
  $("kesitIpucu").hidden = !acik;
  kesit.lastik?.remove();
  kesit.lastik = null;
  imlecGuncelle();
}

function kesitTemizle() {
  kesit.cizgi?.remove();
  kesit.lastik?.remove();
  kesit.imlec?.remove();
  kesit.isaretler.forEach((m) => m.remove());
  Object.assign(kesit, { noktalar: [], cizgi: null, isaretler: [], lastik: null, ornekler: null, imlec: null });
  $("kesitSonuc").hidden = true;
  $("kesitSonuc").innerHTML = "";
  $("kesitBos").hidden = false;
  $("kesitTemizle").hidden = true;
}

function kesitCizgisi() {
  kesit.cizgi?.remove();
  kesit.isaretler.forEach((m) => m.remove());
  const bitti = durum.mod !== "kesit";
  kesit.cizgi = L.polyline(kesit.noktalar, { color: HR.cizim, weight: 3, opacity: 1, dashArray: bitti ? null : "6 5", interactive: false }).addTo(harita);
  kesit.isaretler = kesit.noktalar.map((q, i) => L.marker(q, {
    interactive: false, keyboard: false,
    icon: L.divIcon({ className: "cizim-pin-ikon", html: `<div class="cizim-pin kesit-pin">${bitti && (i === 0 || i === kesit.noktalar.length - 1) ? (i ? "B" : "A") : i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
  }).addTo(harita));
}

function kesitTikla(latlng) {
  const p = harita.latLngToContainerPoint(latlng);
  const son = kesit.noktalar.at(-1);
  if (son && kesit.noktalar.length >= 2 && harita.latLngToContainerPoint(son).distanceTo(p) < 10) return kesitBitir();
  kesit.noktalar.push([latlng.lat, latlng.lng]);
  kesitCizgisi();
}

harita.on("click", (e) => { if (durum.mod === "kesit") kesitTikla(e.latlng); });
harita.on("dblclick", (e) => {
  if (durum.mod !== "kesit") return;
  // Çift tıklamanın iki "click"i aynı yere iki nokta koymuş olur
  const p = harita.latLngToContainerPoint(e.latlng);
  const yakin = (q) => harita.latLngToContainerPoint(q).distanceTo(p) < 10;
  while (kesit.noktalar.length > 2 && yakin(kesit.noktalar.at(-1)) && yakin(kesit.noktalar.at(-2))) kesit.noktalar.pop();
  if (kesit.noktalar.length >= 2) kesitBitir();
});
harita.on("mousemove", (e) => {
  if (durum.mod !== "kesit" || !kesit.noktalar.length) return;
  const iz = [kesit.noktalar.at(-1), e.latlng];
  if (kesit.lastik) kesit.lastik.setLatLngs(iz);
  else kesit.lastik = L.polyline(iz, { color: HR.cizim, weight: 2, dashArray: "4 6", opacity: 0.8, interactive: false }).addTo(harita);
});
document.addEventListener("keydown", (e) => {
  if (durum.mod !== "kesit" || e.target.matches("input, textarea, select")) return;
  if (e.key === "Escape") { kesitModu(false); kesitTemizle(); }
  else if (e.key === "Enter") { e.preventDefault(); if (kesit.noktalar.length >= 2) kesitBitir(); }
  else if (e.key === "Backspace" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z")) {
    e.preventDefault();
    kesit.noktalar.pop();
    kesitCizgisi();
  }
});

async function kesitBitir() {
  kesitModu(false);
  kesitCizgisi();
  $("kesitTemizle").hidden = false;
  $("kesitBos").hidden = true;
  $("kesitSonuc").hidden = false;
  $("kesitSonuc").innerHTML = `<p class="ikincil-metin">Yükseklik alınıyor…</p>`;
  // Hat bölgenin ızgarasındaysa o; değilse hattın kendi ızgarası
  const hat = kesit.noktalar.map(([a, b]) => [b, a]);
  const kutu = payliKutu(kutusu([hat]));
  let iz = izgaraUygun(egim.iz, kutu) ? egim.iz : izgaraUygun(kesit.iz, kutu) ? kesit.iz : null;
  if (!iz) {
    try { iz = kesit.iz = await yukseklikAl(kutu); } catch (e) { $("kesitSonuc").innerHTML = `<p class="ikincil-metin">${esc(e.message)}</p>`; return; }
  }
  // Örnekler ~10 m arayla (en çok 800)
  const kenar = (a, b) => { const [kx, ky] = metreOlcegi((a[0] + b[0]) / 2); return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * ky); };
  const uzunluklar = kesit.noktalar.slice(1).map((q, i) => kenar(kesit.noktalar[i], q)), toplam = uzunluklar.reduce((a, v) => a + v, 0);
  const adim = Math.max(10, toplam / 800), ornekler = [];
  let d0 = 0;
  uzunluklar.forEach((u, i) => {
    const [a, b] = [kesit.noktalar[i], kesit.noktalar[i + 1]];
    for (let d = 0; d < u || (i === uzunluklar.length - 1 && d <= u + 1e-6); d += adim) {
      const t = u ? Math.min(1, d / u) : 0, enlem = a[0] + (b[0] - a[0]) * t, boylam = a[1] + (b[1] - a[1]) * t;
      ornekler.push({ d: d0 + Math.min(d, u), enlem, boylam, kot: ornekle(iz.veri, iz, enlem, boylam) });
      if (d >= u) break;
    }
    d0 += u;
  });
  kesit.ornekler = ornekler;
  kesit.pencere = egimCozunurlugu(iz);
  kesitCiz();
}

function kesitOzeti(o, pencere = 30) {
  const gecerli = o.filter((x) => Number.isFinite(x.kot));
  let cikis = 0, inis = 0, dik = 0;
  for (let i = 1; i < gecerli.length; i++) {
    const f = gecerli[i].kot - gecerli[i - 1].kot;
    if (f > 0) cikis += f; else inis -= f;
  }
  // En dik bölüm: bir ızgara aralığı (tam çözünürlükte ~30 m) uzunluğundaki pencerelerde
  for (let i = 0, j = 0; i < gecerli.length; i++) {
    while (j < gecerli.length && gecerli[j].d - gecerli[i].d < pencere) j++;
    if (j < gecerli.length) dik = Math.max(dik, Math.abs(gecerli[j].kot - gecerli[i].kot) / (gecerli[j].d - gecerli[i].d));
  }
  const kotlar = gecerli.map((x) => x.kot), uzunluk = o.at(-1).d;
  return { gecerli, uzunluk, enAz: Math.min(...kotlar), enCok: Math.max(...kotlar), cikis, inis,
    ortEgim: uzunluk ? ((cikis + inis) / uzunluk) * 100 : 0, dik: dik * 100, bas: gecerli[0]?.kot, son: gecerli.at(-1)?.kot };
}

function kesitCiz() {
  const o = kesit.ornekler, z = kesitOzeti(o, kesit.pencere);
  if (z.gecerli.length < 2) { $("kesitSonuc").innerHTML = `<p class="ikincil-metin">Bu hatta yükseklik verisi yok.</p>`; return; }
  const E = 320, B = 150, sol = 50, sag = 8, ust = 10, alt = 22;
  const yAlt = Math.floor(z.enAz - Math.max(1, (z.enCok - z.enAz) * 0.1)), yUst = Math.ceil(z.enCok + Math.max(1, (z.enCok - z.enAz) * 0.1));
  const x = (d) => sol + (d / z.uzunluk) * (E - sol - sag), y = (k) => ust + ((yUst - k) / (yUst - yAlt)) * (B - ust - alt);
  const cizgi = z.gecerli.map((q, i) => `${i ? "L" : "M"}${x(q.d).toFixed(1)} ${y(q.kot).toFixed(1)}`).join("");
  const dolgu = `${cizgi}L${x(z.gecerli.at(-1).d).toFixed(1)} ${B - alt}L${x(z.gecerli[0].d).toFixed(1)} ${B - alt}Z`;
  const yEt = [yUst, (yUst + yAlt) / 2, yAlt].map((k, i) => `<text x="${sol - 6}" y="${y(k)}" text-anchor="end" dominant-baseline="central">${sayi(k, 0)}${i ? "" : " m"}</text>`
    + `<line x1="${sol}" x2="${E - sag}" y1="${y(k)}" y2="${y(k)}" class="kesit-izgara"/>`).join("");
  const xEt = [0, z.uzunluk / 2, z.uzunluk].map((d, i) => `<text x="${x(d)}" y="${B - 6}" text-anchor="${["start", "middle", "end"][i]}">${olcuUzunlugu(d)}</text>`).join("");
  const rakam = (ad, deger, genis = false) => `<div${genis ? ' class="genis"' : ""}><dt>${ad}</dt><dd>${deger}</dd></div>`;
  $("kesitSonuc").innerHTML = `
    <div class="kesit-grafik">
      <svg viewBox="0 0 ${E} ${B}" role="img" aria-label="${esc(`Kesit: ${olcuUzunlugu(z.uzunluk)}, kot ${sayi(z.enAz, 1)}–${sayi(z.enCok, 1)} m`)}">
        ${yEt}
        <path d="${dolgu}" class="kesit-dolgu"/><path d="${cizgi}" class="kesit-cizgi"/>${xEt}
        <text x="${sol + 4}" y="${ust + 10}" class="kesit-uc">A</text><text x="${E - sag - 4}" y="${ust + 10}" text-anchor="end" class="kesit-uc">B</text>
        <g class="kesit-imlec" hidden><line y1="${ust}" y2="${B - alt}"/><circle r="3.5"/><text y="${ust + 2}"></text></g>
        <rect x="${sol}" y="${ust}" width="${E - sol - sag}" height="${B - ust - alt}" class="kesit-yuzey"/>
      </svg>
    </div>
    <dl class="egim-rakamlar iki">
      ${rakam("Uzunluk", olcuUzunlugu(z.uzunluk))}${rakam("Çıkış / iniş", `${sayi(z.cikis, 1)} / ${sayi(z.inis, 1)} m`)}
      ${rakam("Ortalama eğim", `%${sayi(z.ortEgim, 1)}`)}${rakam("En dik bölüm", `%${sayi(z.dik, 1)}`)}
      ${rakam("A → B kotu", `${sayi(z.bas, 1)} → ${sayi(z.son, 1)} m`, true)}${rakam("En düşük / en yüksek kot", `${sayi(z.enAz, 1)} / ${sayi(z.enCok, 1)} m`, true)}
    </dl>`;
  // Grafikte gezinince haritada da o nokta
  const svg = $("kesitSonuc").querySelector("svg"), imlec = svg.querySelector(".kesit-imlec");
  const goster = (ev) => {
    const r = svg.getBoundingClientRect(), d = ((((ev.clientX - r.left) / r.width) * E - sol) / (E - sol - sag)) * z.uzunluk;
    const q = z.gecerli.reduce((m, v) => (Math.abs(v.d - d) < Math.abs(m.d - d) ? v : m), z.gecerli[0]);
    imlec.hidden = false;
    imlec.querySelector("line").setAttribute("x1", x(q.d));
    imlec.querySelector("line").setAttribute("x2", x(q.d));
    imlec.querySelector("circle").setAttribute("cx", x(q.d));
    imlec.querySelector("circle").setAttribute("cy", y(q.kot));
    const yazi = imlec.querySelector("text");
    yazi.textContent = `${sayi(q.kot, 1)} m · ${olcuUzunlugu(q.d)}`;
    yazi.setAttribute("x", x(q.d) + (x(q.d) > E / 2 ? -6 : 6));
    yazi.setAttribute("text-anchor", x(q.d) > E / 2 ? "end" : "start");
    if (kesit.imlec) kesit.imlec.setLatLng([q.enlem, q.boylam]);
    else kesit.imlec = L.circleMarker([q.enlem, q.boylam], { radius: 6, color: HR.cizim, weight: 2, fillColor: HR.secili, fillOpacity: 1, interactive: false }).addTo(harita);
  };
  const gizle = () => { imlec.hidden = true; kesit.imlec?.remove(); kesit.imlec = null; };
  svg.querySelector(".kesit-yuzey").addEventListener("pointermove", goster);
  svg.querySelector(".kesit-yuzey").addEventListener("pointerleave", gizle);
}

$("kesitCiz").addEventListener("click", () => kesitModu(durum.mod !== "kesit"));
$("kesitTemizle").addEventListener("click", () => { kesitModu(false); kesitTemizle(); });

// Sekmeden çıkınca kesit ve önizleme gizlenir, dönünce geri gelir
function kesitGorunur(acik) {
  for (const k of [kesit.cizgi, ...kesit.isaretler]) {
    if (!k) continue;
    if (acik) k.addTo(harita); else k.remove();
  }
  if (!acik) { kesit.imlec?.remove(); kesit.imlec = null; }
}

// ---- dışa verme, haritaya ve sayfaya ekleme ---------------------------------------------------------------

$("panel-egim").addEventListener("click", (e) => {
  const b = e.target.closest("[data-egim-tablo] button[data-is]");
  if (!b || !egim.sonuc?.ozet) return;
  const hangi = b.closest("[data-egim-tablo]").dataset.egimTablo;
  const tablolar = hangi === "ozet" ? [siniflarTablosu(), ozetTablosu()] : [parselEgimTablosu()];
  const bolge = egim.bolge.ad;
  const ad = `${hangi === "ozet" ? "Eğim sınıfları" : "Parsel eğimleri"} · ${bolge} (${egimKaynagi()})`;
  if (b.dataset.is === "excel") {
    // analiz.js'teki gibi; dosya adı bölgeden
    const dosyaAdi = `egim-${bolge}-${new Date().toISOString().slice(0, 10)}`;
    return (async () => {
      const dosya = `${guvenliAd(dosyaAdi)}.xlsx`;
      const hedef = await kayitYeriSor(dosya);
      if (hedef === false) return;
      yukleniyor(b, true);
      try {
        const r = await postJson("tablo-excel", { dosyaAdi, sayfalar: tablolar });
        await dosyaYaz(hedef, await r.blob(), dosya);
      } catch (err) { mesaj(err.message, true); } finally { yukleniyor(b, false); }
    })();
  }
  const sayfalar = tablolar.map((t) => ({ ad: t.ad, satirlar: tabloMetinleri(t), kesildi: false }));
  if (b.dataset.is === "harita") {
    const m = harita.getCenter();
    notEkle("tablo", { ad, sayfalar, sayfa: 0, dizilis: sayfalar.length > 1 ? "alt" : "tek", baslikSatiri: true, boyut: 12, konum: [m.lat, m.lng], renk: token("--not-siyah") }, false);
    mesaj(`"${ad}" haritaya eklendi; Görsel sekmesinde taşıyıp boyutlandırabilirsin.`, "basari");
  } else {
    cikti.sayfaOgeleri.push({ id: `s${++sayfaSayac}`, tur: "tablo", ad, sayfalar, sayfa: 0, dizilis: sayfalar.length > 1 ? "alt" : "tek", baslikSatiri: true, boyutMm: 2.6, renk: token("--not-siyah") });
    sayfaOgeleriCiz();
    mesaj(`"${ad}" çıktı sayfasına eklendi; Çıktı sekmesinde yerleştirebilirsin.`, "basari");
  }
});

// ---- ayarlar ----------------------------------------------------------------------------------------

function egimYeniden() {
  egimKaydet();
  if (egim.iz && egim.bolge) egimIstatistik();
  egimCiz();
  egimHaritaZamanla();
}

document.querySelectorAll("input[name=egimKapsam]").forEach((x) => x.addEventListener("change", () => {
  egim.kapsam = x.value;
  egimKaydet();
  egimAlanlariniDoldur();
  egim.sonuc = null;
  egimCiz();
  egimHesapla();
}));
$("egimAlan").addEventListener("change", (e) => {
  const id = Number(e.target.value);
  if (!id || id === egim.alanId) return;
  egim.alanId = id;
  if (egim.kapsam === "alan" && egimSekmesinde()) egimHesapla();
});
$("egimAcik").addEventListener("change", (e) => { egim.acik = e.target.checked; egimKatmaniniGoster(); if (egim.acik && !egim.goruntu) egimHaritaZamanla(0); });
document.querySelectorAll("input[name=egimTur]").forEach((x) => x.addEventListener("change", () => {
  egim.tur = x.value;
  egim.acik = true;
  egimYeniden();
}));
$("egimSinirlari").addEventListener("input", (e) => {
  const s = (e.target.value.match(/\d+(?:[.,]\d+)?/g) || []).map((v) => Number(v.replace(",", ".")));
  const gecerli = sinirlarGecerli(s);
  e.target.setAttribute("aria-invalid", String(!gecerli));
  if (!gecerli) return;
  egim.siniflar = s;
  egimYeniden();
});
$("egimSinirlari").addEventListener("change", (e) => { e.target.removeAttribute("aria-invalid"); e.target.value = egim.siniflar.map(sinirMetni).join(" "); });
$("egimKotAraligi").addEventListener("change", (e) => {
  const v = Number(e.target.value);
  if (v === egim.kotAraligi) return;
  egim.kotAraligi = v;
  egimYeniden();
});
$("egimKabartma").addEventListener("change", (e) => { egim.kabartma = e.target.checked; egimKaydet(); egimHaritaZamanla(); });
$("egimKirp").addEventListener("change", (e) => { egim.kirp = e.target.checked; egimKaydet(); egimHaritaZamanla(); });
for (const el of [$("egimOpaklik"), $("egimOpaklikKutu")]) {
  el.addEventListener("input", (e) => {
    const v = sayiliDegisti(e.target, [5, 100]);
    if (v === null) return;
    egim.opaklik = v;
    egimKaydet();
    egim.katman?.setOpacity(v / 100);
  });
}
$("egimKatmanEkle").addEventListener("click", (e) => egimKatmanEkle(e.currentTarget));

// Sekmeye girince ve sekmedeyken parsel listesi ya da seçim değişince yeniden hesaplanır.
document.addEventListener("sekme", () => {
  const acik = egimSekmesinde();
  if (!acik && durum.mod === "kesit") kesitModu(false);
  kesitGorunur(acik);
  if (!acik) { egimImlec.hidden = true; egimKatmaniniGoster(); return; }
  egimAlanlariniDoldur();
  egimHaritaPaneliDoldur();
  egimHesapla();
});
document.addEventListener("parseller", () => {
  if (!egimSekmesinde()) return;
  clearTimeout(egim.parselZamanlayici);
  egim.parselZamanlayici = setTimeout(() => { egimAlanlariniDoldur(); egimHesapla(); }, 300); // proje açılınca alanlar da değişir
});
if (egimSekmesinde()) { egimAlanlariniDoldur(); egimHaritaPaneliDoldur(); egimHesapla(); }
