"use strict";

// ---- yardımcılar ---------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trKucuk = (s) => String(s ?? "").replace(/I/g, "ı").replace(/İ/g, "i").toLocaleLowerCase("tr");
const sayi = (n, basamak = 0) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: basamak, maximumFractionDigits: basamak });
const alanMetni = (m2) => `${sayi(m2)} m² · ${sayi(m2 / 1000, 1)} dönüm`;
const ikon = (ad, sinif = "ikon") => `<svg class="${sinif}" aria-hidden="true"><use href="#i-${ad}"/></svg>`;
// Renkler tek kaynaktan: style.css'teki token'lar.
const token = (ad) => getComputedStyle(document.documentElement).getPropertyValue(ad).trim();

// hata: true -> hata bildirimi; "basari" -> tamamlanan iş; yoksa bilgi.
function mesaj(metin, hata = false) {
  const tur = hata === true ? "hata" : hata === "basari" ? "basari" : "bilgi";
  if ([...$("mesajlar").children].some((m) => m.textContent === metin && !m.classList.contains("gidiyor"))) return;
  const el = document.createElement("div");
  el.className = `mesaj cam ${tur}`;
  el.setAttribute("role", tur === "hata" ? "alert" : "status");
  el.innerHTML = ikon({ hata: "uyari", basari: "onay", bilgi: "bilgi" }[tur]);
  el.append(Object.assign(document.createElement("span"), { textContent: metin }));
  const kutu = $("mesajlar");
  kutu.append(el);
  while (kutu.children.length > 3) kutu.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add("gidiyor");
    setTimeout(() => el.remove(), 400);
  }, tur === "hata" ? 7000 : 3600);
}

// Uzun süren işlerde düğmenin ikonu dönen yenile ikonuna çevrilir.
function yukleniyor(buton, acik) {
  const use = buton.querySelector("use");
  buton.classList.toggle("yukleniyor", acik);
  buton.disabled = acik;
  if (!use) return;
  if (acik) { buton.dataset.ikon = use.getAttribute("href"); use.setAttribute("href", "#i-yenile"); }
  else if (buton.dataset.ikon) use.setAttribute("href", buton.dataset.ikon);
}

// Bir istek 250 ms'den uzun sürerse markadaki köşe noktası nabız gibi atar (kısa istekler yanıp sönmesin).
let surenIstek = 0, mesgulZamanlayici = null;
function mesgul(degisim) {
  surenIstek += degisim;
  clearTimeout(mesgulZamanlayici);
  if (surenIstek > 0) mesgulZamanlayici = setTimeout(() => $("marka").classList.add("calisiyor"), 250);
  else $("marka").classList.remove("calisiyor");
}

async function api(yol, secenek = {}) {
  mesgul(1);
  try { return await apiIstek(yol, secenek); } finally { mesgul(-1); }
}

