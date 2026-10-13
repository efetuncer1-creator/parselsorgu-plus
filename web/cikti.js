"use strict";

// ================================================================================
// Çıktı: haritanın seçilen yeri ya da A4/A3 sayfa, PNG ve PDF olarak
// ================================================================================
// Ekrandaki çizim kopyalanmaz; sayfa tuvale baştan çizilir: altlık karoları (sunucuları CORS izni
// veriyor), alanlar, parseller, notlar ve sayfa öğeleri. Böylece çıktı istenen ölçek ve çözünürlükte
// olur. Sıra haritadakiyle aynıdır (karolar, alt bant, parseller, numaralar, alan adları, üst bant).
// app.js'teki durum, referanslar, notlar, lejant, katmanSirasi ve yardımcıları kullanır.

const KAGITLAR = { A4: [210, 297], A3: [297, 420] }; // mm, dikey
const EN_BUYUK_KENAR = 8000; // serbest çıktının uzun kenarı, piksel
const EN_COK_KARO = 2500; // bir katman için; aşılırsa çıktı çizilmez (tarayıcı kilitlenmesin)
// Sayfaya konanların boyut sınırları (mm): paneldeki kaydırıcı ve önizlemedeki köşe tutamacı aynı sınırları kullanır.
// Boyutlar: kaydırıcı alışılmış aralıkta gezer; yanındaki kutuya elle yazılan ya da köşeden sürüklenen değer
// o aralıkla sınırlı değil. Yalnızca sıfıra inmesin, anlamsız büyümesin diye geniş bir sınır var (5 m, 50 kat).
const SAYFA_OGE_ARALIGI = { gorsel: [10, 400, 1], grafik: [30, 300, 1], tablo: [1.5, 10, 0.1], yazi: [1.5, 30, 0.1] }; // mm
const SAYFA_OGE_SINIRI = [0.5, 5000]; // mm
const HAZIR_OGE_ARALIGI = [25, 300, 5]; // % — başlık, lejant, kuzey oku ve ölçeğin büyütme çarpanı
const HAZIR_OGE_SINIRI = [0.1, 50]; // çarpan
const OLCEKLER = [500, 1000, 2000, 2500, 5000, 10000, 25000, 50000];
const MERKATOR_R = 20037508.342789244;
const ciktiSekmesinde = () => !$("panel-cikti").hidden;
const bugun = () => new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });

const cikti = {
  sablon: "A4", yon: "yatay", olcek: "otomatik", dpi: 150, carpan: 2, sistem: "itrf96", canli: true,
  ogeler: { baslik: true, lejant: true, kuzey: true, izgara: false },
  baslik: "", tarih: "",
  serbest: null, // "Seçtiğim alan": [[güney, batı], [kuzey, doğu]]
  konumlar: {}, // öğe kimliği -> { x, y }: sol üst köşe, sayfa genişliği/yüksekliği oranı
  boyutlar: {}, // başlık, lejant, kuzey, olcek -> büyütme çarpanı (önizlemede köşeden ayarlanır)
  sayfaOgeleri: [], // sayfaya konan görsel, tablo, yazı (oturumla yaşar)
};
// Kalıcı tercihler (sayfa öğeleri ve konumları dosya içerdiği için saklanmaz)
try {
  const k = JSON.parse(localStorage.getItem("cikti") || "{}");
  for (const ad of ["sablon", "yon", "olcek", "dpi", "carpan", "sistem", "baslik", "canli"]) if (k[ad] != null) cikti[ad] = k[ad];
  if (k.ogeler && typeof k.ogeler === "object") Object.assign(cikti.ogeler, k.ogeler);
} catch { /* varsayılanlar */ }
if (!Object.hasOwn(KAGITLAR, cikti.sablon) && cikti.sablon !== "serbest") cikti.sablon = "A4";
function ciktiKaydet() {
  const { sablon, yon, olcek, dpi, carpan, sistem, baslik, ogeler, canli } = cikti;
  try { localStorage.setItem("cikti", JSON.stringify({ sablon, yon, olcek, dpi, carpan, sistem, baslik, ogeler, canli })); } catch { /* önemli değil */ }
}

// ---- sayfa düzeni ve harita çerçevesi -------------------------------------------------------

const merkatorla = (ll) => L.CRS.EPSG3857.project(L.latLng(ll));
const cografyala = (x, y) => L.CRS.EPSG3857.unproject(L.point(x, y));

// Kağıt boyu, kenar boşluğu ve başlık bandından harita çerçevesinin milimetre ölçüleri.
function kagitDuzeni() {
  const [a, b] = KAGITLAR[cikti.sablon];
  const [en, boy] = cikti.yon === "yatay" ? [b, a] : [a, b];
  const kenar = 10, bant = cikti.ogeler.baslik ? 16 : 0;
  return { en, boy, harita: { x: kenar, y: kenar + bant, en: en - 2 * kenar, boy: boy - 2 * kenar - bant } };
}

// Haritanın çekmecenin altında kalmayan kısmı (kap noktası): masaüstünde çekmecenin sağı, telefonda üstü.
function gorunurAlan() {
  const s = harita.getSize(), c = document.querySelector(".cekmece").getBoundingClientRect();
  if (matchMedia("(max-width: 760px)").matches) return { x0: 0, y0: 0, x1: s.x, y1: Math.max(120, c.top) };
  return { x0: Math.min(s.x - 120, c.right), y0: 0, x1: s.x, y1: s.y };
}

// Otomatik ölçek: kağıdın tamamı haritanın görünen kısmına sığacak en büyük yuvarlak ölçek.
function gecerliOlcek() {
  if (cikti.olcek !== "otomatik") return Number(cikti.olcek);
  const d = kagitDuzeni(), a = gorunurAlan(), mPiksel = metrePiksel(harita.getCenter().lat);
  const sigan = Math.min(((a.x1 - a.x0) * 0.92 * mPiksel) / (d.en / 1000), ((a.y1 - a.y0) * 0.92 * mPiksel) / (d.boy / 1000));
  return [...OLCEKLER].reverse().find((o) => o <= sigan) ?? OLCEKLER[0];
}

