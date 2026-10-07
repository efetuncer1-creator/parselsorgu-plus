"use strict";

// ---- yardımcılar ---------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trKucuk = (s) => String(s ?? "").replace(/I/g, "ı").replace(/İ/g, "i").toLocaleLowerCase("tr");
const sayi = (n, basamak = 0) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: basamak, maximumFractionDigits: basamak });
const alanMetni = (m2) => `${sayi(m2)} m² · ${sayi(m2 / 1000, 1)} dönüm`;

function mesaj(metin, hata = false) {
  const el = document.createElement("div");
  el.className = "mesaj" + (hata ? " hata" : "");
  el.textContent = metin;
  $("mesajlar").append(el);
  setTimeout(() => el.remove(), hata ? 8000 : 4000);
}

async function api(yol, secenek = {}) {
  const r = await fetch("/api/" + yol, secenek);
  const tur = r.headers.get("Content-Type") || "";
  if (!tur.includes("application/json")) {
    if (!r.ok) throw new Error(`Sunucu hatası (${r.status})`);
    return r;
  }
  const veri = await r.json();
  if (!r.ok) throw Object.assign(new Error(veri.hata || `Sunucu hatası (${r.status})`), { durum: r.status });
  return veri;
}

// Tarayıcının prompt/confirm kutuları gömülü tarayıcılarda gösterilmeyip "iptal" sayılabiliyor;
// bu yüzden uygulama içi pencere kullanılır. Dönüş: onayla -> true/false, adSor -> metin ya da null.
function diyalogAc(metin, { girdi = null, tamam = "Tamam" } = {}) {
  const d = $("diyalog");
  $("diyalogMetin").textContent = metin;
  $("diyalogTamam").textContent = tamam;
  const kutu = $("diyalogGirdi");
  kutu.hidden = girdi === null;
  kutu.value = girdi ?? "";
  d.returnValue = "";
  d.showModal();
  if (girdi !== null) kutu.select();
  return new Promise((coz) => d.addEventListener("close", () => coz(d.returnValue === "tamam"), { once: true }));
}
const onayla = (metin, tamam = "Tamam") => diyalogAc(metin, { tamam });
async function adSor(metin, varsayilan) {
  return (await diyalogAc(metin, { girdi: varsayilan, tamam: "Kaydet" })) ? $("diyalogGirdi").value : null;
}

const postJson = (yol, govde) =>
  api(yol, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde) });

async function indir(govde) {
  const r = await postJson("disa-aktar", govde);
  const ad = decodeURIComponent((r.headers.get("Content-Disposition") || "").split("''")[1] || "parseller");
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: ad });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  mesaj(`${ad} indirildi.`);
}

// ---- durum ---------------------------------------------------------------------

const durum = {
  parseller: new Map(), // key -> feature
  secili: new Set(),
  katmanlar: new Map(), // key -> Leaflet katmanı
  aktif: null,
  mod: null, // null | "sorgu" (haritadan parsel sorgu) | "cizim" (alan çizimi)
};

const oturumKeys = () => [...durum.parseller.keys()];

// ---- harita --------------------------------------------------------------------

const harita = L.map("harita", { zoomControl: true, doubleClickZoom: true }).setView([39.0, 35.0], 6);
const altlik = {
  Uydu: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 21, maxNativeZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics",
  }),
  OpenStreetMap: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 21, maxNativeZoom: 19, attribution: "© OpenStreetMap",
  }),
  // TKGM karoları TMS düzeninde (y ters). TKGM bunları kendi sitesi dışına kapatmış (CORP), çoğunlukla yüklenmez.
  "TKGM Ortofoto": L.tileLayer("https://ortofotoapi{s}.tkgm.gov.tr/api/tms/1.0.0/TKGM:ortofoto_3857/{z}/{x}/{y}.png", {
    subdomains: "0123", maxZoom: 21, maxNativeZoom: 19, tms: true, attribution: "© TKGM",
  }),
};
altlik.Uydu.addTo(harita);
L.control.layers(altlik).addTo(harita);
// Referanslar ve boşluklar parsellerin altında çizilir ve tıklamayı engellemez.
harita.createPane("referans").style.zIndex = 350;
harita.createPane("bosluk").style.zIndex = 360;
const parselKatmani = L.featureGroup().addTo(harita);

const STIL = { color: "#d7263d", weight: 2, fillOpacity: 0.08 };
const STIL_SECILI = { color: "#f2b705", weight: 3, fillOpacity: 0.25 };

function stilUygula(key) {
  const k = durum.katmanlar.get(key);
  if (k) k.setStyle(durum.secili.has(key) ? STIL_SECILI : STIL);
}

function imlecGuncelle() {
  harita.getContainer().style.cursor = durum.mod ? "crosshair" : "";
}

function bilgiTablosu(p) {
  const satirlar = [
    ["İl", p.il], ["İlçe", p.ilce], ["Mahalle", p.mahalle], ["Ada / Parsel", `${p.ada} / ${p.parsel}`],
    ["Tapu alanı", p.alan ? `${p.alan} m²` : ""], ["Nitelik", p.nitelik], ["Mevkii", p.mevkii],
    ["Pafta", p.pafta], ["Kaynak", p.kaynak === "tkgm" ? "TKGM" : p.kaynak.replace(/^dosya:/, "")],
    ["Veri tarihi", (p.kaynak_tarih || "").slice(0, 10)],
  ];
  return `<table class="bilgi-tablo">${satirlar.map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join("")}</table>`;
}