async function apiIstek(yol, secenek) {
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
  mesaj(`${ad} indirildi.`, "basari");
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

const harita = L.map("harita", { zoomControl: false, doubleClickZoom: true }).setView([39.0, 35.0], 6);
harita.attributionControl.setPrefix(false);
// Bir seviyede görüntü yoksa (Esri o zaman "Map data not yet available" görseli gönderir;
// blankTile=false ile 404 döner) bir üst seviyedeki karonun ilgili parçası büyütülerek gösterilir.
// Bölgede hangi seviyeye kadar görüntü olduğu öğrenilir (yaklaşık 2,4 km'lik bölgeler); aynı bölgedeki
// sonraki karolar doğrudan çalışan seviyeden istenir, her karo için önce "yok" cevabı beklenmez.
const BOLGE_Z = 14;
const YedekliKaro = L.TileLayer.extend({
  createTile(koord, bitti) {
    const kap = document.createElement("div");
    const img = document.createElement("img");
    img.alt = "";
    img.setAttribute("role", "presentation");
    img.style.cssText = "position:absolute;max-width:none;";
    kap.style.overflow = "hidden";
    kap.append(img);
    const boyut = this.getTileSize().x;
    this._bolgeEnIyi ??= new Map();
    const kayma = Math.max(0, koord.z - BOLGE_Z);
    const bolge = `${koord.x >> kayma}/${koord.y >> kayma}`;
    const bilinen = this._bolgeEnIyi.get(bolge);
    let fark = bilinen != null ? Math.max(0, koord.z - bilinen) : 0;
    img.addEventListener("load", () => {
      if (fark > 0) this._bolgeEnIyi.set(bolge, Math.min(this._bolgeEnIyi.get(bolge) ?? 99, koord.z - fark));
    });
    const yukle = () => {
      const k = 2 ** fark;
      const ust = { x: Math.floor(koord.x / k), y: Math.floor(koord.y / k), z: koord.z - fark };
      img.style.width = img.style.height = `${boyut * k}px`;
      img.style.left = `${-(koord.x % k) * boyut}px`;
      img.style.top = `${-(koord.y % k) * boyut}px`;
      img.src = L.Util.template(this._url, L.extend({ s: this._getSubdomain(ust) }, this.options, ust));
    };
    img.onload = () => bitti(null, kap);
    img.onerror = () => {
      if (fark < 5 && koord.z - fark > 2) { fark++; yukle(); } else bitti(new Error("karo yok"), kap);
    };
    yukle();
    return kap;
  },
});
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const altlik = {
  Uydu: new YedekliKaro(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false`, {
    maxZoom: 21, maxNativeZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics",
  }),
  OpenStreetMap: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 21, maxNativeZoom: 19, attribution: "© OpenStreetMap",
  }),
};
// TKGM ortofotosu kaldırıldı: TKGM karoları kendi sitesi dışına kapatmış, her istekte boş görüntü döndürüyor
// (7 ve 9 Ekim 2026'da doğrulandı).

// Uydu üstüne yer adları, sınırlar ve yollar (OSM'de bunlar zaten var).
harita.createPane("etiket").style.zIndex = 250;
harita.getPane("etiket").style.pointerEvents = "none";
const etiketler = L.layerGroup([
  new YedekliKaro(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}?blankTile=false`, { pane: "etiket", maxZoom: 21, maxNativeZoom: 19, opacity: 0.85 }),
  new YedekliKaro(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}?blankTile=false`, { pane: "etiket", maxZoom: 21, maxNativeZoom: 19 }),
]);
let etiketAcik = true;
try { etiketAcik = localStorage.getItem("etiketler") !== "0"; } catch { /* varsayılan açık */ }

let aktifAltlik = altlik.Uydu.addTo(harita);
function etiketleriGuncelle() {
  const uydu = aktifAltlik === altlik.Uydu;
  $("etiketler").disabled = !uydu;
  $("etiketler").setAttribute("aria-pressed", uydu && etiketAcik);
  if (uydu && etiketAcik) etiketler.addTo(harita); else etiketler.remove();
}
document.querySelectorAll("input[name=altlik]").forEach((r) => r.addEventListener("change", () => {
  aktifAltlik.remove();
  aktifAltlik = altlik[r.value].addTo(harita);
  aktifAltlik.bringToBack();
  etiketleriGuncelle();
}));
$("etiketler").addEventListener("click", () => {
  etiketAcik = !etiketAcik;
  try { localStorage.setItem("etiketler", etiketAcik ? "1" : "0"); } catch { /* tercih saklanamazsa önemli değil */ }
  etiketleriGuncelle();
});
etiketleriGuncelle();
$("yakinlas").addEventListener("click", () => harita.zoomIn());
$("uzaklas").addEventListener("click", () => harita.zoomOut());
$("hepsiniGoster").addEventListener("click", () => {
  const sinirlar = L.latLngBounds([]);
  durum.katmanlar.forEach((k) => sinirlar.extend(k.getBounds()));
  referanslar.forEach(({ veri }) => { if (veri.gorunur) sinirlar.extend(L.geoJSON(sinirFc(veri)).getBounds()); });
  if (sinirlar.isValid()) harita.fitBounds(sinirlar, { padding: [40, 40], maxZoom: 18 });
  else mesaj("Haritada gösterilecek parsel ya da alan yok.");
});
// Referanslar ve boşluklar parsellerin altında çizilir ve tıklamayı engellemez.
harita.createPane("referans").style.zIndex = 350;
harita.createPane("bosluk").style.zIndex = 360;
const parselKatmani = L.featureGroup().addTo(harita);

const HR = {
  parsel: token("--harita-parsel"), secili: token("--harita-secili"), aktif: token("--harita-aktif"),
  bosluk: token("--harita-bosluk"), taranan: token("--harita-taranan"),
  cizim: token("--harita-cizim"), cizimDolgu: token("--harita-cizim-dolgu"),
};
const STIL = { color: HR.parsel, weight: 1.5, opacity: 0.95, fillColor: HR.parsel, fillOpacity: 0.06 };
const STIL_SECILI = { color: HR.secili, weight: 2.5, opacity: 1, fillColor: HR.secili, fillOpacity: 0.3 };

function stilUygula(key) {
  const k = durum.katmanlar.get(key);
  if (!k) return;
  const temel = durum.secili.has(key) ? STIL_SECILI : STIL;
  k.setStyle(key === durum.aktif ? { ...temel, color: HR.aktif, weight: 3 } : temel);
}

function imlecGuncelle() {
  harita.getContainer().style.cursor = durum.mod ? "crosshair" : "";
}

function bilgiTablosu(p) {
  const f = durum.parseller.get(p.key);
  const nokta = f ? icNokta(f) : null;
  const satirlar = [
    ["Nitelik", p.nitelik], ["Mevkii", p.mevkii], ["Pafta", p.pafta], ["Zemin", p.zemin],
    ["Kaynak", p.kaynak === "tkgm" ? "TKGM" : p.kaynak.replace(/^dosya:/, "")],
    ["Veri tarihi", (p.kaynak_tarih || "").slice(0, 10)],
  ].filter(([, deger]) => deger);
  const harita = nokta
    ? `<a class="disari" href="https://www.google.com/maps/search/?api=1&query=${nokta.lat.toFixed(6)},${nokta.lng.toFixed(6)}" target="_blank" rel="noopener">${ikon("dis")}Google Haritalar</a>`
    : "";
  return `<div class="bilgi-karti">
    <div class="baslik">${esc(p.ada)} / ${esc(p.parsel)}</div>
    <div class="yer">${esc(p.mahalle)} · ${esc(p.ilce)}, ${esc(p.il)}</div>
    <div class="tapu"><b>${p.alan ? esc(p.alan) : "Bilinmiyor"}</b><span>m² tapu alanı</span></div>
    <dl>${satirlar.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
    <div class="kart-eylemleri">
      ${harita}
      <button type="button" class="disari" data-guncelle="${esc(p.key)}" title="Parselin TKGM'deki güncel halini al (1 sorgu harcar)" aria-label="TKGM'den güncelle, 1 sorgu harcar">${ikon("yenile")}Güncelle</button>
    </div>
  </div>`;
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
      html: `<button type="button" class="parsel-menu" title="Parsel bilgisi" aria-label="${esc(p.ada)}/${esc(p.parsel)} bilgisi">${ikon("daha")}</button>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    }),
    keyboard: false,
  }).addTo(harita);
  menuIsareti.bindPopup(() => bilgiTablosu(p), { offset: [0, -12], maxWidth: 280, minWidth: 264 });
}