// Haritadaki çerçeve (coğrafi). Kağıt, haritanın görünen kısmının ortasında durur; harita kaydıkça çerçeve onu izler.
function cerceveSiniri() {
  if (cikti.sablon === "serbest") return cikti.serbest ? L.latLngBounds(cikti.serbest) : null;
  const d = kagitDuzeni(), olcek = gecerliOlcek(), a = gorunurAlan();
  const pxmm = olcek / 1000 / metrePiksel(harita.getCenter().lat); // ekranda kağıdın bir milimetresi
  // Çerçevenin ortası kağıdın ortasından başlık bandının yarısı kadar aşağıdadır.
  const m = harita.containerPointToLatLng([(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2 + (d.harita.y + d.harita.boy / 2 - d.boy / 2) * pxmm]);
  const k = 1 / Math.cos((m.lat * Math.PI) / 180); // yer metresi -> Merkatör metresi
  const yariEn = ((d.harita.en / 1000) * olcek * k) / 2, yariBoy = ((d.harita.boy / 1000) * olcek * k) / 2;
  const p = merkatorla(m);
  return L.latLngBounds(cografyala(p.x - yariEn, p.y - yariBoy), cografyala(p.x + yariEn, p.y + yariBoy));
}

harita.createPane("cikti").style.zIndex = 480;
harita.getPane("cikti").style.pointerEvents = "none";
const cerceve = { maske: null, kenar: null };

function cerceveCiz() {
  const s = ciktiSekmesinde() ? cerceveSiniri() : null;
  if (!s) {
    cerceve.maske?.remove();
    cerceve.kenar?.remove();
    cerceve.maske = cerceve.kenar = null;
  } else {
    const dunya = [[-85, -179.9], [-85, 179.9], [85, 179.9], [85, -179.9]];
    const ic = [s.getSouthWest(), s.getNorthWest(), s.getNorthEast(), s.getSouthEast()];
    if (cerceve.maske) {
      cerceve.maske.setLatLngs([dunya, ic]);
      cerceve.kenar.setBounds(s);
    } else {
      cerceve.maske = L.polygon([dunya, ic], { pane: "cikti", stroke: false, fillColor: token("--cikti-maske"), fillOpacity: 1, interactive: false }).addTo(harita);
      cerceve.kenar = L.rectangle(s, { pane: "cikti", color: HR.cizim, weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(harita);
    }
    // Kağıt haritada görünürken çerçevenin siyah kenarı sayfada çizili; kesik çizgi yalnızca serbest alanda kalır.
    cerceve.kenar.setStyle({ opacity: cikti.canli && cikti.sablon !== "serbest" ? 0 : 1 });
  }
  ciktiBilgisi();
  canliKonumla();
}

function ciktiBilgisi() {
  const serbest = cikti.sablon === "serbest";
  $("ciktiOlcekBilgi").textContent = serbest ? (cikti.serbest ? "Çıktı alınacak alan kesik çizgiyle gösteriliyor; değiştirmek için haritada yeniden seç." : "Haritada çıktısı alınacak alanı seç.")
    : `Ölçek 1:${sayi(gecerliOlcek())} · Haritayı kaydırarak çerçeveyi yerleştir.`;
}

harita.on("move zoomend resize", () => { if (ciktiSekmesinde() && cikti.sablon !== "serbest") cerceveCiz(); });
harita.on("move", () => { if (ciktiSekmesinde()) canliKonumla(); });
// Kağıtta çerçeve haritayla birlikte kayar; ızgara değerleri yeni yere göre çizilsin.
harita.on("zoomend resize", () => canliZamanla());
harita.on("moveend", () => { if (ciktiSekmesinde() && cikti.sablon !== "serbest" && cikti.ogeler.izgara) canliZamanla(); });
document.addEventListener("sekme", () => {
  if (!ciktiSekmesinde()) serbestSecimBitir(true);
  cerceveCiz();
  if (ciktiSekmesinde()) ciktiPaneliDoldur();
  canliZamanla();
});

// ---- "Seçtiğim alan": haritada sürükleyerek dikdörtgen -----------------------------------------

const secim = { bas: null, kutu: null };
function serbestSecimBasla() {
  if (durum.mod === "sorgu") sorguModu(false);
  durum.mod = "cikti-sec";
  harita.dragging.disable();
  imlecGuncelle();
  $("alanSec").setAttribute("aria-pressed", "true");
  canliKonumla();
  mesaj("Haritada çıktısı alınacak alanı sürükleyerek çiz.");
}
function serbestSecimBitir(iptal = false) {
  if (durum.mod !== "cikti-sec") return;
  durum.mod = null;
  harita.dragging.enable();
  imlecGuncelle();
  secim.kutu?.remove();
  secim.bas = secim.kutu = null;
  $("alanSec").setAttribute("aria-pressed", "false");
  if (!iptal) cerceveCiz();
  canliZamanla();
}
harita.on("mousedown", (e) => {
  if (durum.mod !== "cikti-sec") return;
  secim.bas = e.latlng;
  secim.kutu = L.rectangle(L.latLngBounds(e.latlng, e.latlng), { pane: "cikti", color: HR.cizim, weight: 2, dashArray: "6 5", fillOpacity: 0.08, interactive: false }).addTo(harita);
});
harita.on("mousemove", (e) => { if (secim.kutu) secim.kutu.setBounds(L.latLngBounds(secim.bas, e.latlng)); });
harita.on("mouseup", (e) => {
  if (!secim.bas) return;
  const s = L.latLngBounds(secim.bas, e.latlng);
  const a = harita.latLngToContainerPoint(s.getSouthWest()), b = harita.latLngToContainerPoint(s.getNorthEast());
  if (Math.abs(b.x - a.x) > 20 && Math.abs(a.y - b.y) > 20) {
    cikti.serbest = [[s.getSouth(), s.getWest()], [s.getNorth(), s.getEast()]];
    cikti.konumlar = {};
  } else mesaj("Alan çok küçük; haritada sürükleyerek daha büyük bir dikdörtgen çiz.", true);
  serbestSecimBitir();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && durum.mod === "cikti-sec") serbestSecimBitir(true); });

// ---- karolar ---------------------------------------------------------------------------------

const karoOnbellegi = new Map(); // adres -> Promise<Image | null>
function karoYukle(adres) {
  if (!karoOnbellegi.has(adres)) {
    karoOnbellegi.set(adres, new Promise((coz) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => coz(img);
      img.onerror = () => coz(null);
      img.src = adres;
    }));
    if (karoOnbellegi.size > 3000) karoOnbellegi.delete(karoOnbellegi.keys().next().value);
  }
  return karoOnbellegi.get(adres);
}

const karoAdresi = (katman, x, y, z) => L.Util.template(katman._url, L.extend({ s: katman._getSubdomain({ x, y }), x, y, z }, katman.options));

// Bir karo yoksa (Esri'de bazı seviyeler eksik) üst seviyedeki karonun ilgili parçası kullanılır.
async function karoCiz(ctx, katman, x, y, z, hedef) {
  for (let fark = 0; fark <= 5 && z - fark >= 1; fark++) {
    const k = 2 ** fark;
    const img = await karoYukle(karoAdresi(katman, Math.floor(x / k), Math.floor(y / k), z - fark));
    if (!img) continue;
    const parca = img.naturalWidth / k;
    ctx.drawImage(img, (x % k) * parca, (y % k) * parca, parca, parca, hedef.x, hedef.y, hedef.en, hedef.en);
    return true;
  }
  return false;
}

// Çerçeveyi kaplayan karolar, çıktı çözünürlüğüne uygun seviyeden (karo büyütülmesin diye bir üstü).
async function karolariCiz(ctx, katman, g, opaklik = 1) {
  const enUst = katman.options.maxNativeZoom ?? 19;
  const z = Math.max(1, Math.min(enUst, Math.ceil(Math.log2((g.k * 2 * MERKATOR_R) / 256))));
  const n = 2 ** z, karoM = (2 * MERKATOR_R) / n;
  const [x0, x1] = [Math.floor((g.minX + MERKATOR_R) / karoM), Math.floor((g.maxX + MERKATOR_R) / karoM)];
  const [y0, y1] = [Math.floor((MERKATOR_R - g.maxY) / karoM), Math.floor((MERKATOR_R - g.minY) / karoM)];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > EN_COK_KARO) throw new Error("Çıktı alanı bu çözünürlük için çok büyük; daha küçük bir alan ya da daha düşük kalite seç.");
  ctx.save();
  ctx.globalAlpha = opaklik;
  const isler = [];
  let eksik = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const hedef = { x: g.x + (x * karoM - MERKATOR_R - g.minX) * g.k, y: g.y + (g.maxY - (MERKATOR_R - y * karoM)) * g.k, en: karoM * g.k + 0.5 };
      isler.push(karoCiz(ctx, katman, ((x % n) + n) % n, y, z, hedef).then((ok) => { if (!ok) eksik++; }));
    }
  }
  await Promise.all(isler);
  ctx.restore();
  return eksik;
}

// ---- tuvale çizim yardımcıları ------------------------------------------------------------------

function yuvarlakDikdortgen(ctx, x, y, en, boy, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, en, boy, r);
}

function cizgiDizisiTuval(cizgi, kalinlik, p) {
  const d = cizgiDizisi(cizgi, kalinlik);
  return d ? d.split(" ").map((v) => Number(v) * p) : [];
}

// Alan taraması tuval deseni olarak; haritadaki SVG deseniyle aynı aralık, açı ve opaklık.
function tuvalDeseni(ctx, renk, g, p, kalin = false) {
  const a = Math.max(2, Math.round(g.aralik * p));
  const t = Object.assign(document.createElement("canvas"), { width: a, height: a });
  const c = t.getContext("2d");
  c.strokeStyle = c.fillStyle = renk;
  c.globalAlpha = Math.min(1, g.opaklik / 100 + (kalin ? 0.2 : 0));
  c.lineWidth = (kalin ? 1.4 : 1) * p;
  const orta = a / 2;
  if (["capraz", "ters", "dikey", "kareli", "capraz-kareli"].includes(g.desen)) { c.beginPath(); c.moveTo(orta, 0); c.lineTo(orta, a); c.stroke(); }
  if (["yatay", "kareli", "capraz-kareli"].includes(g.desen)) { c.beginPath(); c.moveTo(0, orta); c.lineTo(a, orta); c.stroke(); }
  if (g.desen === "nokta") { c.beginPath(); c.arc(orta, orta, Math.max(1, g.aralik / 7) * p, 0, 2 * Math.PI); c.fill(); }
  const desen = ctx.createPattern(t, "repeat");
  const aci = { capraz: 45, ters: -45, "capraz-kareli": 45 }[g.desen] || 0;
  if (aci) desen.setTransform(new DOMMatrix().rotateSelf(aci));
  return desen;
}

function geometriYolu(geom, nokta) {
  const yol = new Path2D();
  const halka = (h, kapali) => {
    h.forEach(([lon, lat], i) => { const [x, y] = nokta(lat, lon); i ? yol.lineTo(x, y) : yol.moveTo(x, y); });
    if (kapali) yol.closePath();
  };
  const t = geom.type, c = geom.coordinates;
  if (t === "Polygon") c.forEach((h) => halka(h, true));
  else if (t === "MultiPolygon") c.forEach((pol) => pol.forEach((h) => halka(h, true)));
  else if (t === "LineString") halka(c, false);
  else if (t === "MultiLineString") c.forEach((h) => halka(h, false));
  return yol;
}

function alanCiz(ctx, r, g, p) {
  const v = r.gorsel, gizli = new Set(r.gizli || []), hesap = r.hesap_katmani;
  for (const f of r.geojson.features) {
    const ad = katmanAdi(f);
    if (gizli.has(ad) && ad !== hesap) continue;
    const tip = f.geometry.type;
    ctx.save();
    ctx.lineJoin = ctx.lineCap = "round";
    if (/Point$/.test(tip)) {
      const noktalar = tip === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const [lon, lat] of noktalar) {
        const [x, y] = g.nokta(lat, lon);
        ctx.beginPath(); ctx.arc(x, y, 5 * p, 0, 2 * Math.PI);
        ctx.globalAlpha = 0.8; ctx.fillStyle = r.renk; ctx.fill();
        ctx.globalAlpha = 1; ctx.lineWidth = 2 * p; ctx.strokeStyle = r.renk; ctx.stroke();
      }
    } else {
      const yol = geometriYolu(f.geometry, g.nokta);
      const kapali = /Polygon$/.test(tip);
      if (hesap != null && ad !== hesap) {
        ctx.globalAlpha = 0.7; ctx.lineWidth = p; ctx.strokeStyle = r.renk; ctx.stroke(yol);
      } else {
        if (kapali && v.desen === "dolu") { ctx.globalAlpha = v.opaklik / 100; ctx.fillStyle = r.renk; ctx.fill(yol, "evenodd"); }
        else if (kapali && v.desen !== "yok") { ctx.fillStyle = tuvalDeseni(ctx, r.renk, v, p); ctx.fill(yol, "evenodd"); }
        ctx.globalAlpha = 1;
        if (v.kalinlik) {
          ctx.lineWidth = v.kalinlik * p;
          ctx.setLineDash(cizgiDizisiTuval(v.cizgi, v.kalinlik, p));
          ctx.strokeStyle = r.renk;
          ctx.stroke(yol);
        }
      }
    }
    ctx.restore();
  }
}