function katmanEkle(f) {
  const key = f.properties.key;
  durum.katmanlar.get(key)?.remove();
  const k = L.geoJSON(f, { style: STIL });
  k.on("click", (e) => {
    if (durum.mod) return; // sorgu/çizim modunda tıklama haritaya gider
    L.DomEvent.stopPropagation(e);
    seciliDegistir(key);
    aktifYap(key, false);
  });
  k.addTo(parselKatmani);
  durum.katmanlar.set(key, k);
  stilUygula(key);
}

// ---- parsel menüsü: aktif parselin üstünde "⋯", tıklanınca bilgi kartı ----

let menuIsareti = null;

// Halka içinde mi (ışın yöntemi); halka = [[boylam, enlem], ...]
function halkaIcinde(lng, lat, halka) {
  let ic = false;
  for (let i = 0, j = halka.length - 1; i < halka.length; j = i++) {
    const [xi, yi] = halka[i], [xj, yj] = halka[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
}

function poligonIcinde(lng, lat, pol) {
  return halkaIcinde(lng, lat, pol[0]) && !pol.slice(1).some((h) => halkaIcinde(lng, lat, h));
}

// Düğmenin konacağı nokta: sınır kutusunun ortası parselin içindeyse o, değilse içeride kalan ilk ızgara noktası.
function icNokta(f) {
  const pol = f.geometry.coordinates.reduce((a, b) => (b[0].length > a[0].length ? b : a));
  const xs = pol[0].map((p) => p[0]), ys = pol[0].map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const orta = [(x0 + x1) / 2, (y0 + y1) / 2];
  if (poligonIcinde(orta[0], orta[1], pol)) return L.latLng(orta[1], orta[0]);
  for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
    const x = x0 + ((x1 - x0) * i) / 10, y = y0 + ((y1 - y0) * j) / 10;
    if (poligonIcinde(x, y, pol)) return L.latLng(y, x);
  }
  return L.latLng(orta[1], orta[0]);
}

function menuGoster(key) {
  menuIsareti?.remove();
  menuIsareti = null;
  harita.closePopup();
  const f = durum.parseller.get(key);
  if (!f) return;
  const p = f.properties;
  menuIsareti = L.marker(icNokta(f), {
    icon: L.divIcon({
      className: "parsel-menu-ikon",
      html: `<button type="button" class="parsel-menu" title="Parsel bilgisi" aria-label="${esc(p.ada)}/${esc(p.parsel)} bilgisi">⋯</button>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
    keyboard: false,
  }).addTo(harita);
  menuIsareti.bindPopup(() => bilgiTablosu(p), { offset: [0, -10] });
}

// ---- sekmeler ------------------------------------------------------------------

function sekmeAc(ad) {
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sekme === ad));
  $("panel-parsel").hidden = ad !== "parsel";
  $("panel-alan").hidden = ad !== "alan";
  if (ad !== "parsel" && durum.mod === "sorgu") sorguModu(false);
  if (ad !== "alan" && durum.mod === "cizim") cizimIptal();
  if (ad === "alan" && aktifAlan) ozetYukle();
  try { localStorage.setItem("sekme", ad); } catch { /* tercih saklanamazsa önemli değil */ }
}

document.querySelectorAll("[role=tab]").forEach((b) => b.addEventListener("click", () => sekmeAc(b.dataset.sekme)));

// ---- parsel listesi --------------------------------------------------------------

function gorunenler() {
  const q = trKucuk($("filtre").value.trim());
  const hepsi = [...durum.parseller.values()];
  if (!q) return hepsi;
  return hepsi.filter((f) => {
    const p = f.properties;
    return trKucuk(`${p.il} ${p.ilce} ${p.mahalle} ${p.ada}/${p.parsel} ${p.nitelik} ${p.mevkii}`).includes(q);
  });
}

function listeCiz() {
  const ul = $("liste");
  const liste = gorunenler();
  $("adet").textContent = durum.parseller.size;
  $("seciliAdet").textContent = durum.secili.size ? `${durum.secili.size} seçili` : "";
  $("disaButon").textContent = durum.secili.size ? `Seçilenleri dışa aktar (${durum.secili.size})` : "Seçilenleri dışa aktar";
  if (!liste.length) {
    ul.innerHTML = `<li class="bos">${durum.parseller.size ? "Eşleşen parsel yok" : "Henüz parsel yok. Sorgula ya da dosya içe aktar."}</li>`;
    return;
  }
  ul.innerHTML = liste.map((f) => {
    const p = f.properties;
    return `<li data-key="${esc(p.key)}" class="${durum.aktif === p.key ? "aktif" : ""}">
      <input type="checkbox" ${durum.secili.has(p.key) ? "checked" : ""} aria-label="Seç">
      <div><div class="ad">${esc(p.mahalle)} ${esc(p.ada)}/${esc(p.parsel)}</div>
      <div class="alt">${esc(p.il)} / ${esc(p.ilce)} · ${esc(p.alan || "?")} m² · ${esc(p.nitelik || "")}</div></div></li>`;
  }).join("");
}

function seciliDegistir(key, deger) {
  const sec = deger ?? !durum.secili.has(key);
  sec ? durum.secili.add(key) : durum.secili.delete(key);
  stilUygula(key);
  listeCiz();
}

function aktifYap(key, yaklas = true) {
  durum.aktif = key;
  const k = durum.katmanlar.get(key);
  if (k && yaklas) harita.fitBounds(k.getBounds(), { maxZoom: 18, padding: [40, 40] });
  menuGoster(key);
  listeCiz();
}

$("liste").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-key]");
  if (!li) return;
  const key = li.dataset.key;
  if (e.target.matches("input[type=checkbox]")) seciliDegistir(key, e.target.checked);
  else aktifYap(key);
});
$("filtre").addEventListener("input", listeCiz);
$("tumunuSec").addEventListener("click", () => {
  gorunenler().forEach((f) => { durum.secili.add(f.properties.key); stilUygula(f.properties.key); });
  listeCiz();
});
$("secimiKaldir").addEventListener("click", () => {
  const eski = [...durum.secili];
  durum.secili.clear();
  eski.forEach(stilUygula);
  listeCiz();
});
// Sadece bu oturumun listesinden çıkarır; önbellekte kalır, tekrar sorgulanınca sorgu harcamaz.
$("seciliSil").addEventListener("click", () => {
  const keys = [...durum.secili];
  if (!keys.length) return mesaj("Listeden çıkarılacak parsel seçilmedi.", true);
  keys.forEach((k) => { durum.katmanlar.get(k)?.remove(); durum.katmanlar.delete(k); durum.parseller.delete(k); });
  if (keys.includes(durum.aktif)) { durum.aktif = null; menuGoster(null); }
  durum.secili.clear();
  listeCiz();
  if (aktifAlan) ozetYukle();
  mesaj(`${keys.length} parsel listeden çıkarıldı.`);
});

// ---- veri yükleme --------------------------------------------------------------

// Verilen parselleri (önbellekten) bu oturumun listesine ekler.
async function oturumaEkle(keys, sigdir = true) {
  if (!keys.length) return [];
  const fc = await postJson("parseller/getir", { keys });
  fc.features.forEach((f) => { durum.parseller.set(f.properties.key, f); katmanEkle(f); });
  listeCiz();
  if (sigdir && fc.features.length) harita.fitBounds(L.geoJSON(fc).getBounds(), { padding: [20, 20] });
  return fc.features;
}

function parselEkle(f, tkgmden, { yaklas = true, sessiz = false } = {}) {
  durum.parseller.set(f.properties.key, f);
  katmanEkle(f);
  seciliDegistir(f.properties.key, true);
  if (yaklas) aktifYap(f.properties.key);
  if (!sessiz) {
    mesaj(tkgmden ? `${f.properties.ada}/${f.properties.parsel} TKGM'den alındı.`
                  : `${f.properties.ada}/${f.properties.parsel} kayıttan getirildi (sorgu harcanmadı).`);
  }
}

async function sayacGuncelle() {
  try {
    const s = await api("sayac");
    $("sayac").textContent = `TKGM sorgusu bugün: ${s.toplam}` + (s.limit_hatasi ? " · limit doldu" : "");
    $("sayac").classList.toggle("uyari", s.limit_hatasi > 0);
  } catch { /* sayaç önemli değil */ }
}

// ---- idari listeler ------------------------------------------------------------

function secenekleriDoldur(select, liste, bosMetin) {
  select.innerHTML = `<option value="">${bosMetin}</option>` + liste.map((x) => `<option value="${x.id}">${esc(x.ad)}</option>`).join("");
  select.disabled = false;
}

let illerYuklendi = false;
async function illeriYukle() {
  if (illerYuklendi) return;
  illerYuklendi = true;
  try {
    secenekleriDoldur($("il"), await api("iller"), "İl seç");
  } catch (e) {
    illerYuklendi = false;
    mesaj(e.message, true);
  } finally { sayacGuncelle(); }
}
// İl listesi ilk tıklamada istenir; sayfa açılışında sorgu harcanmasın.
$("il").addEventListener("mousedown", illeriYukle);
$("il").addEventListener("focus", illeriYukle);

$("il").addEventListener("change", async () => {
  $("ilce").disabled = $("mahalle").disabled = true;
  $("ilce").innerHTML = $("mahalle").innerHTML = "";
  if (!$("il").value) return;
  try { secenekleriDoldur($("ilce"), await api("ilceler/" + $("il").value), "İlçe seç"); }
  catch (e) { mesaj(e.message, true); } finally { sayacGuncelle(); }
});
$("ilce").addEventListener("change", async () => {
  $("mahalle").disabled = true;
  $("mahalle").innerHTML = "";
  if (!$("ilce").value) return;
  try { secenekleriDoldur($("mahalle"), await api("mahalleler/" + $("ilce").value), "Mahalle seç"); }
  catch (e) { mesaj(e.message, true); } finally { sayacGuncelle(); }
});

// ---- sorgu ---------------------------------------------------------------------

$("sorguForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const buton = e.submitter;
  buton.disabled = true;
  try {
    const r = await postJson("sorgu", {
      mahalleId: Number($("mahalle").value), ada: $("ada").value.trim(), parsel: $("parsel").value.trim(),
      yenile: $("yenile").checked,
    });
    parselEkle(r.parsel, r.tkgmdenGeldi);
  } catch (err) { mesaj(err.message, true); }
  finally { buton.disabled = false; sayacGuncelle(); }
});

function sorguModu(acik) {
  if (acik && durum.mod === "cizim") cizimIptal();
  durum.mod = acik ? "sorgu" : null;
  $("haritaModu").setAttribute("aria-pressed", acik);
  imlecGuncelle();
  if (acik) mesaj("Haritada parsele tıkla. Daha önce sorgulanmış bir parselse sorgu harcanmaz.");
}
$("haritaModu").addEventListener("click", () => sorguModu(durum.mod !== "sorgu"));

harita.on("click", async (e) => {
  if (durum.mod === "cizim") return cizimPinEkle(e.latlng);
  if (durum.mod !== "sorgu") return;
  try {
    const r = await postJson("sorgu-nokta", { enlem: e.latlng.lat, boylam: e.latlng.lng, yenile: $("yenile").checked });
    parselEkle(r.parsel, r.tkgmdenGeldi);
  } catch (err) { mesaj(err.message, true); }
  finally { sayacGuncelle(); }
});

// ---- dışa aktar (parsel sekmesi) -----------------------------------------------

const bicim = () => document.querySelector("input[name=bicim]:checked").value;
document.querySelectorAll("input[name=bicim]").forEach((r) => r.addEventListener("change", () => {
  document.querySelectorAll("[data-bicim]").forEach((el) => { el.hidden = el.dataset.bicim !== bicim(); });
}));

$("disaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const keys = [...durum.secili];
  if (!keys.length) return mesaj("Önce listeden ya da haritadan parsel seç.", true);
  const buton = $("disaButon");
  buton.disabled = true;
  try {
    await indir({ keys, bicim: bicim(), ayriDosyalar: $("ayriDosyalar").checked, sistem: $("sistem").value, dilim: $("dilim").value });
  } catch (err) { mesaj(err.message, true); }
  finally { buton.disabled = false; }
});

// ---- içe aktar -----------------------------------------------------------------

async function dosyalariAktar(dosyalar) {
  const tum = [...dosyalar];
  // KMZ parsel dosyası olmaz; doğrudan alan (referans) olarak eklenir.
  const kmzler = tum.filter((f) => /\.kmz$/i.test(f.name));
  if (kmzler.length) await referansEkle(kmzler);
  const uygun = tum.filter((f) => /\.(kml|json|geojson)$/i.test(f.name));
  if (!uygun.length && kmzler.length) return;
  if (!uygun.length) return mesaj("KML ya da JSON dosyası bulunamadı.", true);
  const toplam = { yeni: 0, guncellendi: 0, atlandi: 0 };
  let hata = 0;
  const bosDosyalar = [];
  const keys = new Set();
  for (const f of uygun) {
    try {
      const r = await api("ice-aktar", {
        method: "POST",
        headers: {
          "X-Dosya-Adi": encodeURIComponent(f.name),
          "X-Dosya-Tarih": new Date(f.lastModified).toISOString().slice(0, 19),
        },
        body: f,
      });
      for (const k in toplam) toplam[k] += r[k];
      r.keys.forEach((k) => keys.add(k));
      if (!r.keys.length) bosDosyalar.push(f);
    } catch (e) { hata++; mesaj(e.message, true); }
  }
  const onceki = durum.parseller.size;
  await oturumaEkle([...keys]);
  if (aktifAlan) ozetYukle();
  if (keys.size) mesaj(`${uygun.length - hata - bosDosyalar.length} dosyadan ${keys.size} parsel listeye eklendi (${durum.parseller.size - onceki} yeni).`);
  if (bosDosyalar.length) {
    const adlar = bosDosyalar.map((f) => f.name).join(", ");
    if (await onayla(`${adlar} içinde parsel bilgisi yok. Sınır, plan ya da proje dosyasıysa "Alandan tespit" sayfasına alan olarak eklensin mi?`, "Alan olarak ekle")) {
      await referansEkle(bosDosyalar);
      sekmeAc("alan");
    }
  }
}

$("dosyaSec").addEventListener("change", (e) => { dosyalariAktar(e.target.files); e.target.value = ""; });
$("klasorSec").addEventListener("change", (e) => { dosyalariAktar(e.target.files); e.target.value = ""; });

let surukle = 0;
window.addEventListener("dragenter", (e) => { e.preventDefault(); surukle++; $("birak").hidden = false; });
window.addEventListener("dragleave", () => { if (--surukle <= 0) { surukle = 0; $("birak").hidden = true; } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  surukle = 0;
  $("birak").hidden = true;
  // Alan sekmesindeyken bırakılan dosyalar alan olarak eklenir.
  if (!$("panel-alan").hidden) referansEkle([...e.dataTransfer.files]);
  else dosyalariAktar(e.dataTransfer.files);
});

// ================================================================================
// Alandan parsel tespiti
// ================================================================================

const referanslar = new Map(); // id -> { veri, katman }
let aktifAlan = null; // referans id
let sonOzet = null;

const katmanAdi = (f) => (f.properties && f.properties.katman) || "";

function referansKatmani(r) {
  const gizli = new Set(r.gizli || []);
  const aktif = r.id === aktifAlan;
  const hesap = r.hesap_katmani;
  return L.geoJSON(r.geojson, {
    pane: "referans",
    interactive: false,
    // Sınır katmanı gizli olsa da çizilir: hesap ona göre yapılıyor, görünmesi gerekir.
    filter: (f) => !gizli.has(katmanAdi(f)) || katmanAdi(f) === hesap,
    style: (f) => {
      const sinir = hesap == null || katmanAdi(f) === hesap;
      return sinir
        ? { color: r.renk, weight: aktif ? 4 : 3, dashArray: "8 6", fillColor: r.renk, fillOpacity: aktif ? 0.16 : 0.08 }
        : { color: r.renk, weight: 1, opacity: 0.7, fillOpacity: 0 };
    },
    pointToLayer: (_, latlng) => L.circleMarker(latlng, { pane: "referans", radius: 5, color: r.renk, fillOpacity: 0.8, interactive: false }),
  });
}

function referansCiz(r) {
  referanslar.get(r.id)?.katman.remove();
  const katman = referansKatmani(r);
  if (r.gorunur) katman.addTo(harita);
  referanslar.set(r.id, { veri: r, katman });
}

function katmanListesi(r) {
  const sayac = new Map();
  r.geojson.features.forEach((f) => sayac.set(katmanAdi(f), (sayac.get(katmanAdi(f)) || 0) + 1));
  if (sayac.size < 2) return "";
  const gizli = new Set(r.gizli || []);
  const satirlar = [...sayac].map(([ad, n]) => `
        <label class="katman"><input type="checkbox" data-is="katman" data-katman="${esc(ad)}" ${gizli.has(ad) ? "" : "checked"}>
          <span>${esc(ad || "(klasörsüz)")}</span><span class="soluk">${n}</span></label>`).join("");
  return `<details class="katmanlar"><summary>Katmanlar (${sayac.size - gizli.size}/${sayac.size} açık)</summary>${satirlar}</details>`;
}

function referansListeCiz() {
  $("alanYok").hidden = referanslar.size > 0;
  $("referansListe").innerHTML = [...referanslar.values()].map(({ veri: r }) => `
    <li data-id="${r.id}" class="${r.id === aktifAlan ? "aktif" : ""}">
      <div class="ref-ust">
        <input type="checkbox" data-is="gorunur" ${r.gorunur ? "checked" : ""} title="Haritada göster/gizle" aria-label="Görünür">
        <input type="color" data-is="renk" value="${esc(r.renk)}" title="Renk" aria-label="Renk">
        <button type="button" class="ad" data-is="sec" title="Bu alanla çalış">${esc(r.ad)}</button>
        <button type="button" class="sil" data-is="sil" title="Alanı kaldır" aria-label="Kaldır">×</button>
      </div>
      ${katmanListesi(r)}
    </li>`).join("");
}

function alanaYaklas(id) {
  const ref = referanslar.get(id);
  if (!ref) return;
  // Sınır katmanı seçiliyse ona yaklaş; pafta indeksi gibi büyük katmanlar haritayı uzaklaştırmasın.
  const hesap = ref.veri.hesap_katmani;
  const fc = hesap == null ? ref.veri.geojson
    : { type: "FeatureCollection", features: ref.veri.geojson.features.filter((f) => katmanAdi(f) === hesap) };
  const b = L.geoJSON(fc).getBounds();
  if (b.isValid()) harita.fitBounds(b, { padding: [30, 30] });
}

function alanSec(id, yaklas = true) {
  const onceki = aktifAlan;
  aktifAlan = id;
  for (const k of [onceki, id]) if (k && referanslar.has(k)) referansCiz(referanslar.get(k).veri);
  referansListeCiz();
  bosluklariTemizle();
  $("alanDetay").hidden = !id;
  if (!id) return;
  $("alanBaslik").textContent = referanslar.get(id).veri.ad;
  sinirSecimiDoldur(referanslar.get(id).veri);
  if (yaklas) alanaYaklas(id);
  ozetYukle();
}

const ALANLI = new Set(["Polygon", "MultiPolygon", "LineString", "MultiLineString"]);

function sinirSecimiDoldur(r) {
  const katmanlar = [...new Set(r.geojson.features.filter((f) => ALANLI.has(f.geometry.type)).map(katmanAdi))];
  const sec = $("hesapKatmani");
  $("hesapKatmani").closest("label").hidden = katmanlar.length < 2 && !r.hesap_katmani;
  sec.innerHTML = `<option value="*">Tüm açık katmanlar</option>` +
    katmanlar.map((k) => `<option value="${esc(k)}">${esc(k || "(klasörsüz)")}</option>`).join("");
  sec.value = r.hesap_katmani ?? "*";
}

$("hesapKatmani").addEventListener("change", async (e) => {
  if (!aktifAlan) return;
  try {
    const r = await postJson(`referanslar/${aktifAlan}/guncelle`, { hesapKatmani: e.target.value });
    referansCiz(r);
    bosluklariTemizle();
    await ozetYukle();
  } catch (err) { mesaj(err.message, true); }
});

async function referansEkle(dosyalar) {
  let son = null;
  for (const f of dosyalar) {
    try {
      const r = await api("referanslar", { method: "POST", headers: { "X-Dosya-Adi": encodeURIComponent(f.name) }, body: f });
      referansCiz(r);
      son = r.id;
      mesaj(r.hesap_katmani
        ? `"${r.ad}" eklendi. Alan sınırı olarak "${r.hesap_katmani}" katmanı seçildi; gerekirse değiştirebilirsin.`
        : `"${r.ad}" alan olarak eklendi.`);
    } catch (e) { mesaj(e.message, true); }
  }
  referansListeCiz();
  if (son) alanSec(son);
}

$("referansSec").addEventListener("change", (e) => { referansEkle([...e.target.files]); e.target.value = ""; });

$("referansListe").addEventListener("change", async (e) => {
  const id = Number(e.target.closest("li")?.dataset.id);
  const is = e.target.dataset.is;
  if (!id || !["gorunur", "renk", "katman"].includes(is)) return;
  let govde;
  if (is === "katman") {
    const li = e.target.closest("li");
    govde = { gizli: [...li.querySelectorAll("input[data-is=katman]:not(:checked)")].map((x) => x.dataset.katman) };
  } else govde = is === "gorunur" ? { gorunur: e.target.checked } : { renk: e.target.value };
  try {
    referansCiz(await postJson(`referanslar/${id}/guncelle`, govde));
    // Katman özetini (açık/toplam) güncelle ama açık olan katman listesini kapatma
    const acik = e.target.closest("details")?.open;
    referansListeCiz();
    if (acik) document.querySelector(`#referansListe li[data-id="${id}"] details`).open = true;
    if (is === "katman" && id === aktifAlan) ozetYukle();
  } catch (err) { mesaj(err.message, true); }
});

$("referansListe").addEventListener("click", async (e) => {
  const buton = e.target.closest("button[data-is]");
  if (!buton) return;
  const id = Number(buton.closest("li").dataset.id);
  const ref = referanslar.get(id);
  if (buton.dataset.is === "sec") return id === aktifAlan ? alanaYaklas(id) : alanSec(id);
  if (buton.dataset.is !== "sil") return;
  if (!(await onayla(`"${ref.veri.ad}" alanı kaldırılsın mı? Dosyanın kendisi silinmez, parseller listede kalır.`, "Kaldır"))) return;
  try {
    await postJson(`referanslar/${id}/sil`, {});
    ref.katman.remove();
    referanslar.delete(id);
    if (id === aktifAlan) alanSec(null);
    else referansListeCiz();
  } catch (err) { mesaj(err.message, true); }
});

// ---- alan özeti ------------------------------------------------------------------

async function ozetYukle() {
  const id = aktifAlan;
  if (!id) return;
  try {
    const o = await postJson(`referanslar/${id}/ozet`, { keys: oturumKeys() });
    if (id !== aktifAlan) return;
    sonOzet = o;
    ozetCiz(o);
    if ($("bosluklariGoster").getAttribute("aria-pressed") === "true") bosluklariCiz();
  } catch (e) {
    sonOzet = null;
    $("ozet").innerHTML = `<p class="hata-metin">${esc(e.message)}</p>`;
  }
}

function ozetCiz(o) {
  const yuzde = Math.round(o.kaplanan_oran * 1000) / 10;
  const enCok = Math.max(1, ...o.nitelikler.map((n) => n.alan_ici_m2));
  const nitelikler = o.nitelikler.slice(0, 6).map((n) => `
      <li><span class="n-ad">${esc(n.nitelik)}</span><span class="n-cubuk"><i style="width:${(100 * n.alan_ici_m2) / enCok}%"></i></span>
      <span class="n-deger">${n.adet} · ${sayi(n.alan_ici_m2)} m²</span></li>`).join("");
  const taranan = referanslar.get(aktifAlan)?.veri.taranan?.length || 0;
  $("ozet").innerHTML = `
    <div class="ozet-alan">${alanMetni(o.alan_m2)}</div>
    <div class="ozet-izgara">
      <div><b>${o.icinde.adet}</b><span>parsel tamamen içinde</span><small>${sayi(o.icinde.tapu_m2)} m² tapu</small></div>
      <div><b>${o.kesisen.adet}</b><span>parsel kesişiyor</span><small>${sayi(o.kesisen.alan_ici_m2)} m² alan içinde</small></div>
    </div>
    <div class="kaplama" title="Alanın kayıtlı parsellerle kaplanan kısmı">
      <div class="kaplama-ust"><span>Kayıtlı parsellerle kaplı</span><b>%${sayi(yuzde, 1)}</b></div>
      <div class="kaplama-cubuk"><i style="width:${Math.min(100, yuzde)}%"></i></div>
      <small>${o.bosluk.adet ? `${o.bosluk.adet} boşluk · ${sayi(o.bosluk.m2)} m² henüz sorgulanmamış` : "Sorgulanmaya değer boşluk yok"}${taranan ? ` · ${taranan} boş nokta işaretli` : ""}</small>
    </div>
    ${nitelikler ? `<ul class="nitelikler">${nitelikler}</ul>` : ""}`;
  $("taramaSifirla").hidden = !taranan;
}

$("ozetYenile").addEventListener("click", ozetYukle);

$("alanDetay").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sec]");
  if (!b || !sonOzet) return;
  const keys = sonOzet[b.dataset.sec].keys;
  keys.forEach((k) => { durum.secili.add(k); stilUygula(k); });
  listeCiz();
  const ne = b.dataset.sec === "icinde" ? "tamamen içinde kalan" : "alanla kesişen";
  mesaj(keys.length ? `${ne} ${keys.length} parsel seçildi.`
                    : `Bu alanda ${ne} kayıtlı parsel yok. Boşlukları tarayabilir ya da parsel içe aktarabilirsin.`, !keys.length);
});