// ---- tek parseli TKGM'den güncelleme (bilgi kartındaki düğme) -----------------------
// Parseller normalde önbellekten gelir; TKGM'deki hali değişmiş olabilecek bir parsel (ifraz, tevhit,
// nitelik değişikliği) buradan tek sorguyla yenilenir.

harita.on("popupopen", (e) => {
  const b = e.popup.getElement()?.querySelector("[data-guncelle]");
  b?.addEventListener("click", () => parselGuncelle(b.dataset.guncelle, b));
});

async function parselGuncelle(key, buton) {
  const f = durum.parseller.get(key);
  if (!f) return;
  const p = f.properties;
  yukleniyor(buton, true);
  try {
    let r;
    if (p.mahalle_id) {
      r = await postJson("sorgu", { mahalleId: p.mahalle_id, ada: p.ada, parsel: p.parsel, yenile: true });
    } else {
      // Dosyadan gelen parselde mahalle kimliği olmayabilir: parselin içindeki noktadan sorulur.
      const n = icNokta(f);
      r = await postJson("sorgu-nokta", { enlem: n.lat, boylam: n.lng, yenile: true });
    }
    const yeni = r.parsel;
    if (yeni.properties.key !== key) {
      parselEkle(yeni, true);
      mesaj(`Bu noktada artık ${yeni.properties.ada}/${yeni.properties.parsel} var. ${p.ada}/${p.parsel} ifraz ya da tevhit görmüş olabilir.`, true);
      return;
    }
    durum.parseller.set(key, yeni);
    katmanEkle(yeni);
    aktifYap(key, false);
    menuIsareti?.openPopup();
    const fark = [["tapu alanı", p.alan, yeni.properties.alan], ["nitelik", p.nitelik, yeni.properties.nitelik]]
      .filter(([, eski, simdi]) => (eski || "") !== (simdi || ""))
      .map(([ad, eski, simdi]) => `${ad} ${eski || "boş"} → ${simdi || "boş"}`);
    mesaj(fark.length ? `${p.ada}/${p.parsel} güncellendi: ${fark.join(", ")}.` : `${p.ada}/${p.parsel} TKGM'deki haliyle aynı.`, "basari");
  } catch (err) {
    mesaj(err.durum === 404 ? `${p.ada}/${p.parsel} TKGM'de artık yok. İfraz ya da tevhit görmüş olabilir.` : err.message, true);
    yukleniyor(buton, false);
  } finally {
    sayacGuncelle();
  }
}

// ---- sekmeler ------------------------------------------------------------------