// Haritadaki gibi: hale ya da kutu; çok satırlı yazı ortalanır.
function yaziCiz(ctx, satirlar, x, y, { boyut, kalin, renk, stil, p }) {
  ctx.save();
  ctx.font = `${kalin ? 700 : 500} ${boyut * p}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const satirBoy = boyut * 1.2 * p, en = Math.max(...satirlar.map((s) => ctx.measureText(s).width));
  const ust = y - (satirBoy * (satirlar.length - 1)) / 2;
  const acik = acikRenk(renk);
  if (stil === "kutu") {
    ctx.fillStyle = token(acik ? "--not-zemin-koyu" : "--not-zemin-acik");
    yuvarlakDikdortgen(ctx, x - en / 2 - 8 * p, ust - satirBoy / 2 - 4 * p, en + 16 * p, satirBoy * satirlar.length + 8 * p, 4 * p);
    ctx.fill();
  }
  satirlar.forEach((s, i) => {
    if (stil === "hale") {
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5 * p;
      ctx.strokeStyle = token(acik ? "--harita-yazi-hale" : "--not-hale-acik");
      ctx.strokeText(s, x, ust + i * satirBoy);
    }
    ctx.fillStyle = renk;
    ctx.fillText(s, x, ust + i * satirBoy);
  });
  ctx.restore();
}

function okCiz(ctx, a, b, { renk, kalinlik, uc, cizgi }, p) {
  const w = kalinlik * p, dx = b[0] - a[0], dy = b[1] - a[1], u = Math.hypot(dx, dy) || 1;
  const d = [dx / u, dy / u], bas = 3.4 * w;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = renk;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.setLineDash(cizgi === "kesik" ? [kalinlik * 3 * p, kalinlik * 2.2 * p] : []);
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
  const uc_ = (t, yon) => {
    const tip = [t[0] + yon[0] * bas * 0.2, t[1] + yon[1] * bas * 0.2];
    const taban = [tip[0] - yon[0] * bas, tip[1] - yon[1] * bas];
    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(taban[0] - yon[1] * bas / 2, taban[1] + yon[0] * bas / 2);
    ctx.lineTo(taban[0] + yon[1] * bas / 2, taban[1] - yon[0] * bas / 2);
    ctx.closePath();
    ctx.fill();
  };
  if (uc !== "yok") uc_(b, d);
  if (uc === "cift") uc_(a, [-d[0], -d[1]]);
  ctx.restore();
}

// Tablo: başlık satırı renkli, gövde beyaz zeminde; merkezi (x, y). Kutu ölçüleri döner. Düzen haritadakiyle
// aynı (app.js tabloDuzeni): boş sütun yok, tek hücreli satırlar tablonun enine yayılıp sarılır. Birden çok
// çalışma sayfası adlarıyla alt alta ya da yan yana.
function tabloCiz(ctx, n, x, y, boyutPx, olc = false) {
  const sayfalar = tabloSayfalari(n), adli = sayfalar.length > 1, yan = adli && tabloDizilisi(n) === "yan";
  ctx.save();
  const yazi = (k) => `${k ? 650 : 400} ${boyutPx}px Inter, sans-serif`;
  const dolgu = [boyutPx * 0.6, boyutPx * 0.3], satirBoy = boyutPx * 1.3 + dolgu[1] * 2, cizgi = Math.max(1, boyutPx / 12);
  const genislik = (m, kalin) => { ctx.font = yazi(kalin); return ctx.measureText(m).width; };
  const sar = (m, en, kalin) => { // kelime kelime satırlara böl
    ctx.font = yazi(kalin);
    const sonuc = [];
    let s = "";
    for (const k of m.split(/\s+/)) {
      const d = s ? `${s} ${k}` : k;
      if (s && ctx.measureText(d).width > en) { sonuc.push(s); s = k; } else s = d;
    }
    return s ? [...sonuc, s] : sonuc.length ? sonuc : [""];
  };
  const bloklar = sayfalar.map((s) => {
    const d = tabloDuzeni(s, n.baslikSatiri);
    const hucreli = [...(d.baslik ? [d.baslik] : []), ...d.govde.filter((r) => r.hucreler).map((r) => r.hucreler)];
    const enler = [...Array(d.sutunSayisi).keys()].map((j) => Math.max(0, ...hucreli.map((r, i) => genislik(r[j] || "", d.baslik && i === 0))) + dolgu[0] * 2);
    // Yayılan satırlar çok dar bir tabloda tek kelimeye düşmesin: en az 24 harflik yer
    const yayilanlar = [...d.ust, ...d.govde.filter((r) => !r.hucreler).map((r) => r.yayilan)];
    const enAz = Math.max(adli ? genislik(s.ad, true) : 0, Math.min(boyutPx * 14, Math.max(0, ...yayilanlar.map((m) => genislik(m, false))))) + dolgu[0] * 2;
    const toplam = enler.reduce((t, v) => t + v, 0);
    if (toplam < enAz) enler.forEach((v, j) => { enler[j] = v + ((enAz - toplam) * v) / (toplam || 1); });
    const en = Math.max(toplam, enAz), metinEn = en - dolgu[0] * 2;
    const ust = [...(adli ? [{ satirlar: [s.ad], kalin: true }] : []), ...d.ust.map((m) => ({ satirlar: sar(m, metinEn, false) }))];
    const govde = d.govde.map((r) => (r.hucreler ? r : { satirlar: sar(r.yayilan, metinEn, false) }));
    const boy = satirBoy * (ust.reduce((t, u) => t + u.satirlar.length, 0) + (d.baslik ? 1 : 0)
      + govde.reduce((t, r) => t + (r.hucreler ? 1 : r.satirlar.length), 0));
    return { d, enler, en, ust, govde, boy };
  });
  const ara = cizgi;
  const en = yan ? bloklar.reduce((t, b) => t + b.en, 0) + ara * (bloklar.length - 1) : Math.max(...bloklar.map((b) => b.en));
  const boy = yan ? Math.max(...bloklar.map((b) => b.boy)) : bloklar.reduce((t, b) => t + b.boy, 0) + ara * (bloklar.length - 1);
  const x0 = x - en / 2, y0 = y - boy / 2;
  if (!olc) {
    ctx.fillStyle = token("--not-beyaz");
    yuvarlakDikdortgen(ctx, x0, y0, en, boy, boyutPx * 0.5);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.textBaseline = "middle";
    const yatayCizgi = (bx, yy, w) => { ctx.fillStyle = token("--tablo-cizgi"); ctx.fillRect(bx, yy - cizgi, w, cizgi); };
    let bx = x0, by = y0;
    bloklar.forEach((b, k) => {
      if (k) { // sayfalar arasında çizgi
        ctx.fillStyle = token("--tablo-cizgi");
        if (yan) ctx.fillRect(bx - ara, y0, ara, boy); else ctx.fillRect(x0, by - ara, en, ara);
      }
      let yy = by;
      for (const u of b.ust) {
        ctx.font = yazi(!!u.kalin);
        ctx.fillStyle = token("--not-siyah");
        for (const m of u.satirlar) { ctx.fillText(m, bx + dolgu[0], yy + satirBoy / 2); yy += satirBoy; }
      }
      if (b.d.baslik) {
        ctx.fillStyle = n.renk;
        ctx.fillRect(bx, yy, b.en, satirBoy);
        ctx.font = yazi(true);
        ctx.fillStyle = token(acikRenk(n.renk) ? "--not-siyah" : "--not-beyaz");
        let cx = bx;
        b.d.baslik.forEach((h, j) => { ctx.fillText(h, cx + dolgu[0], yy + satirBoy / 2); cx += b.enler[j]; });
        yy += satirBoy;
      }
      ctx.font = yazi(false);
      b.govde.forEach((r, i) => {
        ctx.fillStyle = token("--not-siyah");
        if (r.hucreler) {
          let cx = bx;
          r.hucreler.forEach((h, j) => { ctx.fillText(h, cx + dolgu[0], yy + satirBoy / 2); cx += b.enler[j]; });
          yy += satirBoy;
        } else {
          for (const m of r.satirlar) { ctx.fillText(m, bx + dolgu[0], yy + satirBoy / 2); yy += satirBoy; }
        }
        if (i < b.govde.length - 1) yatayCizgi(bx, yy, b.en);
      });
      if (yan) bx += b.en + ara; else by += b.boy + ara;
    });
    ctx.restore();
  }
  ctx.restore();
  return { en, boy };
}

// Haritadaki alan adı rozeti: yarı saydam beyaz zemin, renkli nokta, ad.
function alanAdiCiz(ctx, r, x, y, p) {
  ctx.save();
  ctx.font = `600 ${12.5 * p}px Inter, sans-serif`;
  const yaziEn = ctx.measureText(r.ad).width, nokta = 8 * p, en = yaziEn + nokta + 24 * p, boy = 24 * p;
  ctx.fillStyle = token("--not-zemin-acik");
  yuvarlakDikdortgen(ctx, x - en / 2, y - boy / 2, en, boy, boy / 2);
  ctx.fill();
  ctx.fillStyle = r.renk;
  ctx.beginPath(); ctx.arc(x - en / 2 + 8 * p + nokta / 2, y, nokta / 2, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = token("--not-siyah");
  ctx.textBaseline = "middle";
  ctx.fillText(r.ad, x - en / 2 + 14 * p + nokta, y);
  ctx.restore();
}

// Lejant ve liste örnekleri SVG metni; içindeki desen ve ok uçları sayfadaki tanımlardan eklenip görsele çevrilir.
function svgResmi(svg, en, boy) {
  const kap = document.createElement("div");
  kap.innerHTML = svg;
  const el = kap.firstElementChild;
  el.setAttribute("xmlns", SVG_NS);
  el.setAttribute("width", en);
  el.setAttribute("height", boy);
  el.setAttribute("color", token("--not-siyah"));
  const tanimlar = [...new Set([...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]))]
    .map((id) => document.getElementById(id)?.outerHTML || "").join("");
  if (tanimlar) el.insertAdjacentHTML("afterbegin", `<defs>${tanimlar}</defs>`);
  return resimYukle(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(el.outerHTML)}`);
}