// ---- boşluklar --------------------------------------------------------------------

let bosluKatmani = null;

function bosluklariTemizle() {
  bosluKatmani?.remove();
  bosluKatmani = null;
}

function bosluklariCiz() {
  bosluklariTemizle();
  if (!sonOzet) return;
  const grup = L.featureGroup();
  L.geoJSON(sonOzet.bosluk.geojson, {
    pane: "bosluk", interactive: false,
    style: { color: "#ff7a00", weight: 2, dashArray: "4 4", fillColor: "#ff7a00", fillOpacity: 0.35 },
  }).addTo(grup);
  for (const [lon, lat, r] of referanslar.get(aktifAlan)?.veri.taranan || []) {
    L.circle([lat, lon], { radius: r, pane: "bosluk", interactive: false, color: "#8a8f8c", weight: 1, dashArray: "2 3", fillOpacity: 0.25 }).addTo(grup);
  }
  bosluKatmani = grup.addTo(harita);
}

$("bosluklariGoster").addEventListener("click", (e) => {
  const acik = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", acik);
  acik ? bosluklariCiz() : bosluklariTemizle();
});

// ---- boşluk tarama ------------------------------------------------------------------

const tarama = { calisiyor: false, dur: false };

function taramaDurumYaz(metin) {
  $("taramaDurum").hidden = false;
  $("taramaDurum").textContent = metin;
}