function sekmeAc(ad) {
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sekme === ad));
  $("panel-parsel").hidden = ad !== "parsel";
  $("panel-alan").hidden = ad !== "alan";
  $("sayfaAlt").textContent = ad === "alan" ? "Alandan parsel tespiti" : "Parsel sorgu";
  const yuva = document.querySelector(`.yuva[data-yuva="${ad}"]`);
  yuva.append($("bolumDisa"));
  disaSecenekleriGuncelle();
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
  disaSecenekleriGuncelle();
  seciliBarGuncelle();
  if (!liste.length) {
    ul.innerHTML = durum.parseller.size
      ? `<li class="bos"><div class="bos-durum">${ikon("ara", "ikon ikon-buyuk")}<p>Eşleşen parsel yok</p><span>Aramayı kısalt ya da başka bir kelime dene.</span></div></li>`
      : `<li class="bos"><div class="bos-durum">${ikon("parsel", "ikon ikon-buyuk")}<p>Henüz parsel yok</p><span>Ada ve parselle sorgula, haritadan seç ya da KML dosyasını haritaya bırak.</span></div></li>`;
    return;
  }
  ul.innerHTML = liste.map((f) => {
    const p = f.properties;
    return `<li data-key="${esc(p.key)}" class="${durum.aktif === p.key ? "aktif" : ""}">
      <input type="checkbox" class="kutucuk" ${durum.secili.has(p.key) ? "checked" : ""} aria-label="${esc(p.ada)}/${esc(p.parsel)} seç">
      <div class="metin-blok"><div class="ad">${esc(p.mahalle)} <b>${esc(p.ada)}/${esc(p.parsel)}</b></div>
      <div class="alt">${esc(p.nitelik || "Nitelik yok")} · ${esc(p.ilce)}, ${esc(p.il)}</div></div>
      <div class="metraj">${p.alan ? esc(p.alan) : "?"}<small>m²</small></div></li>`;
  }).join("");
}

// Seçim eylem çubuğu: seçim varken haritanın altında belirir.
function seciliBarGuncelle() {
  const n = durum.secili.size;
  $("seciliBar").hidden = n === 0;
  if (!n) return;
  $("seciliBarSayi").textContent = n;
  const toplam = [...durum.secili].reduce((t, k) => t + (durum.parseller.get(k)?.properties.alan_m2 || 0), 0);
  $("seciliBarAlan").textContent = toplam ? `${sayi(toplam)} m²` : "";
}

$("seciliBarTemizle").addEventListener("click", () => $("secimiKaldir").click());

function seciliDegistir(key, deger) {
  const sec = deger ?? !durum.secili.has(key);
  sec ? durum.secili.add(key) : durum.secili.delete(key);
  stilUygula(key);
  listeCiz();
}

function aktifYap(key, yaklas = true) {
  const onceki = durum.aktif;
  durum.aktif = key;
  if (onceki && onceki !== key) stilUygula(onceki);
  stilUygula(key);
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
                  : `${f.properties.ada}/${f.properties.parsel} önbellekten geldi, sorgu harcanmadı.`, "basari");
  }
}

const LIMIT_METNI = "TKGM günlük sorgu limiti aşıldı.";

// Sekmedeki ikon: limit dolunca köşe noktası kırmızı olur, başka sekmedeyken de görünür.
let faviconLimit = null;
function faviconGuncelle(limit) {
  if (faviconLimit === limit) return;
  faviconLimit = limit;
  const nokta = token(limit ? "--harita-bosluk" : "--harita-parsel");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 216 216"><rect width="216" height="216" rx="52" fill="${token("--vurgu")}"/>` +
    `<g fill="${token("--metin-ters")}"><rect x="88" y="36" width="40" height="144"/><rect x="36" y="88" width="144" height="40"/></g>` +
    `<rect x="${limit ? 80 : 88}" y="${limit ? 80 : 88}" width="${limit ? 56 : 40}" height="${limit ? 56 : 40}" fill="${nokta}"/></svg>`;
  $("favicon").href = "data:image/svg+xml," + encodeURIComponent(svg);
}