// ---- sayfa çizimi ------------------------------------------------------------------------------

const ADIM_UZUNLUKLARI = [1, 2, 5];
function yuvarlakUzunluk(m) {
  const us = 10 ** Math.floor(Math.log10(m));
  return Math.max(...ADIM_UZUNLUKLARI.map((a) => a * us).filter((v) => v <= m), us);
}
const uzunlukMetni = (m) => (m >= 1000 ? `${sayi(m / 1000, m % 1000 ? 1 : 0)} km` : `${sayi(m)} m`);

async function izgaraAl(s) {
  try {
    return await postJson("izgara", { bbox: [s.getWest(), s.getSouth(), s.getEast(), s.getNorth()], sistem: cikti.sistem });
  } catch (e) { mesaj(`Koordinat ızgarası çizilemedi: ${e.message}`, true); return null; }
}

// Sayfayı verilen çözünürlükte çizer. dpi: kağıtta inç başına piksel; serbest alanda ekran pikseli çarpanı
// "carpan" kullanılır. Dönen kutular önizlemede sürüklenebilen öğelerin sayfadaki yerleridir.
// canli: Çıktı sekmesinde haritanın üstüne konan sayfa; ekran çözünürlüğünde, harita alanı saydam
// (altında gerçek harita görünür), sadece kenar boşlukları ve sayfa öğeleri çizilir.
async function sayfaCiz({ onizleme = false, canli = false } = {}) {
  await document.fonts.ready;
  const serbest = cikti.sablon === "serbest";
  const s = cerceveSiniri();
  if (!s) throw new Error("Önce haritada çıktısı alınacak alanı seç.");
  let p, mm, sayfa, hc; // p: ekran pikseli başına çıktı pikseli, mm: milimetre başına piksel
  if (serbest) {
    const a = harita.latLngToContainerPoint(s.getSouthWest()), b = harita.latLngToContainerPoint(s.getNorthEast());
    const enEkran = Math.abs(b.x - a.x), boyEkran = Math.abs(a.y - b.y);
    // Seçilen alan ekrandan çok büyükse (uzaklaşıp seçip yakınlaşınca) piksel sayısı sınırlanır.
    p = canli ? devicePixelRatio
      : Math.min(onizleme ? 1.2 : cikti.carpan, (onizleme ? 1000 : EN_BUYUK_KENAR) / Math.max(enEkran, boyEkran));
    mm = (p * 96) / 25.4;
    sayfa = { en: Math.round(enEkran * p), boy: Math.round(boyEkran * p) };
    hc = { x: 0, y: 0, en: sayfa.en, boy: sayfa.boy };
  } else {
    const d = kagitDuzeni();
    const a = harita.latLngToContainerPoint(s.getSouthWest()), b = harita.latLngToContainerPoint(s.getNorthEast());
    const dpi = canli ? ((b.x - a.x) / d.harita.en) * devicePixelRatio * 25.4 // ekrandaki kağıtla aynı boy
      : onizleme ? Math.min(150, 1100 / (Math.max(d.en, d.boy) / 25.4)) : cikti.dpi;
    mm = dpi / 25.4;
    p = dpi / 96;
    sayfa = { en: Math.round(d.en * mm), boy: Math.round(d.boy * mm) };
    hc = { x: d.harita.x * mm, y: d.harita.y * mm, en: d.harita.en * mm, boy: d.harita.boy * mm };
  }
  const tuval = Object.assign(document.createElement("canvas"), { width: sayfa.en, height: sayfa.boy });
  const ctx = tuval.getContext("2d");
  ctx.fillStyle = token("--not-beyaz");
  ctx.fillRect(0, 0, sayfa.en, sayfa.boy);
  if (canli) ctx.clearRect(hc.x, hc.y, hc.en, hc.boy);

  // Merkatör -> sayfa pikseli
  const sw = merkatorla(s.getSouthWest()), ne = merkatorla(s.getNorthEast());
  const g = { x: hc.x, y: hc.y, minX: sw.x, maxX: ne.x, minY: sw.y, maxY: ne.y, k: hc.en / (ne.x - sw.x) };
  g.nokta = (lat, lng) => { const m = merkatorla([lat, lng]); return [g.x + (m.x - g.minX) * g.k, g.y + (g.maxY - m.y) * g.k]; };
  const enlem = s.getCenter().lat, yerK = g.k / Math.cos((enlem * Math.PI) / 180); // yer metresi başına piksel

  ctx.save();
  ctx.beginPath();
  ctx.rect(hc.x, hc.y, hc.en, hc.boy);
  ctx.clip();
  if (!canli) { // canlı sayfada altında gerçek harita var
    let eksik = await karolariCiz(ctx, aktifAltlik, g);
    if (aktifAltlik === altlik.Uydu && etiketAcik) {
      const [ulasim, yerler] = etiketler.getLayers();
      eksik += await karolariCiz(ctx, ulasim, g, ulasim.options.opacity ?? 1);
      eksik += await karolariCiz(ctx, yerler, g);
    }
    if (eksik && !onizleme) mesaj(`${eksik} harita karosu indirilemedi; çıktıda o yerler boş kalabilir.`, true);

    const sira = [...katmanSirasi].reverse(); // alttan üste
    const altBant = (id) => typeof id === "number" || notlar.get(id)?.tur === "gorsel";
    for (const id of sira.filter(altBant)) {
      if (typeof id === "number") {
        const r = referanslar.get(id)?.veri;
        if (r?.gorunur) alanCiz(ctx, r, g, p);
        continue;
      }
      const n = notlar.get(id);
      if (!n?.gorunur) continue;
      const img = await resimYukle(n.url);
      const [x, y] = g.nokta(...n.merkez), en = (n.genislik / Math.cos((n.merkez[0] * Math.PI) / 180)) * g.k, boy = (en * n.boy) / n.en;
      ctx.save();
      ctx.globalAlpha = n.opaklik / 100;
      if (n.karistir) ctx.globalCompositeOperation = "multiply";
      ctx.translate(x, y);
      ctx.rotate((n.aci * Math.PI) / 180);
      ctx.drawImage(img, -en / 2, -boy / 2, en, boy);
      ctx.restore();
    }

    // Ekranda açıksa boşluklar ve parsel çıkmayan noktalar
    if (bosluKatmani && sonOzet) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = HR.bosluk;
      for (const f of sonOzet.bosluk.geojson.features || []) {
        const yol = geometriYolu(f.geometry, g.nokta);
        ctx.globalAlpha = 0.14; ctx.fill(yol, "evenodd");
        ctx.globalAlpha = 1; ctx.lineWidth = 1.5 * p; ctx.setLineDash([4 * p, 4 * p]); ctx.stroke(yol);
      }
      ctx.restore();
    }

    // Parseller (seçililer mavi), sonra numaraları
    ctx.save();
    ctx.lineJoin = "round";
    for (const [key, f] of durum.parseller) {
      const st = parselStili(key, false);
      const yol = geometriYolu(f.geometry, g.nokta);
      ctx.globalAlpha = st.fillOpacity; ctx.fillStyle = st.fillColor; ctx.fill(yol, "evenodd");
      ctx.globalAlpha = st.opacity; ctx.lineWidth = st.weight * p; ctx.strokeStyle = st.color; ctx.stroke(yol);
    }
    ctx.restore();
    if (parselNo.acik) parselNumaralariCiz(ctx, g, hc, p); // etiket.js: hepsi yazılır, sığdırılır
    for (const id of sira.filter((i) => typeof i === "number")) {
      const r = referanslar.get(id)?.veri;
      if (!r?.gorunur || !r.gorsel.etiket) continue;
      const m = alanIcNokta(r);
      if (m) alanAdiCiz(ctx, r, ...g.nokta(m.lat, m.lng), p);
    }
    for (const id of sira.filter((i) => !altBant(i))) {
      const n = notlar.get(id);
      if (!n?.gorunur) continue;
      if (n.tur === "yazi") yaziCiz(ctx, n.metin.split("\n"), ...g.nokta(...n.konum), { ...n, p });
      else if (n.tur === "ok") okCiz(ctx, g.nokta(...n.noktalar[0]), g.nokta(...n.noktalar[1]), n, p);
      else if (n.tur === "tablo") tabloCiz(ctx, n, ...g.nokta(...n.konum), n.boyut * p);
    else if (n.tur === "grafik") {
      const { svg, en, boy } = dilimGrafigiSvg(n.veri, "kagit", n.ad);
      const [x, y] = g.nokta(...n.konum), k = n.boyut * p;
      const r = Math.min(1, (2 * Math.max(sayfa.en, sayfa.boy)) / Math.max(en * k, boy * k)); // sayfadan çok büyükse resim küçük üretilir
      ctx.drawImage(await svgResmi(svg, Math.round(en * k * r), Math.round(boy * k * r)), x - (en * k) / 2, y - (boy * k) / 2, en * k, boy * k);
    }
    }
  } else if (parselNo.acik) {
    parselNumaralariCiz(ctx, g, hc, p); // canlı sayfada da çıktıdaki gibi; haritadakiler gizlenir (canliNumaralar)
  }

  // Koordinat ızgarası: ince çizgiler, değerler çerçevenin iç kenarında
  if (cikti.ogeler.izgara) {
    const iz = await izgaraAl(s);
    if (iz) {
      ctx.save();
      ctx.strokeStyle = token("--not-beyaz");
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(1, 0.2 * mm);
      for (const c of [...iz.yler, ...iz.xler]) {
        ctx.beginPath();
        c.noktalar.forEach(([lon, lat], i) => { const [x, y] = g.nokta(lat, lon); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const yaz = (metin, x, y, hiza) => {
        ctx.font = `600 ${2.4 * mm}px Inter, sans-serif`;
        ctx.textAlign = hiza;
        ctx.textBaseline = "middle";
        ctx.lineWidth = 0.8 * mm;
        ctx.strokeStyle = token("--not-beyaz");
        ctx.strokeText(metin, x, y);
        ctx.fillStyle = token("--not-siyah");
        ctx.fillText(metin, x, y);
      };
      const pay = 1.8 * mm;
      for (const c of iz.yler) { // Y değerleri üst kenarda
        const ust = c.noktalar.reduce((a, b) => (b[1] > a[1] ? b : a));
        const [x] = g.nokta(ust[1], ust[0]);
        if (x > hc.x + 12 * mm && x < hc.x + hc.en - 12 * mm) yaz(`Y ${sayi(c.deger)}`, x, hc.y + pay, "center");
      }
      for (const c of iz.xler) { // X değerleri sol kenarda
        const sol = c.noktalar.reduce((a, b) => (b[0] < a[0] ? b : a));
        const [, y] = g.nokta(sol[1], sol[0]);
        if (y > hc.y + 6 * mm && y < hc.y + hc.boy - 6 * mm) yaz(`X ${sayi(c.deger)}`, hc.x + pay, y, "left");
      }
      yaz(`${iz.sistem} · DOM ${iz.dom}`, hc.x + hc.en - pay, hc.y + hc.boy - pay, "right");
      ctx.restore();
    }
  }
  ctx.restore(); // harita kırpması bitti

  if (!serbest) {
    ctx.strokeStyle = token("--not-siyah");
    ctx.lineWidth = Math.max(1, 0.3 * mm);
    ctx.strokeRect(hc.x, hc.y, hc.en, hc.boy);
  }

  // ---- konumlanabilen öğeler ----
  const kutular = [];
  const yerlestir = (id, en, boy, varsayilan) => {
    const k = cikti.konumlar[id];
    const x = k ? k.x * sayfa.en : varsayilan[0], y = k ? k.y * sayfa.boy : varsayilan[1];
    const kutu = { id, x: Math.max(0, Math.min(sayfa.en - en, x)), y: Math.max(0, Math.min(sayfa.boy - boy, y)), en, boy };
    kutular.push(kutu);
    return kutu;
  };
  const ic = 4 * mm; // çerçeveden içeri pay
  const beyazKutu = (k) => {
    ctx.save();
    ctx.fillStyle = token("--not-zemin-acik");
    ctx.strokeStyle = token("--tablo-cizgi");
    ctx.lineWidth = Math.max(1, 0.2 * mm);
    yuvarlakDikdortgen(ctx, k.x, k.y, k.en, k.boy, 1.5 * mm);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  // Hazır öğelerin içindeki ölçüler kendi büyütme çarpanıyla (b) çarpılır; yerleri mm ile hesaplanır.
  const buyut = (id) => mm * (cikti.boyutlar[id] ?? 1);

  if (cikti.ogeler.baslik) {
    const baslik = cikti.baslik.trim() || "Parsel Sorgu +", tarih = cikti.tarih.trim() || bugun();
    const b = buyut("baslik");
    ctx.save();
    ctx.font = `700 ${5.5 * b}px Inter, sans-serif`;
    const baslikEn = ctx.measureText(baslik).width;
    ctx.font = `500 ${3.2 * b}px Inter, sans-serif`;
    const tarihEn = ctx.measureText(tarih).width;
    const en = Math.max(baslikEn, tarihEn) + (serbest ? 8 * b : 0), boy = 11 * b;
    const k = yerlestir("baslik", en, boy, serbest ? [ic, ic] : [hc.x, 10 * mm - 1 * mm]);
    if (serbest) beyazKutu(k);
    const x = k.x + (serbest ? 4 * b : 0);
    ctx.fillStyle = token("--not-siyah");
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${5.5 * b}px Inter, sans-serif`;
    ctx.fillText(baslik, x, k.y + 6 * b);
    ctx.font = `500 ${3.2 * b}px Inter, sans-serif`;
    ctx.fillStyle = token("--metin-3");
    ctx.fillText(tarih, x, k.y + 10 * b);
    ctx.restore();
  }

  if (cikti.ogeler.lejant) {
    const ogeler = lejant.ogeler.filter((o) => lejantGecerli(o) && lejantGorunur(o));
    if (ogeler.length) {
      const b = buyut("lejant");
      const satirBoy = 6 * b, ornekEn = 8 * b, ornekBoy = 5.5 * b, dolgu = 3 * b;
      ctx.save();
      ctx.font = `600 ${3 * b}px Inter, sans-serif`;
      const baslik = lejant.baslik.trim() || "Lejant";
      let en = ctx.measureText(baslik).width;
      ctx.font = `400 ${2.8 * b}px Inter, sans-serif`;
      for (const o of ogeler) en = Math.max(en, ornekEn + 2.5 * b + ctx.measureText(lejantAdi(o)).width);
      const kEn = en + dolgu * 2, kBoy = dolgu * 2 + 5 * b + ogeler.length * satirBoy;
      const k = yerlestir("lejant", kEn, kBoy, [hc.x + ic, hc.y + hc.boy - ic - kBoy]);
      beyazKutu(k);
      ctx.fillStyle = token("--not-siyah");
      ctx.textBaseline = "middle";
      ctx.font = `600 ${3 * b}px Inter, sans-serif`;
      ctx.fillText(baslik, k.x + dolgu, k.y + dolgu + 2 * b);
      ctx.font = `400 ${2.8 * b}px Inter, sans-serif`;
      for (const [i, o] of ogeler.entries()) {
        const y = k.y + dolgu + 5 * b + i * satirBoy;
        const resim = await svgResmi(lejantOrnegi(o), Math.round(ornekEn), Math.round(ornekBoy));
        ctx.drawImage(resim, k.x + dolgu, y + (satirBoy - ornekBoy) / 2, ornekEn, ornekBoy);
        ctx.fillText(lejantAdi(o), k.x + dolgu + ornekEn + 2.5 * b, y + satirBoy / 2);
      }
      ctx.restore();
    }
  }

  if (cikti.ogeler.kuzey) {
    // Kuzey oku
    const kb = buyut("kuzey");
    const kEn = 11 * kb, kBoy = 15 * kb;
    const k = yerlestir("kuzey", kEn, kBoy, [hc.x + hc.en - ic - kEn, hc.y + ic]);
    beyazKutu(k);
    const cx = k.x + kEn / 2, ust = k.y + 6 * kb, alt = k.y + kBoy - 2 * kb, yari = 2.6 * kb;
    ctx.save();
    ctx.fillStyle = token("--not-siyah");
    ctx.strokeStyle = token("--not-siyah");
    ctx.lineWidth = Math.max(1, 0.25 * kb);
    ctx.beginPath(); ctx.moveTo(cx, ust); ctx.lineTo(cx - yari, alt); ctx.lineTo(cx, alt - 2 * kb); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, ust); ctx.lineTo(cx + yari, alt); ctx.lineTo(cx, alt - 2 * kb); ctx.closePath(); ctx.stroke();
    ctx.font = `700 ${3.2 * kb}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("K", cx, k.y + 3 * kb);
    ctx.restore();

    // Ölçek çubuğu: çerçeve genişliğinin beşte birine yakın yuvarlak uzunluk. Büyütünce yazılar büyür,
    // çubuk da daha uzun bir yuvarlak uzunluğa geçer (her zaman haritanın ölçeğine uyar).
    const oc = cikti.boyutlar.olcek ?? 1, ob = mm * oc;
    const metre = yuvarlakUzunluk(((hc.en / yerK) / 5) * oc), cubuk = metre * yerK;
    const olcekMetni = serbest ? "" : `Ölçek 1:${sayi(gecerliOlcek())}`;
    ctx.save();
    ctx.font = `500 ${2.6 * ob}px Inter, sans-serif`;
    const oEn = Math.max(cubuk, ctx.measureText(olcekMetni).width) + 8 * ob, oBoy = (olcekMetni ? 13 : 9.5) * ob;
    const o = yerlestir("olcek", oEn, oBoy, [hc.x + hc.en - ic - oEn, hc.y + hc.boy - ic - oBoy]);
    beyazKutu(o);
    const x0 = o.x + 4 * ob, y0 = o.y + 6 * ob, h = 1.6 * ob;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = token(i % 2 ? "--not-beyaz" : "--not-siyah");
      ctx.fillRect(x0 + (cubuk / 4) * i, y0, cubuk / 4, h);
    }
    ctx.strokeStyle = token("--not-siyah");
    ctx.lineWidth = Math.max(1, 0.2 * ob);
    ctx.strokeRect(x0, y0, cubuk, h);
    ctx.fillStyle = token("--not-siyah");
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("0", x0, y0 - 1 * ob);
    if (cubuk > 24 * ob) ctx.fillText(uzunlukMetni(metre / 2), x0 + cubuk / 2, y0 - 1 * ob); // kısa çubukta sığmaz
    ctx.fillText(uzunlukMetni(metre), x0 + cubuk, y0 - 1 * ob);
    if (olcekMetni) { ctx.font = `600 ${2.8 * ob}px Inter, sans-serif`; ctx.fillText(olcekMetni, x0 + cubuk / 2, y0 + h + 4.2 * ob); }
    ctx.restore();
  }

  // Sayfaya konan görsel, tablo ve yazılar
  for (const [i, o] of cikti.sayfaOgeleri.entries()) {
    const varsayilan = [hc.x + ic + i * 6 * mm, hc.y + ic + 18 * mm + i * 6 * mm];
    if (o.tur === "gorsel") {
      const img = await resimYukle(o.url);
      const en = o.genislikMm * mm, boy = (en * o.boy) / o.en;
      const k = yerlestir(o.id, en, boy, varsayilan);
      ctx.drawImage(img, k.x, k.y, en, boy);
    } else if (o.tur === "grafik") {
      const { svg, en: gEn, boy: gBoy } = dilimGrafigiSvg(o.veri, "kagit", o.ad);
      const en = o.genislikMm * mm, boy = (en * gBoy) / gEn;
      const k = yerlestir(o.id, en, boy, varsayilan);
      const r = Math.min(1, (2 * Math.max(sayfa.en, sayfa.boy)) / Math.max(en, boy)); // sayfadan çok büyükse resim küçük üretilir
      ctx.drawImage(await svgResmi(svg, Math.round(en * r), Math.round(boy * r)), k.x, k.y, en, boy);
    } else if (o.tur === "tablo") {
      const olcu = tabloCiz(ctx, o, 0, 0, o.boyutMm * mm, true);
      const k = yerlestir(o.id, olcu.en, olcu.boy, varsayilan);
      tabloCiz(ctx, o, k.x + olcu.en / 2, k.y + olcu.boy / 2, o.boyutMm * mm);
    } else {
      const satirlar = o.metin.split("\n");
      ctx.font = `${o.kalin ? 700 : 500} ${o.boyutMm * mm}px Inter, sans-serif`;
      const en = Math.max(...satirlar.map((s) => ctx.measureText(s).width)) + 2 * mm, boy = satirlar.length * o.boyutMm * 1.2 * mm + 1 * mm;
      const k = yerlestir(o.id, en, boy, varsayilan);
      yaziCiz(ctx, satirlar, k.x + en / 2, k.y + boy / 2, { boyut: o.boyutMm * mm, kalin: o.kalin, renk: o.renk, stil: "sade", p: 1 });
    }
  }
  return { tuval, kutular, sayfa };
}

// ---- dışa verme -------------------------------------------------------------------------------

let jspdfSozu = null;
function jspdfYukle() {
  jspdfSozu ??= new Promise((coz, red) => {
    const betik = Object.assign(document.createElement("script"), { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" });
    betik.onload = () => coz(window.jspdf.jsPDF);
    betik.onerror = () => { jspdfSozu = null; red(new Error("PDF hazırlayıcı yüklenemedi; internet bağlantısını kontrol et.")); };
    document.head.append(betik);
  });
  return jspdfSozu;
}

function dosyaAdi(uzanti) {
  const ad = (cikti.baslik.trim() || "parsel-sorgu-cikti").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
  return `${ad}-${new Date().toISOString().slice(0, 10)}.${uzanti}`;
}

// Önce kaydedilecek yer sorulur (app.js kayitYeriSor), sayfa sonra çizilir.
async function ciktiIndir(bicim, buton) {
  const ad = dosyaAdi(bicim);
  const hedef = await kayitYeriSor(ad);
  if (hedef === false) return;
  yukleniyor(buton, true);
  try {
    const { tuval } = await sayfaCiz();
    if (bicim === "png") {
      await dosyaYaz(hedef, await new Promise((coz) => tuval.toBlob(coz, "image/png")), ad);
    } else {
      const jsPDF = await jspdfYukle();
      const serbest = cikti.sablon === "serbest";
      const [en, boy] = serbest ? [(tuval.width * 25.4) / (96 * cikti.carpan), (tuval.height * 25.4) / (96 * cikti.carpan)]
        : [kagitDuzeni().en, kagitDuzeni().boy];
      const pdf = new jsPDF({ orientation: en > boy ? "landscape" : "portrait", unit: "mm", format: [en, boy], compress: true });
      pdf.addImage(tuval.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, en, boy);
      await dosyaYaz(hedef, pdf.output("blob"), ad);
    }
  } catch (e) { mesaj(e.message, true); } finally { yukleniyor(buton, false); }
}

// ---- önizleme: öğeleri sürükleyerek yerleştirme ----------------------------------------------------

const onizleme = { surum: 0, kutular: [], sayfa: null, zamanlayici: 0, surukle: null };

// Sayfa tuvali ve üstünde sürüklenebilen kutular (önizlemede ve haritadaki canlı sayfada ortak).
function kutulariYerlestir(kap, tuval, kutular, sayfa) {
  tuval.className = "onizleme-tuval";
  kap.replaceChildren(tuval, ...kutular.map((k) => {
    const el = document.createElement("div");
    el.className = "onizleme-kutu";
    el.dataset.id = k.id;
    el.title = "Sürükleyerek yerleştir";
    el.innerHTML = `<span class="onizleme-tutamac" title="Sürükleyerek büyüt ya da küçült"></span>`;
    Object.assign(el.style, { left: `${(100 * k.x) / sayfa.en}%`, top: `${(100 * k.y) / sayfa.boy}%`, width: `${(100 * k.en) / sayfa.en}%`, height: `${(100 * k.boy) / sayfa.boy}%` });
    return el;
  }));
}

async function onizlemeCiz() {
  const surum = ++onizleme.surum;
  $("onizlemeDurum").textContent = "Hazırlanıyor…";
  try {
    const { tuval, kutular, sayfa } = await sayfaCiz({ onizleme: true });
    if (surum !== onizleme.surum) return;
    Object.assign(onizleme, { kutular, sayfa });
    const kap = $("onizlemeSayfa");
    kutulariYerlestir(kap, tuval, kutular, sayfa);
    kap.style.aspectRatio = `${sayfa.en} / ${sayfa.boy}`;
    kap.style.setProperty("--oran", (sayfa.en / sayfa.boy).toFixed(4));
    $("onizlemeDurum").textContent = kutular.length ? "Öğeleri sürükleyerek taşı; köşedeki tutamaçla büyüt ya da küçült." : "";
  } catch (e) {
    $("onizlemeDurum").textContent = e.message;
  }
}

function onizlemeZamanla() {
  clearTimeout(onizleme.zamanlayici);
  onizleme.zamanlayici = setTimeout(onizlemeCiz, 120);
}

// Kutunun kendisi taşır; köşedeki tutamaç en/boy oranını koruyarak büyütür (sol üst köşe yerinde kalır).
// yuzey: kutular ve sayfa ölçüleri (önizleme ya da canlı sayfa); bitince yenile() yeniden çizer.
function duzenleyiciBagla(kap, yuzey, yenile) {
  kap.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".onizleme-kutu");
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // haritayı kaydırmasın
    el.setPointerCapture(e.pointerId);
    const r = kap.getBoundingClientRect(), k = yuzey.kutular.find((x) => x.id === el.dataset.id);
    yuzey.surukle = { el, k, r, bas: [e.clientX, e.clientY], boyut: !!e.target.closest(".onizleme-tutamac") };
    el.classList.add("suruklenen");
  });
  kap.addEventListener("pointermove", (e) => {
    const s = yuzey.surukle;
    if (!s) return;
    if (s.boyut) {
      const sayfa = yuzey.sayfa, k = s.k;
      const dx = ((e.clientX - s.bas[0]) * sayfa.en) / s.r.width, dy = ((e.clientY - s.bas[1]) * sayfa.boy) / s.r.height;
      // Sürükleme köşegen boyunca izdüşürülür; kutu sayfadan taşmaz.
      const enFazla = Math.min((sayfa.en - k.x) / k.en, (sayfa.boy - k.y) / k.boy);
      s.carpan = Math.max(0.2, Math.min(enFazla, 1 + (dx * k.en + dy * k.boy) / (k.en ** 2 + k.boy ** 2)));
      s.el.style.width = `${(100 * k.en * s.carpan) / sayfa.en}%`;
      s.el.style.height = `${(100 * k.boy * s.carpan) / sayfa.boy}%`;
      return;
    }
    const dx = (e.clientX - s.bas[0]) / s.r.width, dy = (e.clientY - s.bas[1]) / s.r.height;
    const x = Math.max(0, Math.min(1 - s.k.en / yuzey.sayfa.en, s.k.x / yuzey.sayfa.en + dx));
    const y = Math.max(0, Math.min(1 - s.k.boy / yuzey.sayfa.boy, s.k.y / yuzey.sayfa.boy + dy));
    s.el.style.left = `${x * 100}%`;
    s.el.style.top = `${y * 100}%`;
    s.konum = { x, y };
  });
  const bitir = () => {
    const s = yuzey.surukle;
    yuzey.surukle = null;
    if (!s) return;
    s.el.classList.remove("suruklenen");
    if (s.konum) { cikti.konumlar[s.k.id] = s.konum; yenile(); }
    if (s.carpan && Math.abs(s.carpan - 1) > 0.01) {
      cikti.konumlar[s.k.id] = { x: s.k.x / yuzey.sayfa.en, y: s.k.y / yuzey.sayfa.boy };
      ogeyiBuyut(s.k.id, s.carpan);
      yenile();
    }
  };
  kap.addEventListener("pointerup", bitir);
  kap.addEventListener("pointercancel", bitir);
}
duzenleyiciBagla($("onizlemeSayfa"), onizleme, onizlemeZamanla);

const sinirla = (v, [alt, ust], adim = 0.01) => Math.min(ust, Math.max(alt, Math.round(v / adim) * adim));
const genislikli = (o) => o.tur === "gorsel" || o.tur === "grafik";

// Sayfaya konanlarda boyut (mm) değişir, hazır öğelerde çarpan; paneldeki kaydırıcı ve kutu da güncellenir.
function ogeyiBuyut(id, carpan) {
  const o = cikti.sayfaOgeleri.find((x) => x.id === id);
  if (o && genislikli(o)) o.genislikMm = sinirla(o.genislikMm * carpan, SAYFA_OGE_SINIRI, 0.1);
  else if (o) o.boyutMm = sinirla(o.boyutMm * carpan, SAYFA_OGE_SINIRI, 0.1);
  else cikti.boyutlar[id] = sinirla((cikti.boyutlar[id] ?? 1) * carpan, HAZIR_OGE_SINIRI);
  sayfaOgeleriCiz();
  hazirBoyutlariDoldur();
}

// Hazır öğelerin (başlık, lejant, kuzey oku, ölçek) boyutu, yüzde
const HAZIR_OGE_ADLARI = { baslik: "Başlık boyutu", lejant: "Lejant boyutu", kuzey: "Kuzey oku boyutu", olcek: "Ölçek boyutu" };
function hazirBoyutlariDoldur() {
  document.querySelectorAll("#panel-cikti [data-hazir-boyut]").forEach((el) => {
    const id = el.dataset.hazirBoyut, deger = Math.round((cikti.boyutlar[id] ?? 1) * 1000) / 10;
    el.hidden = !cikti.ogeler[id === "olcek" ? "kuzey" : id];
    const kutu = el.querySelector("input[type=text]");
    if (kutu && document.activeElement === kutu) return; // yazılırken bozulmasın
    el.innerHTML = sayiliKaydirici({ is: "hazir", etiket: { kuzey: "Kuzey oku", olcek: "Ölçek" }[id] || "Boyut", aralik: HAZIR_OGE_ARALIGI, deger, birim: "%", ad: HAZIR_OGE_ADLARI[id] });
    kaydiriciDoldur(el.querySelector("input[type=range]"));
  });
}
$("panel-cikti").addEventListener("input", (e) => {
  if (e.target.dataset.is !== "hazir") return;
  const v = sayiliDegisti(e.target, [HAZIR_OGE_SINIRI[0] * 100, HAZIR_OGE_SINIRI[1] * 100]);
  if (v === null) return;
  cikti.boyutlar[e.target.closest("[data-hazir-boyut]").dataset.hazirBoyut] = v / 100;
  canliZamanla();
});

$("ciktiOnizle").addEventListener("click", () => {
  $("onizleme").showModal();
  onizlemeCiz();
});
$("onizlemeKapat").addEventListener("click", () => $("onizleme").close());
$("onizleme").addEventListener("close", () => canliZamanla()); // önizlemede yapılan değişiklik haritadaki sayfaya da gelsin
$("onizlemeSifirla").addEventListener("click", () => { cikti.konumlar = {}; cikti.boyutlar = {}; hazirBoyutlariDoldur(); onizlemeCiz(); });
for (const [id, bicim] of [["ciktiPng", "png"], ["ciktiPdf", "pdf"], ["onizlemePng", "png"], ["onizlemePdf", "pdf"]]) {
  $(id).addEventListener("click", (e) => ciktiIndir(bicim, e.currentTarget));
}

// ---- çıktı paneli -------------------------------------------------------------------------------

function ciktiPaneliDoldur() {
  const serbest = cikti.sablon === "serbest";
  document.querySelectorAll("input[name=ciktiSablon]").forEach((x) => { x.checked = x.value === cikti.sablon; });
  document.querySelectorAll("input[name=ciktiYon]").forEach((x) => { x.checked = x.value === cikti.yon; });
  document.querySelectorAll("input[name=ciktiDpi]").forEach((x) => { x.checked = Number(x.value) === cikti.dpi; });
  document.querySelectorAll("input[name=ciktiCarpan]").forEach((x) => { x.checked = Number(x.value) === cikti.carpan; });
  document.querySelectorAll("input[name=ciktiSistem]").forEach((x) => { x.checked = x.value === cikti.sistem; });
  document.querySelectorAll("#panel-cikti [data-sablon]").forEach((el) => { el.hidden = (el.dataset.sablon === "serbest") !== serbest; });
  $("ciktiCanli").checked = cikti.canli;
  $("ciktiOlcek").value = String(cikti.olcek);
  $("ciktiOlcek").dispatchEvent(new Event("change"));
  for (const ad of Object.keys(cikti.ogeler)) $(`ciktiOge-${ad}`).checked = cikti.ogeler[ad];
  $("ciktiBaslikAlanlari").hidden = !cikti.ogeler.baslik;
  $("ciktiSistemSecimi").hidden = !cikti.ogeler.izgara;
  if (document.activeElement !== $("ciktiBaslik")) $("ciktiBaslik").value = cikti.baslik;
  if (document.activeElement !== $("ciktiTarih")) $("ciktiTarih").value = cikti.tarih;
  $("ciktiTarih").placeholder = bugun();
  const lejantVar = lejant.ogeler.some((o) => lejantGecerli(o) && lejantGorunur(o));
  $("ciktiLejantUyari").hidden = !cikti.ogeler.lejant || lejantVar;
  sayfaOgeleriCiz();
  hazirBoyutlariDoldur();
  ciktiBilgisi();
  canliZamanla();
}

function ciktiAyari(degisim) {
  Object.assign(cikti, degisim);
  ciktiKaydet();
  ciktiPaneliDoldur();
  cerceveCiz();
}

for (const [ad, alan, sayisal] of [["ciktiSablon", "sablon"], ["ciktiYon", "yon"], ["ciktiDpi", "dpi", true], ["ciktiCarpan", "carpan", true], ["ciktiSistem", "sistem"]]) {
  document.querySelectorAll(`input[name=${ad}]`).forEach((x) => x.addEventListener("change", () => {
    const degisim = { [alan]: sayisal ? Number(x.value) : x.value };
    if (alan === "sablon" || alan === "yon") degisim.konumlar = {};
    if (alan === "sablon" && x.value === "serbest" && !cikti.serbest) {
      // İlk seçimde ekranın ortası; istenirse haritada yeniden çizilir.
      const b = harita.getBounds().pad(-0.2);
      degisim.serbest = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    }
    ciktiAyari(degisim);
  }));
}
$("ciktiOlcek").addEventListener("change", (e) => {
  const deger = e.target.value === "otomatik" ? "otomatik" : Number(e.target.value);
  if (deger === cikti.olcek) return;
  ciktiAyari({ olcek: deger });
});
for (const ad of Object.keys(cikti.ogeler)) {
  $(`ciktiOge-${ad}`).addEventListener("change", (e) => ciktiAyari({ ogeler: { ...cikti.ogeler, [ad]: e.target.checked } }));
}
$("ciktiBaslik").addEventListener("input", (e) => { cikti.baslik = e.target.value; ciktiKaydet(); canliZamanla(); });
$("ciktiTarih").addEventListener("input", (e) => { cikti.tarih = e.target.value; canliZamanla(); });
$("ciktiCanli").addEventListener("change", (e) => ciktiAyari({ canli: e.target.checked }));
$("alanSec").addEventListener("click", () => (durum.mod === "cikti-sec" ? serbestSecimBitir(true) : serbestSecimBasla()));
$("ciktiLejantGit").addEventListener("click", () => {
  sekmeAc("gorsel");
  $("lejantKutu").scrollIntoView({ block: "start", behavior: "smooth" });
});

// ---- sayfaya konan öğeler: logo, tablo, açıklama yazısı --------------------------------------------

let sayfaSayac = 0;
// Grafiğin adı sayfada başlığı olarak yazılır (boş bırakılırsa başlıksız); görsel ve tablonun adı listede.
const SAYFA_OGE_AD = { gorsel: "Görsel", tablo: "Tablo", grafik: "" };
function sayfaOgeleriCiz() {
  $("sayfaOgeleri").innerHTML = cikti.sayfaOgeleri.map((o) => {
    const boyut = sayiliKaydirici(genislikli(o)
      ? { is: "boyut", etiket: "Genişlik", aralik: SAYFA_OGE_ARALIGI[o.tur], deger: o.genislikMm, birim: "mm", ad: `${o.ad || "Grafik"} genişliği` }
      : { is: "boyut", etiket: "Boyut", aralik: SAYFA_OGE_ARALIGI[o.tur], deger: o.boyutMm, birim: "mm", ad: `${o.ad || "Yazı"} yazı boyutu` });
    const ust = o.tur === "yazi"
      ? `<textarea class="metin-girdi not-metin" data-is="metin" rows="2" maxlength="300" aria-label="Sayfadaki yazı">${esc(o.metin)}</textarea>`
      : `<input class="oge-ad" data-is="ad" maxlength="80" autocomplete="off" spellcheck="false" value="${esc(o.ad)}"
          placeholder="${o.tur === "grafik" ? "Başlıksız grafik" : SAYFA_OGE_AD[o.tur]}" aria-label="${o.tur === "grafik" ? "Grafiğin başlığı" : "Adı"}">`;
    // Birden çok çalışma sayfası olan tabloda hangisi ya da hepsi (alt alta, yan yana)
    const dizilis = o.tur === "tablo" && tabloDizilisi(o);
    const sayfaSecimi = o.tur === "tablo" && o.sayfalar.length > 1
      ? `<label class="sayfa-oge-sayfa"><span>Sayfalar</span><select data-is="sayfa" class="metin-girdi">`
        + `<option value="alt"${dizilis === "alt" ? " selected" : ""}>Hepsi, alt alta</option>`
        + `<option value="yan"${dizilis === "yan" ? " selected" : ""}>Hepsi, yan yana</option>`
        + o.sayfalar.map((s, i) => `<option value="${i}"${dizilis === "tek" && o.sayfa === i ? " selected" : ""}>${esc(s.ad)}</option>`).join("")
        + `</select></label>` : "";
    return `<li data-id="${o.id}">
      <div class="sayfa-oge-ust">${ikon({ gorsel: "resim", tablo: "tablo", grafik: "analiz" }[o.tur] || "yazi")}${ust}
        <button type="button" class="ikon-dugme" data-is="sil" aria-label="${esc(o.ad || "Grafik")} sayfadan çıkar" title="Sayfadan çıkar">${ikon("kapat")}</button></div>
      ${sayfaSecimi}${boyut}
    </li>`;
  }).join("");
  $("sayfaOgeleri").querySelectorAll("input[type=range]").forEach(kaydiriciDoldur);
  canliZamanla();
}

async function sayfayaEkle(dosyalar) {
  for (const f of dosyalar) {
    try {
      const ad = f.name.replace(/\.[^.]+$/, "");
      if (GORSEL_MI(f)) {
        const v = await gorselOku(f);
        v.pdf?.destroy();
        cikti.sayfaOgeleri.push({ id: `s${++sayfaSayac}`, tur: "gorsel", ad, url: v.url, en: v.en, boy: v.boy, genislikMm: 40 });
      } else if (TABLO_MI(f)) {
        const r = await api("tablo-oku", { method: "POST", headers: { "X-Dosya-Adi": encodeURIComponent(f.name) }, body: await dosyaIcerigi(f) });
        cikti.sayfaOgeleri.push({ id: `s${++sayfaSayac}`, tur: "tablo", ad, sayfalar: r.sayfalar, sayfa: 0, dizilis: r.sayfalar.length > 1 ? "alt" : "tek", baslikSatiri: true, boyutMm: 2.6, renk: token("--not-siyah") });
      } else mesaj(`${f.name}: görsel, PDF ya da Excel/CSV seç.`, true);
    } catch (e) { mesaj(`${f.name}: ${e.message}`, true); }
  }
  sayfaOgeleriCiz();
}

$("sayfaGorsel").addEventListener("click", () => $("sayfaGorselSec").click());
$("sayfaTablo").addEventListener("click", () => $("sayfaTabloSec").click());
for (const id of ["sayfaGorselSec", "sayfaTabloSec"]) {
  $(id).addEventListener("change", async (e) => { const d = [...e.target.files]; e.target.value = ""; await sayfayaEkle(d); });
}
$("sayfaYazi").addEventListener("click", () => {
  cikti.sayfaOgeleri.push({ id: `s${++sayfaSayac}`, tur: "yazi", ad: "Yazı", metin: "Açıklama", boyutMm: 4, kalin: false, renk: token("--not-siyah") });
  sayfaOgeleriCiz();
  $("sayfaOgeleri").lastElementChild.querySelector("textarea").select();
});
const sayfaOgesi = (el) => cikti.sayfaOgeleri.find((o) => o.id === el.closest("li").dataset.id);
$("sayfaOgeleri").addEventListener("input", (e) => {
  const o = sayfaOgesi(e.target);
  if (e.target.dataset.is === "metin") { o.metin = e.target.value; o.ad = o.metin.split("\n")[0].slice(0, 30) || "Yazı"; return canliZamanla(); }
  if (e.target.dataset.is === "ad") {
    o.ad = o.tur === "grafik" ? e.target.value.trim() : e.target.value.trim() || SAYFA_OGE_AD[o.tur];
    return canliZamanla();
  }
  if (e.target.dataset.is === "sayfa") {
    const v = e.target.value;
    if (v === "alt" || v === "yan") o.dizilis = v;
    else Object.assign(o, { dizilis: "tek", sayfa: Number(v) });
    return canliZamanla();
  }
  if (e.target.dataset.is !== "boyut") return;
  const v = sayiliDegisti(e.target, SAYFA_OGE_SINIRI);
  if (v === null) return;
  if (genislikli(o)) o.genislikMm = v; else o.boyutMm = v;
  canliZamanla();
});
$("sayfaOgeleri").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.is === "ad") e.target.blur(); });
$("sayfaOgeleri").addEventListener("click", (e) => {
  const b = e.target.closest("[data-is=sil]");
  if (!b) return;
  const o = sayfaOgesi(b);
  cikti.sayfaOgeleri.splice(cikti.sayfaOgeleri.indexOf(o), 1);
  delete cikti.konumlar[o.id];
  if (o.tur === "gorsel") URL.revokeObjectURL(o.url);
  sayfaOgeleriCiz();
});