async function referansTazele(id) {
  const r = (await api("referanslar")).find((x) => x.id === id);
  if (r) referansCiz(r);
}

$("taramaBasla").addEventListener("click", async () => {
  const id = aktifAlan;
  if (!id || tarama.calisiyor) return;
  const butce = Math.max(1, Math.min(200, Number($("taramaButce").value) || 10));
  tarama.calisiyor = true;
  tarama.dur = false;
  $("taramaBasla").hidden = true;
  $("taramaDur").hidden = false;
  $("bosluklariGoster").setAttribute("aria-pressed", "true");
  let harcanan = 0, bulunan = 0, bos = 0, adim = 0, son = "";
  try {
    while (harcanan < butce && !tarama.dur && adim < butce * 3) {
      adim++;
      taramaDurumYaz(`Taranıyor… ${harcanan}/${butce} sorgu · ${bulunan} parsel bulundu · ${bos} boş nokta`);
      const r = await postJson(`referanslar/${id}/tara`, { keys: oturumKeys() });
      if (r.sorgu) harcanan++;
      if (r.durum === "bitti") { son = "Sorgulanmaya değer boşluk kalmadı."; break; }
      if (r.durum === "bulundu") { bulunan++; parselEkle(r.parsel, r.sorgu, { yaklas: false, sessiz: true }); }
      else bos++;
      await referansTazele(id);
      await ozetYukle();
      sayacGuncelle();
    }
    if (!son) son = tarama.dur ? "Durduruldu." : `${butce} sorgu sınırına ulaşıldı.`;
  } catch (e) {
    son = e.durum === 429 ? "TKGM günlük limiti doldu, tarama durdu." : `Hata: ${e.message}`;
    mesaj(son, true);
  } finally {
    tarama.calisiyor = false;
    $("taramaBasla").hidden = false;
    $("taramaDur").hidden = true;
    taramaDurumYaz(`${son} ${harcanan} sorgu harcandı · ${bulunan} parsel eklendi · ${bos} boş nokta işaretlendi.`);
    await ozetYukle();
    sayacGuncelle();
  }
});