async function sayacGuncelle() {
  try {
    const s = await api("sayac");
    $("sayacMetin").textContent = s.limit_hatasi ? "Limit doldu" : `Bugün ${s.toplam} sorgu`;
    if (s.limit_hatasi) mesaj(LIMIT_METNI, true);
    $("sayac").classList.toggle("uyari", s.limit_hatasi > 0);
    faviconGuncelle(s.limit_hatasi > 0);
    $("sayac").title = s.limit_hatasi
      ? "TKGM bugünkü sorgu limitini doldurdu. Önbellekteki parseller yine de gelir."
      : `Bugün bu bilgisayardan TKGM'ye ${s.toplam} sorgu atıldı.`;
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

// ---- uygulamanın kendi açılır listeleri ---------------------------------------------
// Asıl değer gizli <select>'lerde durur (yükleme ve change akışı aynen çalışır); düğme ve panel
// sadece görünüm ve seçim içindir. Tarayıcının kendi listesi Windows'ta koyu temada okunmuyordu.
// Uzun listelerde (il/ilçe/mahalle) yazarak arama vardır; kısa listelerde arama kutusu gizlenir.

const SECICILER = ["il", "ilce", "mahalle"];
const TUM_SECICILER = [...SECICILER, "sistem", "dilim", "hesapKatmani"];
const secici = { acik: null, aktif: 0, gorunen: [], sonraki: null, odak: null };

function seciciEsitle(ad) {
  const sel = $(ad), dugme = $(`${ad}-dugme`);
  const opt = sel.selectedOptions[0];
  const dolu = !!(opt && opt.value);
  dugme.disabled = sel.disabled;
  dugme.classList.toggle("bos", !dolu);
  dugme.querySelector(".secici-deger").textContent = dolu ? opt.textContent : sel.disabled ? "" : "Seç";
  // İl seçilince ilçe listesi, ilçe seçilince mahalle listesi gelir gelmez açılır.
  if (secici.sonraki === ad && !sel.disabled && sel.options.length > 1) {
    secici.sonraki = null;
    seciciAc(ad);
  }
}

function vurgula(metin, q) {
  if (!q) return esc(metin);
  const i = trKucuk(metin).indexOf(q);
  if (i < 0) return esc(metin);
  return `${esc(metin.slice(0, i))}<mark>${esc(metin.slice(i, i + q.length))}</mark>${esc(metin.slice(i + q.length))}`;
}

function seciciListele() {
  const sel = $(secici.acik);
  const q = trKucuk($("seciciAra").value.trim());
  secici.gorunen = [...sel.options].filter((o) => o.value && (!q || trKucuk(o.textContent).includes(q)));
  // Aramada baştan eşleşenler öne gelir ("elma" -> Elmadağ, sonra Kızılelma)
  if (q) secici.gorunen.sort((a, b) => trKucuk(b.textContent).startsWith(q) - trKucuk(a.textContent).startsWith(q));
  const i = secici.gorunen.findIndex((o) => o.value === sel.value);
  secici.aktif = i >= 0 && !q ? i : 0;
  $("seciciListe").innerHTML = secici.gorunen.map((o, n) => `
    <li role="option" id="secenek-${n}" data-n="${n}" aria-selected="${o.value === sel.value}" class="${n === secici.aktif ? "aktif" : ""}">
      <span>${vurgula(o.textContent, q)}</span>${o.value === sel.value ? ikon("tik") : ""}</li>`).join("");
  $("seciciBos").hidden = secici.gorunen.length > 0;
  seciciAktifGoster();
}

function seciciAktifGoster() {
  const li = $(`secenek-${secici.aktif}`);
  $("seciciListe").querySelectorAll("li.aktif").forEach((x) => x.classList.remove("aktif"));
  if (!li) return secici.odak?.removeAttribute("aria-activedescendant");
  li.classList.add("aktif");
  li.scrollIntoView({ block: "nearest" });
  secici.odak?.setAttribute("aria-activedescendant", li.id);
}

async function seciciAc(ad) {
  if (secici.acik === ad) return seciciKapat();
  seciciKapat(false);
  if (ad === "il") await illeriYukle();
  if ($(ad).disabled) return;
  secici.acik = ad;
  const aramali = SECICILER.includes(ad) || $(ad).options.length > 8;
  const panel = $("seciciPanel");
  $("seciciAra").closest(".arama").hidden = !aramali;
  $("seciciAra").value = "";
  seciciListele();
  // Aşağıda yer yoksa yukarı doğru aç (sayfanın altındaki koordinat sistemi, dilim gibi listeler).
  const satir = $(`${ad}-dugme`).closest(".satir-alan").getBoundingClientRect();
  const gerekli = Math.min(320, secici.gorunen.length * 36 + (aramali ? 56 : 16));
  const asagi = innerHeight - satir.bottom - 18, yukari = satir.top - 18;
  const yukariAc = asagi < gerekli && yukari > asagi;
  panel.style.left = `${satir.left}px`;
  panel.style.width = `${satir.width}px`;
  panel.style.top = yukariAc ? "auto" : `${satir.bottom + 6}px`;
  panel.style.bottom = yukariAc ? `${innerHeight - satir.top + 6}px` : "auto";
  panel.style.maxHeight = `${Math.max(160, yukariAc ? yukari : asagi)}px`;
  panel.hidden = false;
  $(`${ad}-dugme`).setAttribute("aria-expanded", "true");
  secici.odak = aramali ? $("seciciAra") : $("seciciListe");
  secici.odak.focus();
  seciciAktifGoster();
}

function seciciKapat(odakGeri = true) {
  if (!secici.acik) return;
  const dugme = $(`${secici.acik}-dugme`);
  dugme.setAttribute("aria-expanded", "false");
  $("seciciPanel").hidden = true;
  secici.acik = null;
  if (odakGeri) dugme.focus();
}

function seciciSec(n) {
  const o = secici.gorunen[n];
  if (!o) return;
  const ad = secici.acik;
  const sel = $(ad);
  seciciKapat(false);
  if (sel.value !== o.value) {
    sel.value = o.value;
    secici.sonraki = { il: "ilce", ilce: "mahalle" }[ad] || null;
    sel.dispatchEvent(new Event("change"));
  }
  seciciEsitle(ad);
  if (ad === "mahalle") { $("ada").focus(); $("ada").select(); }
  else if (!secici.sonraki) $(`${ad}-dugme`).focus();
}

TUM_SECICILER.forEach((ad) => {
  new MutationObserver(() => seciciEsitle(ad)).observe($(ad), { childList: true, attributes: true, attributeFilter: ["disabled"] });
  $(ad).addEventListener("change", () => seciciEsitle(ad));
  $(`${ad}-dugme`).addEventListener("click", () => seciciAc(ad));
  seciciEsitle(ad);
});

$("seciciAra").addEventListener("input", seciciListele);
$("seciciPanel").addEventListener("keydown", (e) => {
  const son = secici.gorunen.length - 1;
  if (e.key === "ArrowDown") { e.preventDefault(); secici.aktif = Math.min(son, secici.aktif + 1); seciciAktifGoster(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); secici.aktif = Math.max(0, secici.aktif - 1); seciciAktifGoster(); }
  else if (e.key === "Enter") { e.preventDefault(); seciciSec(secici.aktif); }
  else if (e.key === "Escape") { e.preventDefault(); seciciKapat(); }
  else if (e.key === "Tab") seciciKapat(false);
});
$("seciciListe").addEventListener("mousedown", (e) => e.preventDefault()); // arama kutusu odağı kaybetmesin
$("seciciListe").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-n]");
  if (li) seciciSec(Number(li.dataset.n));
});
document.addEventListener("mousedown", (e) => {
  if (secici.acik && !e.target.closest("#seciciPanel, .secici-dugme")) seciciKapat(false);
});
document.querySelector(".cekmece-govde").addEventListener("scroll", () => seciciKapat(false), { passive: true });
addEventListener("resize", () => seciciKapat(false));