// ---- canlı sayfa: Çıktı sekmesinde kağıt haritanın üstünde -------------------------------------------
// Kenar boşlukları, başlık, lejant, kuzey oku, ölçek ve sayfaya eklenenler ekran çözünürlüğünde çizilir;
// harita alanı saydamdır, altında gerçek harita görünür. Öğeler burada da sürüklenir ve büyütülür.
// Leaflet bölmesinde durur; harita kaydıkça yeri güncellenir, yakınlaşınca yeniden çizilir.

harita.createPane("ciktiSayfa").style.zIndex = 485;
const canli = { kap: L.DomUtil.create("div", "canli-sayfa leaflet-zoom-hide", harita.getPane("ciktiSayfa")), kutular: [], sayfa: null, surum: 0, zamanlayici: 0, surukle: null };
canli.kap.hidden = true;
L.DomEvent.disableClickPropagation(canli.kap);
L.DomEvent.disableScrollPropagation(canli.kap);

const canliAcik = () => ciktiSekmesinde() && cikti.canli && !!cerceveSiniri() && durum.mod !== "cikti-sec";

// Sayfanın haritadaki yeri (katman pikseli): kağıtta çerçeve + kenar boşlukları, serbest alanda çerçevenin kendisi.
function canliKonumla() {
  // Sayfanın kendi lejantı var; haritadaki lejant kutusu bu sırada gizlenir.
  document.body.classList.toggle("cikti-sayfasi", canliAcik());
  if (!canliAcik()) { canli.kap.hidden = true; canliNumaralar(false); return; }
  if (!canli.sayfa) return;
  const s = cerceveSiniri(), ust = harita.latLngToLayerPoint(s.getNorthWest()), alt = harita.latLngToLayerPoint(s.getSouthEast());
  let x = ust.x, y = ust.y, en = alt.x - ust.x, boy = alt.y - ust.y;
  if (cikti.sablon !== "serbest") {
    const d = kagitDuzeni(), pxmm = en / d.harita.en;
    [x, y, en, boy] = [x - d.harita.x * pxmm, y - d.harita.y * pxmm, d.en * pxmm, d.boy * pxmm];
  }
  Object.assign(canli.kap.style, { left: `${x}px`, top: `${y}px`, width: `${en}px`, height: `${boy}px` });
  canli.kap.hidden = false;
}