$("taramaDur").addEventListener("click", () => { tarama.dur = true; });

$("taramaSifirla").addEventListener("click", async () => {
  if (!aktifAlan || !(await onayla("Parsel çıkmadığı için işaretlenen noktalar sıfırlansın mı? Sonraki taramada bu noktalar tekrar sorgulanır.", "Sıfırla"))) return;
  try {
    referansCiz(await postJson(`referanslar/${aktifAlan}/tarama-sifirla`, {}));
    await ozetYukle();
  } catch (e) { mesaj(e.message, true); }
});

// ---- alan dışa aktarma ------------------------------------------------------------

$("alanDetay").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-alan-disa]");
  if (!b || !aktifAlan) return;
  if (!sonOzet) return mesaj("Alan özeti hesaplanamadı.", true);
  const kapsam = document.querySelector("input[name=alanKapsam]:checked").value;
  const keys = sonOzet[kapsam].keys;
  if (!keys.length) return mesaj("Bu alanda dışa aktarılacak kayıtlı parsel yok.", true);
  b.disabled = true;
  try {
    await indir({ keys, bicim: b.dataset.alanDisa, referansId: aktifAlan, sistem: $("alanSistem").value, dilim: "otomatik" });
  } catch (err) { mesaj(err.message, true); }
  finally { b.disabled = false; }
});