// ---- sorgu ---------------------------------------------------------------------

$("sorguForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const eksik = SECICILER.find((ad) => !$(ad).value);
  if (eksik) {
    mesaj({ il: "Önce il seç.", ilce: "Önce ilçe seç.", mahalle: "Önce mahalle seç." }[eksik], true);
    return seciciAc(eksik);
  }
  const buton = e.submitter;
  yukleniyor(buton, true);
  try {
    const r = await postJson("sorgu", {
      mahalleId: Number($("mahalle").value), ada: $("ada").value.trim(), parsel: $("parsel").value.trim(),
    });
    parselEkle(r.parsel, r.tkgmdenGeldi);
  } catch (err) { mesaj(err.message, true); }
  finally { yukleniyor(buton, false); sayacGuncelle(); }
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
    const r = await postJson("sorgu-nokta", { enlem: e.latlng.lat, boylam: e.latlng.lng });
    parselEkle(r.parsel, r.tkgmdenGeldi);
  } catch (err) { mesaj(err.message, true); }
  finally { sayacGuncelle(); }
});

// ---- dışa aktar (parsel sekmesi) -----------------------------------------------

const bicim = () => document.querySelector("input[name=bicim]:checked").value;
document.querySelectorAll("input[name=bicim]").forEach((r) => r.addEventListener("change", () => {
  document.querySelectorAll("[data-bicim]").forEach((el) => { el.hidden = el.dataset.bicim !== bicim(); });
}));

const alanSekmesinde = () => !$("panel-alan").hidden;
const kapsam = () => (alanSekmesinde() && aktifAlan ? document.querySelector("input[name=kapsam]:checked").value : "secili");

function disaKeys() {
  const k = kapsam();
  if (k === "secili") return [...durum.secili];
  return sonOzet ? sonOzet[k].keys : [];
}

// Alan sekmesinde ve bir alan seçiliyken kapsam/sınır seçenekleri görünür; düğme metni kapsamı söyler.
function disaSecenekleriGuncelle() {
  const alanli = alanSekmesinde() && !!aktifAlan;
  $("alanSecenekleri").hidden = !alanli;
  if (alanli) {
    const ad = referanslar.get(aktifAlan)?.veri.ad || "Alan";
    document.querySelectorAll("[data-alan-adi]").forEach((el) => { el.textContent = `“${ad}”`; });
  }
  const n = disaKeys().length;
  const ne = { secili: "Seçilenleri", kesisen: "Kesişenleri", icinde: "İçindekileri" }[kapsam()];
  $("disaButonMetin").textContent = n ? `${ne} dışa aktar (${n})` : `${ne} dışa aktar`;
}

document.querySelectorAll("input[name=kapsam]").forEach((r) => r.addEventListener("change", disaSecenekleriGuncelle));

$("disaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const keys = disaKeys();
  if (!keys.length) {
    return mesaj(kapsam() === "secili" ? "Önce listeden ya da haritadan parsel seç."
                                       : "Bu alanda dışa aktarılacak parsel yok. Önce parsel içe aktar ya da boşlukları tara.", true);
  }
  const alanli = kapsam() !== "secili" || (alanSekmesinde() && aktifAlan);
  const govde = { keys, bicim: bicim(), ayriDosyalar: $("ayriDosyalar").checked, sistem: $("sistem").value, dilim: $("dilim").value };
  if (alanli && $("alanSiniriEkle").checked) govde.referansId = aktifAlan;
  const buton = $("disaButon");
  yukleniyor(buton, true);
  try { await indir(govde); }
  catch (err) { mesaj(err.message, true); }
  finally { yukleniyor(buton, false); }
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
  if (keys.size) mesaj(`${uygun.length - hata - bosDosyalar.length} dosyadan ${keys.size} parsel listeye eklendi (${durum.parseller.size - onceki} yeni).`, "basari");
  if (bosDosyalar.length && alanSekmesinde()) {
    await referansEkle(bosDosyalar);
  } else if (bosDosyalar.length) {
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
  // Parsel içeren dosyalar listeye; parsel içermeyenler alan sekmesinde doğrudan alan olur.
  dosyalariAktar(e.dataTransfer.files);
});