async function canliCiz() {
  const surum = ++canli.surum;
  if (!canliAcik()) { canli.kap.hidden = true; return; }
  if (canli.surukle) return; // sürükleme bitince çizilir
  try {
    const { tuval, kutular, sayfa } = await sayfaCiz({ canli: true });
    if (surum !== canli.surum || canli.surukle) return;
    Object.assign(canli, { kutular, sayfa });
    kutulariYerlestir(canli.kap, tuval, kutular, sayfa);
    canliKonumla();
    canliNumaralar(true);
  } catch (e) { canli.kap.hidden = true; canliNumaralar(false); }
}

// Canlı sayfa ada/parsel numaralarını kendisi çizer; çerçevedeki parsellerin haritadaki numarası o sırada gizlenir.
function canliNumaralar(acik) {
  const s = acik && parselNo.acik ? cerceveSiniri() : null;
  if (!s && !canli.numaraGizli) return;
  canli.numaraGizli = !!s;
  parselNo.isaretler.forEach((m) => m.getElement()?.classList.toggle("ciktida", !!s && s.contains(m.getLatLng())));
}
document.addEventListener("parseller", () => { if (ciktiSekmesinde()) canliZamanla(); });
$("parselNoGoster").addEventListener("change", () => canliZamanla());

function canliZamanla() {
  clearTimeout(canli.zamanlayici);
  canli.zamanlayici = setTimeout(canliCiz, 150);
}

duzenleyiciBagla(canli.kap, canli, canliZamanla);

ciktiPaneliDoldur();
cerceveCiz();