// ---- elle alan çizimi --------------------------------------------------------------

const cizim = { pinler: [], sekil: null };

function cizimSekliGuncelle() {
  cizim.sekil?.remove();
  const noktalar = cizim.pinler.map((m) => m.getLatLng());
  cizim.sekil = noktalar.length >= 3
    ? L.polygon(noktalar, { color: "#2b7bff", weight: 2, dashArray: "6 4", fillOpacity: 0.12, interactive: false })
    : L.polyline(noktalar, { color: "#2b7bff", weight: 2, dashArray: "6 4", interactive: false });
  cizim.sekil.addTo(harita);
  cizim.pinler.forEach((m, i) => m.setIcon(pinIkonu(i)));
  $("cizimBitir").disabled = noktalar.length < 3;
  $("cizimDurum").textContent = noktalar.length
    ? `${noktalar.length} pin${noktalar.length < 3 ? ` · alan için en az 3 pin gerekir` : " · kapatmak için ilk pine tıkla ya da çift tıkla"}`
    : "Haritaya tıklayarak alanın köşelerine pin koy.";
}

function pinIkonu(i) {
  const kapatilabilir = i === 0 && cizim.pinler.length >= 3;
  return L.divIcon({
    className: "cizim-pin-ikon",
    html: `<span class="cizim-pin${kapatilabilir ? " ilk" : ""}" title="${kapatilabilir ? "Alanı kapat" : `Pin ${i + 1}`}">${i + 1}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function cizimPinEkle(latlng) {
  const pin = L.marker(latlng, { draggable: true, icon: pinIkonu(cizim.pinler.length), keyboard: false });
  pin.on("drag", cizimSekliGuncelle);
  pin.on("click", () => { if (cizim.pinler[0] === pin && cizim.pinler.length >= 3) cizimBitir(); });
  pin.addTo(harita);
  cizim.pinler.push(pin);
  cizimSekliGuncelle();
}

function cizimBasla() {
  if (durum.mod === "sorgu") sorguModu(false);
  cizimTemizle();
  durum.mod = "cizim";
  $("cizimBasla").setAttribute("aria-pressed", "true");
  $("cizimPanel").hidden = false;
  harita.doubleClickZoom.disable(); // pin koyarken çift tıklama yakınlaştırmasın
  imlecGuncelle();
  cizimSekliGuncelle();
}

function cizimTemizle() {
  cizim.pinler.forEach((m) => m.remove());
  cizim.pinler = [];
  cizim.sekil?.remove();
  cizim.sekil = null;
}

function cizimIptal() {
  cizimTemizle();
  if (durum.mod === "cizim") durum.mod = null;
  $("cizimBasla").setAttribute("aria-pressed", "false");
  $("cizimPanel").hidden = true;
  harita.doubleClickZoom.enable();
  imlecGuncelle();
}

function cizimGeriAl() {
  cizim.pinler.pop()?.remove();
  cizimSekliGuncelle();
}

async function cizimBitir() {
  if (cizim.pinler.length < 3) return;
  const varsayilan = `Çizim ${referanslar.size + 1}`;
  const ad = await adSor("Alana bir ad ver:", varsayilan);
  if (ad === null) return; // vazgeçti, çizim sürsün
  try {
    const r = await postJson("referanslar/cizim", {
      ad: ad.trim() || varsayilan,
      noktalar: cizim.pinler.map((m) => [m.getLatLng().lng, m.getLatLng().lat]),
    });
    cizimIptal();
    referansCiz(r);
    alanSec(r.id, false);
    mesaj(`"${r.ad}" alanı oluşturuldu.`);
  } catch (e) { mesaj(e.message, true); }
}

// Çift tıklama alanı kapatır. Çift tıklamanın iki "click"i aynı yere iki pin koymuş olur; onlar geri alınır,
// tıklanan nokta tek pin olarak kalır.
harita.on("dblclick", (e) => {
  if (durum.mod !== "cizim") return;
  const p = harita.latLngToContainerPoint(e.latlng);
  const yakin = (m) => harita.latLngToContainerPoint(m.getLatLng()).distanceTo(p) < 8;
  while (cizim.pinler.length > 1 && yakin(cizim.pinler.at(-1)) && yakin(cizim.pinler.at(-2))) cizimGeriAl();
  if (cizim.pinler.length >= 3) cizimBitir();
});

$("cizimBasla").addEventListener("click", () => (durum.mod === "cizim" ? cizimIptal() : cizimBasla()));
$("cizimGeri").addEventListener("click", cizimGeriAl);
$("cizimBitir").addEventListener("click", cizimBitir);
$("cizimIptal").addEventListener("click", cizimIptal);

document.addEventListener("keydown", (e) => {
  if (durum.mod !== "cizim" || e.target.matches("input, select, textarea")) return;
  if (e.key === "Escape") cizimIptal();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); cizimGeriAl(); }
  else if (e.key === "Enter") cizimBitir();
});

// ---- başlangıç -----------------------------------------------------------------

(() => {
  let sekme = "parsel";
  try { sekme = localStorage.getItem("sekme") || "parsel"; } catch { /* yoksa varsayılan */ }
  sekmeAc(sekme === "alan" ? "alan" : "parsel");
})();
// Sayfa açılışı = yeni oturum: liste ve alanlar boş başlar. Önbellek (daha önce sorgulanan
// parseller, il/ilçe/mahalle listeleri) sunucuda kalır; tekrar sorgulanınca TKGM'ye gidilmez.
postJson("oturum/yeni", {}).catch((e) => mesaj(e.message, true));
listeCiz();
referansListeCiz();
sayacGuncelle();