// ================================================================================
// Alandan parsel tespiti
// ================================================================================

const referanslar = new Map(); // id -> { veri, katman }
let aktifAlan = null; // referans id
let sonOzet = null;

const katmanAdi = (f) => (f.properties && f.properties.katman) || "";

// Alanların içi çapraz çizgili taranır. Desen her renk ve yoğunluk için bir kez oluşturulur ve
// sayfadaki gizli SVG'ye eklenir; Leaflet'in SVG yolları ona url(#...) ile başvurur.
function taramaDeseni(renk, aktif) {
  const id = `tarama-${renk.replace(/[^0-9a-z]/gi, "")}${aktif ? "-aktif" : ""}`;
  if (!document.getElementById(id)) {
    const NS = "http://www.w3.org/2000/svg";
    const desen = document.createElementNS(NS, "pattern");
    desen.id = id;
    desen.setAttribute("patternUnits", "userSpaceOnUse");
    desen.setAttribute("width", "9");
    desen.setAttribute("height", "9");
    desen.setAttribute("patternTransform", "rotate(45)");
    const cizgi = document.createElementNS(NS, "line");
    Object.entries({ x1: 0, y1: 0, x2: 0, y2: 9, stroke: renk, "stroke-width": aktif ? 2.4 : 1.6, "stroke-opacity": aktif ? 0.75 : 0.55 })
      .forEach(([k, v]) => cizgi.setAttribute(k, v));
    desen.append(cizgi);
    $("desenler").append(desen);
  }
  return `url(#${id})`;
}

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
        ? { color: r.renk, weight: aktif ? 4 : 3, dashArray: "8 6", fillColor: taramaDeseni(r.renk, aktif), fillOpacity: 1 }
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
          <span>${esc(ad || "(klasörsüz)")}</span><span class="say">${n}</span></label>`).join("");
  return `<details class="katmanlar"><summary>Katmanlar (${sayac.size - gizli.size}/${sayac.size} açık)</summary>${satirlar}</details>`;
}

function referansListeCiz() {
  $("alanYok").hidden = referanslar.size > 0;
  $("referansListe").innerHTML = [...referanslar.values()].map(({ veri: r }) => {
    const n = r.geojson.features.length;
    const alt = r.hesap_katmani ? `Sınır: ${r.hesap_katmani}` : `${n} nesne`;
    return `
    <li data-id="${r.id}" class="${r.id === aktifAlan ? "aktif" : ""}">
      <div class="ref-ust">
        <label class="renk-secici" style="background:${esc(r.renk)}" title="Rengi değiştir"><input type="color" data-is="renk" value="${esc(r.renk)}" aria-label="${esc(r.ad)} rengi"></label>
        <button type="button" class="ad" data-is="sec" title="Bu alanla çalış">${esc(r.ad)}<small>${esc(alt)}</small></button>
        <label class="ikon-dugme gorunur-anahtar" title="Haritada göster ya da gizle">
          <input type="checkbox" data-is="gorunur" ${r.gorunur ? "checked" : ""} aria-label="${esc(r.ad)} haritada görünsün">${ikon("goz", "ikon acik")}${ikon("goz-kapali", "ikon kapali")}
        </label>
        <button type="button" class="ikon-dugme" data-is="sil" title="Alanı kaldır" aria-label="${esc(r.ad)} alanını kaldır">${ikon("kapat")}</button>
      </div>
      ${katmanListesi(r)}
    </li>`;
  }).join("");
}

// Sınır katmanı seçiliyse sadece o; pafta indeksi gibi büyük katmanlar haritayı uzaklaştırmasın.
function sinirFc(veri) {
  const hesap = veri.hesap_katmani;
  return hesap == null ? veri.geojson
    : { type: "FeatureCollection", features: veri.geojson.features.filter((f) => katmanAdi(f) === hesap) };
}

function alanaYaklas(id) {
  const ref = referanslar.get(id);
  if (!ref) return;
  const b = L.geoJSON(sinirFc(ref.veri)).getBounds();
  if (b.isValid()) harita.fitBounds(b, { padding: [30, 30] });
}

function alanSec(id, yaklas = true) {
  const onceki = aktifAlan;
  aktifAlan = id;
  for (const k of [onceki, id]) if (k && referanslar.has(k)) referansCiz(referanslar.get(k).veri);
  referansListeCiz();
  bosluklariTemizle();
  $("alanDetay").hidden = !id;
  disaSecenekleriGuncelle();
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
  $("hesapKatmani").closest(".satir-alan").hidden = katmanlar.length < 2 && !r.hesap_katmani;
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
        : `"${r.ad}" alan olarak eklendi.`, "basari");
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
    disaSecenekleriGuncelle();
    if ($("bosluklariGoster").getAttribute("aria-pressed") === "true") bosluklariCiz();
  } catch (e) {
    sonOzet = null;
    $("ozet").innerHTML = `<p class="hata-metin">${ikon("uyari")}<span>${esc(e.message)}</span></p>`;
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
    <div class="ozet-alan"><b>${sayi(o.alan_m2)} m²</b><span>${sayi(o.alan_m2 / 1000, 1)} dönüm · ${sayi(o.alan_m2 / 10000, 2)} ha</span></div>
    <div class="ozet-izgara">
      <div><b>${o.icinde.adet}</b><span>parsel tamamen içinde</span><small>${sayi(o.icinde.tapu_m2)} m² tapu</small></div>
      <div><b>${o.kesisen.adet}</b><span>parsel kesişiyor</span><small>${sayi(o.kesisen.alan_ici_m2)} m² alan içinde</small></div>
    </div>
    <div class="kaplama">
      <div class="kaplama-ust"><span>Listedeki parsellerle kaplı</span><b>%${sayi(yuzde, 1)}</b></div>
      <div class="kaplama-cubuk" role="img" aria-label="Alanın yüzde ${sayi(yuzde, 1)} kısmı kaplı"><i style="width:${Math.min(100, yuzde)}%"></i></div>
      <small>${o.bosluk.adet ? `<span class="bosluk-imi" aria-hidden="true"></span>${o.bosluk.adet} boşluk · ${sayi(o.bosluk.m2)} m² sorgulanmamış` : "Sorgulanmaya değer boşluk yok"}${taranan ? ` · ${taranan} boş nokta işaretli` : ""}</small>
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
                    : `Bu alanda ${ne} parsel yok. Boşlukları tarayabilir ya da parsel içe aktarabilirsin.`, keys.length ? "basari" : true);
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
    style: { color: HR.bosluk, weight: 1.5, dashArray: "4 4", fillColor: HR.bosluk, fillOpacity: 0.14 },
  }).addTo(grup);
  for (const [lon, lat, r] of referanslar.get(aktifAlan)?.veri.taranan || []) {
    L.circle([lat, lon], { radius: r, pane: "bosluk", interactive: false, color: HR.taranan, weight: 1, dashArray: "2 3", fillColor: HR.taranan, fillOpacity: 0.25 }).addTo(grup);
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
  const ilerleme = $("taramaIlerleme");
  ilerleme.hidden = false;
  ilerleme.firstElementChild.style.width = "0%";
  let harcanan = 0, bulunan = 0, bos = 0, adim = 0, son = "";
  try {
    while (harcanan < butce && !tarama.dur && adim < butce * 3) {
      adim++;
      taramaDurumYaz(`Taranıyor… ${harcanan}/${butce} sorgu · ${bulunan} parsel bulundu · ${bos} boş nokta`);
      const r = await postJson(`referanslar/${id}/tara`, { keys: oturumKeys() });
      if (r.sorgu) harcanan++;
      ilerleme.firstElementChild.style.width = `${(100 * harcanan) / butce}%`;
      if (r.durum === "bitti") { son = "Sorgulanmaya değer boşluk kalmadı."; break; }
      if (r.durum === "bulundu") { bulunan++; parselEkle(r.parsel, r.sorgu, { yaklas: false, sessiz: true }); }
      else bos++;
      await referansTazele(id);
      await ozetYukle();
      sayacGuncelle();
    }
    if (!son) son = tarama.dur ? "Durduruldu." : `${butce} sorgu sınırına ulaşıldı.`;
    if (son.startsWith("Sorgulanmaya")) ilerleme.firstElementChild.style.width = "100%";
  } catch (e) {
    son = e.durum === 429 ? "TKGM günlük limiti doldu, tarama durdu." : `Hata: ${e.message}`;
    mesaj(e.durum === 429 ? LIMIT_METNI : son, true);
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

// ---- elle alan çizimi --------------------------------------------------------------

const cizim = { pinler: [], sekil: null };

function cizimSekliGuncelle() {
  cizim.sekil?.remove();
  const noktalar = cizim.pinler.map((m) => m.getLatLng());
  cizim.sekil = noktalar.length >= 3
    ? L.polygon(noktalar, { color: HR.cizim, weight: 2, dashArray: "6 5", fillColor: HR.cizimDolgu, fillOpacity: 0.18, interactive: false })
    : L.polyline(noktalar, { color: HR.cizim, weight: 2, dashArray: "6 5", interactive: false });
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
    iconSize: [22, 22],
    iconAnchor: [11, 11],
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
    mesaj(`"${r.ad}" alanı oluşturuldu.`, "basari");
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
  if (durum.mod === "sorgu" && e.key === "Escape") return sorguModu(false);
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
