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
  let r;
  try {
    r = await fetch("/api/" + yol, secenek);
  } catch {
    // Tarayıcının "Failed to fetch"i: cevap hiç gelmedi (uygulama kapalı ya da bağlantı kesildi).
    throw new Error("Uygulamanın sunucusuna ulaşılamadı. Uygulama kapanmış olabilir; yeniden açıp tekrar dene.");
  }
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
// Vazgeç "submit" olsaydı, kutuda Enter'a basınca formun ilk düğmesi olarak o çalışır, girilen ad kaybolurdu.
$("diyalogIptal").addEventListener("click", () => $("diyalog").close("iptal"));
const onayla = (metin, tamam = "Tamam") => diyalogAc(metin, { tamam });
async function adSor(metin, varsayilan) {
  return (await diyalogAc(metin, { girdi: varsayilan, tamam: "Kaydet" })) ? $("diyalogGirdi").value : null;
}

// Dosya gönderilmeden önce belleğe okunur. Ağ klasöründeki dosyada tarayıcı, dosya seçildikten sonra
// değişmiş sanıp gönderimi yarıda kesebiliyor ("Failed to fetch"); okunamazsa sebep açıkça söylenir.
async function dosyaIcerigi(f) {
  try {
    return await f.arrayBuffer();
  } catch {
    throw new Error(`${f.name} okunamadı. Dosya başka bir programda açık olabilir ya da ağ klasörüne erişim kesilmiş olabilir; `
      + "dosyayı bilgisayara kopyalayıp tekrar dene.");
  }
}

const postJson = (yol, govde) =>
  api(yol, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde) });

// ---- dosya kaydetme: yeri kullanıcı seçer ----------------------------------------------------------
// Chrome ve Edge'de kaydetme penceresi açılır (klasör ve ad seçilir). Pencere tıklamanın hemen ardından
// açılmalı (tarayıcı kuralı); bu yüzden önce yer sorulur, dosya sonra hazırlanıp oraya yazılır.
// Pencereyi desteklemeyen tarayıcıda dosya İndirilenler klasörüne iner.
// Bazı gömülü tarayıcılar (ör. Claude masaüstü uygulamasının önizleme paneli) pencereyi hiç göstermeden
// "vazgeçildi" der. Kullanıcı bu kadar çabuk vazgeçemeyeceği için o zaman pencere yok sayılır, bir daha da
// denenmez; dosya indirilir.
const DOSYA_TURLERI = {
  ".kml": ["KML (Google Earth)", "application/vnd.google-earth.kml+xml"],
  ".zip": ["ZIP arşivi", "application/zip"],
  ".xlsx": ["Excel çalışma kitabı", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".png": ["PNG görseli", "image/png"],
  ".pdf": ["PDF belgesi", "application/pdf"],
  ".parselsorgu": ["Parsel Sorgu + projesi", "application/json"],
};
const guvenliAd = (s) => String(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/^[\s.-]+|[\s.-]+$/g, "") || "parsel";

let dosyaPenceresiYok = false;

// fn: "showSaveFilePicker" ya da "showOpenFilePicker". Dönüş: pencerenin sonucu; pencere yoksa ya da
// açılamadıysa null; kullanıcı vazgeçtiyse false.
async function dosyaPenceresi(fn, secenek) {
  if (dosyaPenceresiYok || !window[fn]) return null;
  const bas = performance.now();
  try {
    return await window[fn](secenek);
  } catch (e) {
    if (e.name !== "AbortError") return null;
    if (performance.now() - bas > 400) return false;
    dosyaPenceresiYok = true; // gösterilmeden kapandı
    return null;
  }
}

// Dönüş: dosya tutamacı; pencere yoksa null (indirilecek); vazgeçildiyse false.
function kayitYeriSor(ad) {
  const uzanti = (ad.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  const [aciklama, tur] = DOSYA_TURLERI[uzanti] || ["Dosya", "application/octet-stream"];
  return dosyaPenceresi("showSaveFilePicker", { suggestedName: ad, types: uzanti ? [{ description: aciklama, accept: { [tur]: [uzanti] } }] : undefined });
}

async function dosyaYaz(hedef, blob, ad) {
  if (hedef) {
    const yazici = await hedef.createWritable();
    await yazici.write(blob);
    await yazici.close();
    return mesaj(`${hedef.name} kaydedildi.`, "basari");
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: ad });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  mesaj(`${ad} indirildi.`, "basari");
}

// Önerilen dosya adı (sunucudaki exporters.dosya_adi ile aynı kural)
function parselDosyaAdi(keys, uzanti) {
  const ps = keys.map((k) => durum.parseller.get(k)?.properties).filter(Boolean);
  const yerler = new Set(ps.map((p) => `${p.il}-${p.ilce}-${p.mahalle}`));
  const ad = ps.length === 1 ? `${ps[0].il}-${ps[0].ilce}-${ps[0].mahalle}-${ps[0].ada}-${ps[0].parsel}`
    : yerler.size === 1 ? `${[...yerler][0]}-${ps.length} parsel` : `Parseller-${ps.length} parsel-${new Date().toISOString().slice(0, 10)}`;
  return guvenliAd(ad) + uzanti;
}

async function indir(govde, buton) {
  const uzanti = govde.bicim === "excel" ? ".xlsx" : govde.ayriDosyalar && govde.keys.length > 1 ? ".zip" : ".kml";
  const ad = parselDosyaAdi(govde.keys, uzanti);
  const hedef = await kayitYeriSor(ad);
  if (hedef === false) return;
  yukleniyor(buton, true);
  try {
    const r = await postJson("disa-aktar", govde);
    await dosyaYaz(hedef, await r.blob(), ad);
  } catch (err) { mesaj(err.message, true); } finally { yukleniyor(buton, false); }
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
// Boşluklar parsellerin altında çizilir ve tıklamayı engellemez. Alanların ve notların bölmeleri
// katmanBolmesi ile açılır; z-sıraları katman listesini izler (sirayiUygula).
harita.createPane("bosluk").style.zIndex = 360;
// Haritadaki yazılar (ada/parsel numaraları, alan adları) parsellerin üstünde durur ve tıklamayı engellemez.
for (const [ad, z] of [["parselNo", 450], ["alanAdi", 460]]) {
  harita.createPane(ad).style.zIndex = z;
  harita.getPane(ad).style.pointerEvents = "none";
}
const parselKatmani = L.featureGroup().addTo(harita);

const HR = {
  parsel: token("--harita-parsel"), secili: token("--harita-secili"), aktif: token("--harita-aktif"),
  bosluk: token("--harita-bosluk"), taranan: token("--harita-taranan"),
  cizim: token("--harita-cizim"), cizimDolgu: token("--harita-cizim-dolgu"),
};
const STIL = { color: HR.parsel, weight: 1.5, opacity: 0.95, fillColor: HR.parsel, fillOpacity: 0.06 };
const STIL_SECILI = { color: HR.secili, weight: 2.5, opacity: 1, fillColor: HR.secili, fillOpacity: 0.3 };

// ---- nitelik renkleri: açıkken parseller niteliklerine göre boyanır (düzenleyici nitelik.js'te) ----
// Doğrulanmış 8 tonluk kategorik palet (renk körlüğüne dayanıklı; dataviz denetiminden geçti) ve nötr gri.
// Her nitelik bir yuvaya (0-8) bağlıdır; renk niteliği izler, sırasını değil. Aynı yuva bağlama göre farklı
// adımla çizilir: haritada koyu zemin adımı (uydu), grafikte bulunduğu zemine uygun adım. 0: gri (diğer,
// belirtilmemiş). Seçilmemiş nitelik adına göre hep aynı yuvayı alır; sık görülenlerin tanıdık tonu var.
const NITELIK_RENKLERI = [["--nitelik-renk-1", "Mavi"], ["--nitelik-renk-2", "Turuncu"], ["--nitelik-renk-3", "Su yeşili"],
  ["--nitelik-renk-4", "Sarı"], ["--nitelik-renk-5", "Pembe"], ["--nitelik-renk-6", "Yeşil"], ["--nitelik-renk-7", "Mor"],
  ["--nitelik-renk-8", "Kırmızı"], ["--nitelik-renk-0", "Gri"]];
const TANIDIK_NITELIKLER = [[/tarla/, 4], [/(^|\s)(ev|konut|bina)|kargir|ahşap|yapı/, 8], [/bahçe|zeytin/, 6], [/arsa/, 2],
  [/(^|\s)bağ/, 7], [/mera|çayır|otlak/, 3], [/ham toprak/, 5], [/yol|dere|kanal|ark|fabrika|sanayi|depo|atölye/, 1],
  [/^belirtilmemiş$/, 0]];
// Yuva numarası ya da (eski kayıtlarda) #rrggbb
const nitelikRengiGecerli = (v) => (Number.isInteger(v) && v >= 0 && v <= 8) || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v));
const nitelikRenk = { acik: false, renkler: {} };
try {
  const k = JSON.parse(localStorage.getItem("nitelikRenkleri") || "{}");
  nitelikRenk.acik = k.acik === true;
  for (const [ad, v] of Object.entries(k.renkler || {})) if (nitelikRengiGecerli(v)) nitelikRenk.renkler[ad] = v;
} catch { /* varsayılan: kapalı */ }
const nitelikAdi = (p) => (p?.nitelik || "").trim() || "Belirtilmemiş";

function nitelikYuvasi(ad) {
  if (Object.hasOwn(nitelikRenk.renkler, ad)) return nitelikRenk.renkler[ad];
  const k = trKucuk(ad);
  const tanidik = TANIDIK_NITELIKLER.find(([desen]) => desen.test(k));
  return tanidik ? tanidik[1] : 1 + ([...k].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % 8);
}

// baglam: "harita" (uydu üstü), "kagit" (beyaz kart: haritadaki grafik, çıktı sayfası) ya da "panel"
// (çekmece; temaya göre değişen CSS değişkeni döner, sadece satır içi SVG'de kullanılır).
function nitelikRengi(ad, baglam = "harita") {
  const v = nitelikYuvasi(ad);
  if (typeof v === "string") return v;
  return baglam === "panel" ? `var(--grafik-renk-${v})` : token(`--${baglam === "kagit" ? "grafik-kagit" : "nitelik"}-renk-${v}`);
}

// Parselin haritadaki ve çıktıdaki stili. Seçili mavi kenarlı; üzerinde çalışılan beyaz kenarlı (çıktıda değil).
function parselStili(key, aktifGoster = true) {
  const secili = durum.secili.has(key);
  let st = secili ? STIL_SECILI : STIL;
  if (nitelikRenk.acik) {
    const renk = nitelikRengi(nitelikAdi(durum.parseller.get(key)?.properties));
    st = secili ? { color: HR.secili, weight: 2.5, opacity: 1, fillColor: renk, fillOpacity: 0.6 }
      : { color: renk, weight: 1.5, opacity: 1, fillColor: renk, fillOpacity: 0.45 };
  }
  return aktifGoster && key === durum.aktif ? { ...st, color: HR.aktif, weight: 3 } : st;
}

function stilUygula(key) {
  const k = durum.katmanlar.get(key);
  if (!k) return;
  k.setStyle(parselStili(key));
  if (parselNo.isaretler.has(key)) parselNoSigdir(key);
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
  parselNoCiz(f);
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

// Düğmenin ve numaranın konacağı nokta: sınır kutusunun ortası parselin içindeyse o, değilse içeride kalan ilk ızgara noktası.
function icNokta(f) {
  return poligonIcNokta(f.geometry.coordinates.reduce((a, b) => (b[0].length > a[0].length ? b : a)));
}

function poligonIcNokta(pol) {
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

// ---- ada/parsel numaraları: Parsel sekmesindeki anahtarla açılır -------------------------

const parselNo = { acik: false, isaretler: new Map() }; // key -> Leaflet işareti
try { parselNo.acik = localStorage.getItem("parselNo") === "1"; } catch { /* varsayılan kapalı */ }

function parselNoCiz(f) {
  const key = f.properties.key;
  parselNo.isaretler.get(key)?.remove();
  parselNo.isaretler.delete(key);
  if (!parselNo.acik) return;
  const p = f.properties;
  parselNo.isaretler.set(key, L.marker(icNokta(f), {
    pane: "parselNo", interactive: false, keyboard: false,
    icon: L.divIcon({ className: "harita-yazi-ikon", html: `<span class="parsel-no">${esc(p.ada)}/${esc(p.parsel)}</span>`, iconSize: null }),
  }).addTo(harita));
  parselNoSigdir(key);
}

// Numara, parsel ekranda ona yetecek kadar büyükse görünür; uzaktan bakınca yazılar üst üste binmez.
// Aktif parselde aynı noktada menü düğmesi durduğu için numara biraz aşağı kayar.
function parselNoSigdir(key) {
  const el = parselNo.isaretler.get(key)?.getElement();
  const sinir = durum.katmanlar.get(key)?.getBounds();
  if (!el || !sinir) return;
  const a = harita.latLngToLayerPoint(sinir.getSouthWest()), b = harita.latLngToLayerPoint(sinir.getNorthEast());
  el.classList.toggle("sigmaz", b.x - a.x < 40 || a.y - b.y < 16);
  el.classList.toggle("aktif", key === durum.aktif);
}

harita.on("zoomend", () => parselNo.isaretler.forEach((_, key) => parselNoSigdir(key)));
$("parselNoGoster").checked = parselNo.acik;
$("parselNoGoster").addEventListener("change", (e) => {
  parselNo.acik = e.target.checked;
  try { localStorage.setItem("parselNo", parselNo.acik ? "1" : "0"); } catch { /* tercih saklanamazsa önemli değil */ }
  durum.parseller.forEach(parselNoCiz);
});

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

const SAYFALAR = { parsel: "Parsel sorgu", alan: "Alandan parsel tespiti", analiz: "Parsel analizi", gorsel: "Alan görünümü", cikti: "Çıktı al" };

function sekmeAc(ad) {
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sekme === ad));
  for (const sayfa in SAYFALAR) $(`panel-${sayfa}`).hidden = ad !== sayfa;
  $("sayfaAlt").textContent = SAYFALAR[ad];
  // Görsel sayfasında dışa aktarma yok; kutu önceki sayfanın yuvasında gizli kalır.
  document.querySelector(`.yuva[data-yuva="${ad}"]`)?.append($("bolumDisa"));
  disaSecenekleriGuncelle();
  if (ad !== "parsel" && durum.mod === "sorgu") sorguModu(false);
  if (ad !== "alan" && durum.mod === "cizim") cizimIptal();
  if (ad === "alan" && aktifAlan) ozetYukle();
  notlariSekmeyeUydur();
  if (ad === "gorsel") { katmanSirasiCiz(); gorselDuzenDoldur(); notDuzenDoldur(); }
  try { localStorage.setItem("sekme", ad); } catch { /* tercih saklanamazsa önemli değil */ }
  document.dispatchEvent(new CustomEvent("sekme", { detail: ad })); // cikti.js çerçeveyi açar/kapatır
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
  document.dispatchEvent(new Event("parseller")); // analiz.js: liste ya da seçim değişti
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
  keys.forEach((k) => {
    durum.katmanlar.get(k)?.remove(); durum.katmanlar.delete(k); durum.parseller.delete(k);
    parselNo.isaretler.get(k)?.remove(); parselNo.isaretler.delete(k);
  });
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

// Sorgu sayısı gösterilmez: TKGM limitin kaç olduğunu söylemiyor ve aynı bağlantıdan sitede yapılan
// sorgular sayılamıyor. Sadece limit dolduğunda etiket, bildirim ve kırmızı sekme ikonu gösterilir.
async function sayacGuncelle() {
  try {
    const limit = (await api("sayac")).limit_hatasi > 0;
    $("sayac").hidden = !limit;
    faviconGuncelle(limit);
    if (limit) mesaj(LIMIT_METNI, true);
  } catch { /* limit bilgisi alınamazsa önemli değil */ }
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
const TUM_SECICILER = [...SECICILER, "sistem", "dilim", "hesapKatmani", "ciktiOlcek", "analizAlan"];
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
  for (const [kutu, ad] of [[$("ada"), "Ada"], [$("parsel"), "Parsel"]]) {
    const deger = kutu.value.trim();
    const hata = !deger ? `${ad} numarasını yaz.` : /^\d+$/.test(deger) ? null : `${ad} için yalnızca rakam yaz.`;
    if (hata) return alanHatasi(kutu, hata);
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
  if (durum.mod?.startsWith("not-")) return notTikla(e.latlng);
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
  await indir(govde, $("disaButon"));
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
        body: await dosyaIcerigi(f),
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
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  surukle = 0;
  $("birak").hidden = true;
  // Görsel sekmesinde görsel, PDF ve tablolar haritaya eklenir. Parsel içeren dosyalar listeye;
  // parsel içermeyenler alan sekmesinde doğrudan alan olur.
  let dosyalar = [...e.dataTransfer.files];
  const projeDosyasi = dosyalar.find((f) => /\.parselsorgu$/i.test(f.name));
  if (projeDosyasi) return projeAc(projeDosyasi); // proje.js
  if (gorselSekmesinde()) dosyalar = await notDosyalariniAl(dosyalar);
  if (dosyalar.length) dosyalariAktar(dosyalar);
});

// ================================================================================
// Alandan parsel tespiti
// ================================================================================

const referanslar = new Map(); // id -> { veri, katman }
let aktifAlan = null; // referans id
let sonOzet = null;

const katmanAdi = (f) => (f.properties && f.properties.katman) || "";
const katmanSirasi = []; // alan (sayı) ve not ("n1") kimlikleri, haritada en üstteki başta; sadece bu sayfa açıkken yaşar
const gorselKayit = { bekleyen: new Map(), kuyruk: Promise.resolve() }; // sunucuya yazılmayı bekleyen görünümler

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(ad, nitelikler) {
  const el = document.createElementNS(SVG_NS, ad);
  for (const [k, v] of Object.entries(nitelikler)) el.setAttribute(k, v);
  return el;
}

// Tarama deseni sayfadaki gizli SVG'de durur; Leaflet'in SVG yolları ona url(#...) ile başvurur.
// Aynı kimlikle tekrar çağrılınca yerinde güncellenir, kaydırıcı sürüklenirken desen birikmez.
function desenYaz(id, renk, g, kalin = false) {
  let desen = document.getElementById(id);
  if (!desen) {
    desen = svgEl("pattern", { id, patternUnits: "userSpaceOnUse" });
    $("desenler").append(desen);
  }
  const a = g.aralik, orta = a / 2;
  const opaklik = Math.min(1, g.opaklik / 100 + (kalin ? 0.2 : 0));
  const cizgi = { stroke: renk, "stroke-width": kalin ? 1.4 : 1, "stroke-opacity": opaklik };
  const aci = { capraz: 45, ters: -45, "capraz-kareli": 45 }[g.desen];
  desen.setAttribute("width", a);
  desen.setAttribute("height", a);
  if (aci) desen.setAttribute("patternTransform", `rotate(${aci})`); else desen.removeAttribute("patternTransform");
  const parcalar = [];
  if (["capraz", "ters", "dikey", "kareli", "capraz-kareli"].includes(g.desen)) parcalar.push(svgEl("line", { x1: orta, y1: 0, x2: orta, y2: a, ...cizgi }));
  if (["yatay", "kareli", "capraz-kareli"].includes(g.desen)) parcalar.push(svgEl("line", { x1: 0, y1: orta, x2: a, y2: orta, ...cizgi }));
  if (g.desen === "nokta") parcalar.push(svgEl("circle", { cx: orta, cy: orta, r: Math.max(1, a / 7) * (kalin ? 1.25 : 1), fill: renk, "fill-opacity": opaklik }));
  desen.replaceChildren(...parcalar);
  return `url(#${id})`;
}

function cizgiDizisi(cizgi, kalinlik) {
  if (cizgi === "kesik") return `${Math.max(8, kalinlik * 2.6)} ${Math.max(6, kalinlik * 2)}`;
  if (cizgi === "nokta") return `0 ${Math.max(5, kalinlik * 2.2)}`; // yuvarlak uçlu, boyu sıfır çizgi = nokta
  return null;
}

// Alanın stili Görsel sekmesindeki ayarlardan (r.gorsel) gelir. Üzerinde çalışılan alan biraz daha belirgin çizilir.
function referansStili(r) {
  const g = r.gorsel, aktif = r.id === aktifAlan, hesap = r.hesap_katmani;
  const kalinlik = g.kalinlik ? g.kalinlik + (aktif ? 1 : 0) : 0;
  const dolgu = g.desen === "yok" ? { fillOpacity: 0 }
    : g.desen === "dolu" ? { fillColor: r.renk, fillOpacity: Math.min(1, g.opaklik / 100 + (aktif ? 0.1 : 0)) }
    : { fillColor: desenYaz(`desen-${r.id}${aktif ? "-aktif" : ""}`, r.renk, g, aktif), fillOpacity: 1 };
  const sinir = { color: r.renk, opacity: 1, stroke: kalinlik > 0, weight: kalinlik, dashArray: cizgiDizisi(g.cizgi, kalinlik), ...dolgu };
  return (f) => {
    if (/Point$/.test(f.geometry.type)) return { color: r.renk, fillColor: r.renk, fillOpacity: 0.8, weight: 2, opacity: 1, stroke: true, dashArray: null };
    // Sınır dışındaki katmanlar (proje dosyasının geri kalanı) ince ve taramasız çizilir.
    if (hesap != null && katmanAdi(f) !== hesap) return { color: r.renk, weight: 1, opacity: 0.7, fillOpacity: 0, stroke: true, dashArray: null };
    return sinir;
  };
}

function referansKatmani(r) {
  const gizli = new Set(r.gizli || []);
  const hesap = r.hesap_katmani;
  return L.geoJSON(r.geojson, {
    interactive: false,
    // Sınır katmanı gizli olsa da çizilir: hesap ona göre yapılıyor, görünmesi gerekir.
    filter: (f) => !gizli.has(katmanAdi(f)) || katmanAdi(f) === hesap,
    style: referansStili(r),
    pane: katmanBolmesi(r.id),
    pointToLayer: (_, latlng) => L.circleMarker(latlng, { pane: katmanBolmesi(r.id), radius: 5, interactive: false }),
  });
}

const halkaAlani = (h) => Math.abs(h.reduce((t, [x, y], i) => { const [x2, y2] = h[(i + 1) % h.length]; return t + x * y2 - x2 * y; }, 0));

// Ad etiketinin yeri: açık sınır katmanlarındaki en büyük poligonun içi; poligon yoksa sınırların ortası.
function alanIcNokta(r) {
  const gizli = new Set(r.gizli || []);
  const ozellikler = sinirFc(r).features.filter((f) => !gizli.has(katmanAdi(f)) || katmanAdi(f) === r.hesap_katmani);
  const poligonlar = ozellikler.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates]
    : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : []));
  if (poligonlar.length) return poligonIcNokta(poligonlar.reduce((a, b) => (halkaAlani(b[0]) > halkaAlani(a[0]) ? b : a)));
  const sinir = L.geoJSON({ type: "FeatureCollection", features: ozellikler }).getBounds();
  return sinir.isValid() ? sinir.getCenter() : null;
}

function alanAdiIsareti(r) {
  if (!r.gorunur || !r.gorsel.etiket) return null;
  const nokta = alanIcNokta(r);
  if (!nokta) return null;
  return L.marker(nokta, {
    pane: "alanAdi", interactive: false, keyboard: false,
    icon: L.divIcon({ className: "harita-yazi-ikon", html: `<span class="alan-adi" style="--alan-renk:${esc(r.renk)}">${esc(r.ad)}</span>`, iconSize: null }),
  }).addTo(harita);
}

// Her katmanın kendi bölmesi var; bölmelerin z-sırası listedeki sırayı izler. Alanlar ve haritaya
// oturan görseller parsellerin altında kalır (300'ler); yazı, ok ve tablolar üstünde (470'ler).
function katmanBolmesi(id) {
  const ad = `katman-${id}`;
  if (!harita.getPane(ad)) harita.createPane(ad);
  return ad;
}

function sirayiUygula() {
  let alt = 0, ust = 0;
  for (let i = katmanSirasi.length - 1; i >= 0; i--) {
    const id = katmanSirasi[i];
    const bolme = harita.getPane(`katman-${id}`);
    if (typeof id === "number" || notlar.get(id)?.tur === "gorsel") { // haritaya oturan görseller alanlarla aynı bantta
      if (bolme) bolme.style.zIndex = Math.min(349, 300 + alt);
      referanslar.get(id)?.etiket?.setZIndexOffset(alt * 100000);
      alt++;
    } else if (bolme) bolme.style.zIndex = 470 + ust++;
  }
}

function referansCiz(r) {
  const eski = referanslar.get(r.id);
  // Henüz kaydedilmemiş görünüm değişikliği sunucunun daha eski cevabıyla ezilmesin.
  if (eski && gorselKayit.bekleyen.has(r.id)) r = { ...r, renk: eski.veri.renk, gorsel: eski.veri.gorsel };
  eski?.katman.remove();
  eski?.etiket?.remove();
  const katman = referansKatmani(r);
  if (r.gorunur) katman.addTo(harita);
  referanslar.set(r.id, { veri: r, katman, etiket: alanAdiIsareti(r) });
  if (!katmanSirasi.includes(r.id)) { // yeni alan: en üste, lejant açıksa lejanta
    katmanSirasi.unshift(r.id);
    lejantaAlanEkle(r.id);
  }
  sirayiUygula();
}

function referansKaldir(id) {
  const ref = referanslar.get(id);
  ref?.katman.remove();
  ref?.etiket?.remove();
  referanslar.delete(id);
  if (katmanSirasi.includes(id)) katmanSirasi.splice(katmanSirasi.indexOf(id), 1);
  lejantAlanCikar(id);
  clearTimeout(gorselKayit.bekleyen.get(id));
  gorselKayit.bekleyen.delete(id);
  for (const ad of [`desen-${id}`, `desen-${id}-aktif`, `ornek-${id}`]) document.getElementById(ad)?.remove();
}

function katmanListesi(r) {
  const sayac = new Map();
  r.geojson.features.forEach((f) => sayac.set(katmanAdi(f), (sayac.get(katmanAdi(f)) || 0) + 1));
  if (sayac.size < 2) return "";
  const gizli = new Set(r.gizli || []);
  const satirlar = [...sayac].map(([ad, n]) => `
        <label class="katman"><input type="checkbox" class="kutucuk" data-is="katman" data-katman="${esc(ad)}" ${gizli.has(ad) ? "" : "checked"}>
          <span>${esc(ad || "(klasörsüz)")}</span><span class="say">${n}</span></label>`).join("");
  return `<details class="katmanlar"><summary>${ikon("ok")}Katmanlar (${sayac.size - gizli.size}/${sayac.size} açık)</summary>${satirlar}</details>`;
}

function referansListeCiz() {
  $("alanYok").hidden = referanslar.size > 0;
  $("referansListe").innerHTML = [...referanslar.values()].map(({ veri: r }) => {
    const n = r.geojson.features.length;
    const alt = r.hesap_katmani ? `Sınır: ${r.hesap_katmani}` : `${n} nesne`;
    return `
    <li data-id="${r.id}" class="${r.id === aktifAlan ? "aktif" : ""}">
      <div class="ref-ust">
        <button type="button" class="renk-secici" data-is="renk" style="background:${esc(r.renk)}" title="Rengi değiştir" aria-label="${esc(r.ad)} rengi" aria-haspopup="true" aria-expanded="false"></button>
        <button type="button" class="ad" data-is="sec" title="Bu alanla çalış">${esc(r.ad)}<small>${esc(alt)}</small></button>
        <label class="ikon-dugme gorunur-anahtar" title="Haritada göster ya da gizle">
          <input type="checkbox" data-is="gorunur" ${r.gorunur ? "checked" : ""} aria-label="${esc(r.ad)} haritada görünsün">${ikon("goz", "ikon acik")}${ikon("goz-kapali", "ikon kapali")}
        </label>
        <button type="button" class="ikon-dugme" data-is="sil" title="Alanı kaldır" aria-label="${esc(r.ad)} alanını kaldır">${ikon("kapat")}</button>
      </div>
      ${katmanListesi(r)}
    </li>`;
  }).join("");
  katmanSirasiCiz();
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
  // Önceki alanın tarama sonucu yeni alanda kalmasın.
  if (id !== onceki && !tarama.calisiyor) $("taramaDurum").hidden = $("taramaIlerleme").hidden = true;
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
      const r = await api("referanslar", { method: "POST", headers: { "X-Dosya-Adi": encodeURIComponent(f.name) }, body: await dosyaIcerigi(f) });
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
  if (!id || !["gorunur", "katman"].includes(is)) return;
  let govde;
  if (is === "katman") {
    const li = e.target.closest("li");
    govde = { gizli: [...li.querySelectorAll("input[data-is=katman]:not(:checked)")].map((x) => x.dataset.katman) };
  } else govde = { gorunur: e.target.checked };
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
  if (buton.dataset.is === "renk") {
    return renkPaletiAc(buton, {
      anahtar: `alan-${id}`, renk: ref.veri.renk,
      sec: (renk) => {
        gorselDegistir(id, { renk });
        document.querySelector(`#referansListe li[data-id="${id}"] [data-is=renk]`)?.focus();
      },
      daha: () => { gorselAlan = id; sekmeAc("gorsel"); },
    });
  }
  if (buton.dataset.is !== "sil") return;
  if (!(await onayla(`"${ref.veri.ad}" alanı kaldırılsın mı? Dosyanın kendisi silinmez, parseller listede kalır.`, "Kaldır"))) return;
  try {
    await postJson(`referanslar/${id}/sil`, {});
    referansKaldir(id);
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
$("taramaButce").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); });
$("taramaButce").addEventListener("change", (e) => {
  e.target.value = Math.max(1, Math.min(200, Number(e.target.value) || 10));
});

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
  if (durum.mod?.startsWith("not-")) notModu(null);
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
  if (durum.mod?.startsWith("not-") && e.key === "Escape") return notModu(null);
  if (durum.mod !== "cizim" || e.target.matches("input, select, textarea")) return;
  if (e.key === "Escape") cizimIptal();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); cizimGeriAl(); }
  // preventDefault: yoksa aynı Enter, açılan ad penceresindeki kutuya da gidip pencereyi hemen kapatıyor.
  else if (e.key === "Enter") { e.preventDefault(); cizimBitir(); }
});

// ---- ipucu: tarayıcının title kutusu yerine ---------------------------------------
// title'lar ilk üzerine gelişte data-ipucu'ya taşınır (yoksa tarayıcının kendi kutusu da çıkar).

const ipucu = { el: $("ipucu"), hedef: null, zaman: 0, hata: false };

function ipucuGoster(hedef, metin, { hata = false } = {}) {
  const el = ipucu.el;
  clearTimeout(ipucu.zaman);
  ipucu.hedef = hedef;
  ipucu.hata = hata;
  el.classList.toggle("hata", hata);
  el.setAttribute("role", hata ? "alert" : "tooltip");
  el.innerHTML = hata ? ikon("uyari") : "";
  el.append(Object.assign(document.createElement("span"), { textContent: metin }));
  el.hidden = false;
  const r = hedef.getBoundingClientRect(), b = el.getBoundingClientRect();
  const pay = parseFloat(token("--b-2"));
  const ust = r.top - b.height - pay;
  el.style.top = `${ust < pay ? r.bottom + pay : ust}px`;
  el.style.left = `${Math.min(Math.max(pay, r.left + r.width / 2 - b.width / 2), innerWidth - b.width - pay)}px`;
}

function ipucuGizle() {
  clearTimeout(ipucu.zaman);
  ipucu.el.hidden = true;
  ipucu.hedef = null;
  ipucu.hata = false;
}

function ipucuMetni(el) {
  const baslik = el.getAttribute("title");
  if (baslik !== null) {
    el.removeAttribute("title");
    el.dataset.ipucu = baslik;
    if (!el.hasAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", baslik);
  }
  return el.dataset.ipucu;
}

document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse" || ipucu.hata) return;
  const el = e.target.closest?.("[title], [data-ipucu]");
  if (!el || el === ipucu.hedef) return;
  const metin = ipucuMetni(el);
  clearTimeout(ipucu.zaman);
  if (metin) ipucu.zaman = setTimeout(() => ipucuGoster(el, metin), 450);
});
document.addEventListener("pointerout", (e) => {
  if (ipucu.hata) return;
  const el = e.target.closest?.("[data-ipucu]");
  if (el && !el.contains(e.relatedTarget)) ipucuGizle();
});
document.addEventListener("focusin", (e) => {
  const el = e.target.closest?.("[title], [data-ipucu]");
  if (ipucu.hata || !el?.matches(":focus-visible")) return;
  const metin = ipucuMetni(el);
  if (metin) ipucuGoster(el, metin);
});
document.addEventListener("focusout", () => { if (!ipucu.hata) ipucuGizle(); });
document.addEventListener("pointerdown", () => { if (!ipucu.hata) ipucuGizle(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ipucu.hata) ipucuGizle(); });
addEventListener("scroll", ipucuGizle, { capture: true, passive: true });
addEventListener("resize", ipucuGizle);

// Form alanı hatası (tarayıcının "Lütfen bu alanı doldurun" balonu yerine). Yazınca ya da çıkınca kalkar.
function alanHatasi(kutu, metin) {
  kutu.setAttribute("aria-invalid", "true");
  kutu.focus();
  kutu.select?.();
  ipucuGoster(kutu, metin, { hata: true });
  const bitir = () => {
    kutu.removeAttribute("aria-invalid");
    if (ipucu.hedef === kutu) ipucuGizle();
    kutu.removeEventListener("input", bitir);
    kutu.removeEventListener("blur", bitir);
  };
  kutu.addEventListener("input", bitir);
  kutu.addEventListener("blur", bitir);
}

// ---- arama kutularının temizle düğmesi ----------------------------------------------

document.querySelectorAll(".arama-temizle").forEach((b) => b.addEventListener("click", () => {
  const kutu = b.parentElement.querySelector("input");
  kutu.value = "";
  kutu.dispatchEvent(new Event("input", { bubbles: true }));
  kutu.focus();
}));

// ---- alan rengi paleti: tarayıcının renk seçicisi yerine ----------------------------

const ALAN_RENKLERI = [["--alan-renk-1", "Mor"], ["--alan-renk-2", "Camgöbeği"], ["--alan-renk-3", "Turuncu"],
  ["--alan-renk-4", "Yeşil"], ["--alan-renk-5", "Pembe"], ["--alan-renk-6", "Kahve"], ["--alan-renk-7", "Çivit"],
  ["--alan-renk-8", "Nane"]];
// anahtar: paleti açan öğe (aynısına tekrar tıklayınca kapanır); sec(renk): renk seçilince;
// daha: varsa "Diğer görünüm ayarları" düğmesi çıkar.
const renkPaleti = { anahtar: null, dugme: null, sec: null, daha: null };

function renkPaletiAc(dugme, { anahtar, renk: mevcut, sec, daha = null, renkler = ALAN_RENKLERI }) {
  if (renkPaleti.anahtar === anahtar) return renkPaletiKapat();
  renkPaletiKapat(false);
  const panel = $("renkPaleti");
  panel.innerHTML = renkler.map(([ad, isim]) => {
    const renk = token(ad);
    return `<button type="button" data-renk="${renk}" style="background:${renk}" aria-label="${isim}" data-ipucu="${isim}" aria-pressed="${renk.toLowerCase() === mevcut.toLowerCase()}"></button>`;
  }).join("") + (daha ? `<button type="button" class="palet-daha" data-gorsel>${ikon("gorsel")}Diğer görünüm ayarları</button>` : "");
  Object.assign(renkPaleti, { anahtar, dugme, sec, daha });
  panel.hidden = false;
  const r = dugme.getBoundingClientRect(), b = panel.getBoundingClientRect();
  const pay = parseFloat(token("--b-2"));
  const ust = r.bottom + pay;
  panel.style.top = `${ust + b.height > innerHeight - pay ? r.top - b.height - pay : ust}px`;
  panel.style.left = `${Math.min(Math.max(pay, r.left - pay), innerWidth - b.width - pay)}px`;
  dugme.setAttribute("aria-expanded", "true");
  (panel.querySelector("[aria-pressed=true]") || panel.firstElementChild).focus();
}

function renkPaletiKapat(odakGeri = true) {
  if (renkPaleti.anahtar === null) return;
  $("renkPaleti").hidden = true;
  const dugme = renkPaleti.dugme;
  Object.assign(renkPaleti, { anahtar: null, dugme: null, sec: null, daha: null });
  if (!dugme.isConnected) return;
  dugme.setAttribute("aria-expanded", "false");
  if (odakGeri) dugme.focus();
}

$("renkPaleti").addEventListener("click", (e) => {
  const { sec, daha } = renkPaleti;
  const secilen = e.target.closest("button[data-renk]");
  if (!secilen && !e.target.closest("[data-gorsel]")) return;
  renkPaletiKapat(false);
  secilen ? sec(secilen.dataset.renk) : daha();
});
$("renkPaleti").addEventListener("keydown", (e) => {
  const dugmeler = [...$("renkPaleti").children];
  const i = dugmeler.indexOf(document.activeElement);
  const adim = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
  if (e.key === "Escape") { e.preventDefault(); renkPaletiKapat(); }
  else if (adim && i >= 0) { e.preventDefault(); dugmeler[Math.min(dugmeler.length - 1, Math.max(0, i + adim))].focus(); }
});
document.addEventListener("pointerdown", (e) => {
  if (renkPaleti.anahtar !== null && !e.target.closest("#renkPaleti, [data-is=renk]")) renkPaletiKapat(false);
});
document.querySelector(".cekmece-govde").addEventListener("scroll", () => renkPaletiKapat(false), { passive: true });
addEventListener("resize", () => renkPaletiKapat(false));

// ================================================================================
// Görsel: alanların görünümü ve katman sırası
// ================================================================================
// Ayarların doğrulanması ve varsayılanları sunucudadır (referans.GORSEL); her alan kendi ayarlarıyla gelir.
// Değişiklik önce haritaya uygulanır, sunucuya kısa bir beklemeden sonra yazılır: kaydırıcı sürüklenirken
// her adımda istek gitmez, harita da beklemeden tepki verir.

let gorselAlan = null; // Görsel sekmesinde düzenlenen alan
const ozel = { h: 0, s: 1, v: 1 }; // özel renk seçicinin durumu (ton, doygunluk, parlaklık)
const surukleme = siralanabilir($("katmanSirasi"), siraOku);

const DESENLER = [["yok", "Yok"], ["dolu", "Dolu"], ["capraz", "Çapraz"], ["ters", "Ters çapraz"], ["yatay", "Yatay"],
  ["dikey", "Dikey"], ["kareli", "Kareli"], ["capraz-kareli", "Çapraz kareli"], ["nokta", "Noktalı"]];
const DESEN_ADI = Object.fromEntries(DESENLER);
const CIZGI_ADI = { duz: "Düz", kesik: "Kesik", nokta: "Noktalı" };
const kalinlikMetni = (k) => (k ? `${String(k).replace(".", ",")} px` : "Çizgisiz");

$("gorselRenkler").innerHTML = ALAN_RENKLERI.map(([ad, isim]) => {
  const renk = token(ad);
  return `<button type="button" data-renk="${renk}" style="--ornek:${renk}" aria-label="${isim}" data-ipucu="${isim}" aria-pressed="false"></button>`;
}).join("") + `<button type="button" class="ozel" data-renk="ozel" aria-label="Özel renk" data-ipucu="Özel renk" aria-pressed="false" aria-expanded="false" aria-controls="ozelRenk"></button>`;

$("gorselDesenler").innerHTML = DESENLER.map(([deger, ad]) => `
  <label class="desen-karo"><input type="radio" name="desen" value="${deger}">
    <svg viewBox="0 0 44 28" aria-hidden="true"><rect x="1.5" y="1.5" width="41" height="25" rx="5" stroke-width="1.5" data-onizleme="${deger}"/></svg>
    <span>${ad}</span></label>`).join("");

// Katman listesindeki küçük örnek: alanın gerçek rengi, çizgisi ve taraması.
function katmanOrnegi(r) {
  const g = r.gorsel;
  const dolgu = g.desen === "yok" ? `fill="none"`
    : g.desen === "dolu" ? `fill="${esc(r.renk)}" fill-opacity="${g.opaklik / 100}"`
    : `fill="${desenYaz(`ornek-${r.id}`, r.renk, g)}"`;
  const k = g.kalinlik ? Math.min(Math.max(g.kalinlik, 1), 3) : 0;
  const dizi = { kesik: ` stroke-dasharray="4 3"`, nokta: ` stroke-dasharray="0 3.5"` }[g.cizgi] || "";
  const kenar = k ? `stroke="${esc(r.renk)}" stroke-width="${k}" stroke-linecap="round"${dizi}` : `stroke="none"`;
  return `<svg class="katman-ornek" viewBox="0 0 32 22" aria-hidden="true"><rect x="2" y="2" width="28" height="18" rx="3" ${dolgu} ${kenar}/></svg>`;
}

// Seçili katman yoksa (ya da silindiyse) üzerinde çalışılan alan, o da yoksa listedeki ilk katman seçilir.
function katmanSirasiCiz() {
  if (surukleme.li) return; // sürükleme bitince çizilir
  const liste = katmanSirasi.filter((id) => referanslar.has(id) || notlar.has(id));
  if (!notlar.has(seciliNot) && !referanslar.has(gorselAlan)) {
    seciliNot = null;
    gorselAlan = referanslar.has(aktifAlan) ? aktifAlan : liste.find((id) => referanslar.has(id)) ?? null;
    if (!gorselAlan) seciliNot = liste.find((id) => notlar.has(id)) ?? null;
    gorselDuzenDoldur();
    notDuzenDoldur();
  }
  $("katmanAdet").textContent = liste.length;
  $("gorselBos").hidden = liste.length > 0;
  $("katmanIpucu").hidden = liste.length < 2;
  const gorunenler = liste.filter((id) => referanslar.has(id)).map((id) => referanslar.get(id).veri).filter((r) => r.gorunur);
  $("adlarHepsi").hidden = !gorunenler.length;
  $("adlarHepsi").lastElementChild.textContent = gorunenler.some((r) => r.gorsel.etiket) ? "Adları gizle" : "Adları göster";
  $("katmanSirasi").innerHTML = liste.map((id) => {
    if (notlar.has(id)) return notSatiri(notlar.get(id));
    const r = referanslar.get(id).veri, g = r.gorsel, secili = id === gorselAlan;
    const kenar = g.kalinlik ? `${CIZGI_ADI[g.cizgi]} ${kalinlikMetni(g.kalinlik)}` : "Çizgisiz";
    const ozet = r.gorunur ? `${kenar} · ${DESEN_ADI[g.desen]}` : "Haritada gizli";
    return `
    <li data-id="${id}" class="${secili ? "secili" : ""}${r.gorunur ? "" : " gizli"}">
      <button type="button" class="tutamac" aria-label="${esc(r.ad)} katmanını taşı" title="Sürükle ya da yukarı/aşağı okla taşı">${ikon("tutamac")}</button>
      ${katmanOrnegi(r)}
      <button type="button" class="ad" data-is="duzenle" aria-pressed="${secili}" title="${secili ? "Alana git" : "Görünümünü düzenle"}">${esc(r.ad)}<small>${esc(ozet)}</small></button>
      <button type="button" class="ikon-dugme" data-is="etiket" aria-pressed="${g.etiket}" aria-label="${esc(r.ad)} adı haritada" title="Adı haritada göster ya da gizle"${r.gorunur ? "" : " disabled"}>${ikon("etiket")}</button>
      <label class="ikon-dugme gorunur-anahtar" title="Haritada göster ya da gizle">
        <input type="checkbox" data-is="gorunur" ${r.gorunur ? "checked" : ""} aria-label="${esc(r.ad)} haritada görünsün">${ikon("goz", "ikon acik")}${ikon("goz-kapali", "ikon kapali")}
      </label>
    </li>`;
  }).join("");
  lejantCiz();
  lejantDuzenCiz();
}

function notSatiri(n) {
  const secili = n.id === seciliNot;
  const ozet = !n.gorunur ? "Haritada gizli" : n.tur === "yazi" ? `Yazı · ${n.boyut} px` : n.tur === "ok" ? `Ok · ${kalinlikMetni(n.kalinlik)}`
    : n.tur === "gorsel" ? `${n.pdf ? `PDF · sayfa ${n.sayfa}` : "Görsel"} · %${n.opaklik}`
    : n.tur === "grafik" ? `Dilim grafiği · ${n.veri.dilimler.length} dilim` : `Tablo · ${n.sayfalar[n.sayfa].satirlar.length} satır`;
  return `
    <li data-id="${n.id}" class="${secili ? "secili" : ""}${n.gorunur ? "" : " gizli"}">
      <button type="button" class="tutamac" aria-label="${esc(notAdi(n))} katmanını taşı" title="Sürükle ya da yukarı/aşağı okla taşı">${ikon("tutamac")}</button>
      ${notOrnegi(n)}
      <button type="button" class="ad" data-is="duzenle" aria-pressed="${secili}" title="${secili ? "Haritada göster" : "Düzenle"}">${esc(notAdi(n))}<small>${esc(ozet)}</small></button>
      <span class="dugme-yeri" aria-hidden="true"></span>
      <label class="ikon-dugme gorunur-anahtar" title="Haritada göster ya da gizle">
        <input type="checkbox" data-is="gorunur" ${n.gorunur ? "checked" : ""} aria-label="${esc(notAdi(n))} haritada görünsün">${ikon("goz", "ikon acik")}${ikon("goz-kapali", "ikon kapali")}
      </label>
    </li>`;
}

function gorselDuzenDoldur(kaynak = null) {
  const ref = referanslar.get(gorselAlan);
  $("gorselDuzen").hidden = !ref;
  if (!ref) return;
  const { renk, ad, gorsel: g } = ref.veri;
  $("gorselBaslik").textContent = ad;
  $("gorselBaslikRenk").style.background = renk;
  const dugmeler = [...$("gorselRenkler").children];
  const hazir = dugmeler.find((b) => b.dataset.renk.toLowerCase() === renk.toLowerCase());
  dugmeler.forEach((b) => b.setAttribute("aria-pressed", b === hazir));
  const ozelDugme = $("gorselRenkler").querySelector(".ozel");
  ozelDugme.setAttribute("aria-pressed", !hazir);
  ozelDugme.style.setProperty("--ornek", hazir ? "transparent" : renk);
  if (kaynak !== "ozel") ozelRenkEsitle(renk);

  $("gorselKalinlik").value = g.kalinlik;
  $("gorselKalinlikDeger").textContent = kalinlikMetni(g.kalinlik);
  document.querySelectorAll("input[name=cizgi]").forEach((x) => { x.checked = x.value === g.cizgi; x.disabled = !g.kalinlik; });

  document.querySelectorAll("input[name=desen]").forEach((x) => { x.checked = x.value === g.desen; });
  $("gorselDesenler").querySelectorAll("[data-onizleme]").forEach((sekil) => {
    const d = sekil.dataset.onizleme;
    sekil.setAttribute("stroke", renk);
    sekil.setAttribute("fill", d === "yok" ? "none" : d === "dolu" ? renk : desenYaz(`onizleme-${d}`, renk, { desen: d, aralik: 6, opaklik: 90 }));
    sekil.setAttribute("fill-opacity", d === "dolu" ? 0.45 : 1);
  });
  $("gorselAralik").value = g.aralik;
  $("gorselAralikDeger").textContent = `${g.aralik} px`;
  $("gorselAralik").disabled = g.desen === "yok" || g.desen === "dolu";
  $("gorselOpaklik").value = g.opaklik;
  $("gorselOpaklikDeger").textContent = `%${g.opaklik}`;
  $("gorselOpaklik").disabled = g.desen === "yok";
  $("gorselEtiket").checked = g.etiket;
  for (const id of ["gorselKalinlik", "gorselAralik", "gorselOpaklik"]) kaydiriciDoldur($(id));
}

// Kaydırıcının dolu kısmı; çubuğun kendisi CSS'te çizilir.
function kaydiriciDoldur(k) {
  k.style.setProperty("--dolum", `${(100 * (k.value - k.min)) / (k.max - k.min)}%`);
}

function gorselDegistir(id, { renk, ...ayar }, kaynak = null) {
  const ref = referanslar.get(id);
  if (!ref) return;
  const r = ref.veri;
  if (renk) r.renk = renk;
  r.gorsel = { ...r.gorsel, ...ayar };
  ref.katman.setStyle(referansStili(r));
  if (renk || "etiket" in ayar) {
    ref.etiket?.remove();
    ref.etiket = alanAdiIsareti(r);
    sirayiUygula();
  }
  renk ? referansListeCiz() : katmanSirasiCiz(); // renk Alan sekmesindeki listede de görünür
  if (id === gorselAlan) gorselDuzenDoldur(kaynak);
  gorselKaydet(id);
}

// İstekler sırayla gider; sonuncusu en son yazılır. Hata olursa sunucudaki hali geri yüklenir.
function gorselKaydet(id) {
  clearTimeout(gorselKayit.bekleyen.get(id));
  const zamanlayici = setTimeout(() => {
    gorselKayit.kuyruk = gorselKayit.kuyruk.then(async () => {
      const ref = referanslar.get(id);
      let hata = null;
      try {
        if (ref) await postJson(`referanslar/${id}/guncelle`, { renk: ref.veri.renk, gorsel: ref.veri.gorsel });
      } catch (e) { hata = e; }
      if (gorselKayit.bekleyen.get(id) === zamanlayici) gorselKayit.bekleyen.delete(id);
      if (!hata || !referanslar.has(id)) return;
      mesaj(hata.message, true);
      await referansTazele(id).catch(() => {});
      referansListeCiz();
      gorselDuzenDoldur();
    });
  }, 350);
  gorselKayit.bekleyen.set(id, zamanlayici);
}

// ---- renk: hazır renkler ve özel renk seçici ----------------------------------------

function hsvHex({ h, s, v }) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

// Gri tonlarda ton belirsizdir; seçicideki ton kaybolmasın diye eskisi kalır.
function hexHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const v = Math.max(r, g, b), c = v - Math.min(r, g, b);
  const h = !c ? ozel.h : 60 * (v === r ? ((g - b) / c + 6) % 6 : v === g ? (b - r) / c + 2 : (r - g) / c + 4);
  return { h: Math.round(h) % 360, s: v ? c / v : 0, v };
}

function ozelCiz(hex) {
  const alan = $("ozelAlan");
  alan.style.setProperty("--ton", `hsl(${ozel.h} 100% 50%)`);
  alan.style.setProperty("--x", `${ozel.s * 100}%`);
  alan.style.setProperty("--y", `${(1 - ozel.v) * 100}%`);
  alan.style.setProperty("--secilen", hex);
  alan.setAttribute("aria-valuenow", Math.round(ozel.s * 100));
  alan.setAttribute("aria-valuetext", `Doygunluk %${Math.round(ozel.s * 100)}, parlaklık %${Math.round(ozel.v * 100)}`);
  $("ozelTon").value = ozel.h;
  if (document.activeElement !== $("ozelHex")) $("ozelHex").value = hex;
}

function ozelRenkEsitle(hex) {
  Object.assign(ozel, hexHsv(hex));
  ozelCiz(hex);
}

function ozelUygula() {
  const hex = hsvHex(ozel);
  ozelCiz(hex);
  if (gorselAlan) gorselDegistir(gorselAlan, { renk: hex }, "ozel");
}

$("gorselRenkler").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-renk]");
  if (!b || !gorselAlan) return;
  if (b.dataset.renk !== "ozel") return gorselDegistir(gorselAlan, { renk: b.dataset.renk });
  const ac = $("ozelRenk").hidden;
  $("ozelRenk").hidden = !ac;
  b.setAttribute("aria-expanded", ac);
  if (ac) ozelRenkEsitle(referanslar.get(gorselAlan).veri.renk);
});

function ozelAlandan(e) {
  const k = $("ozelAlan").getBoundingClientRect();
  if (!k.width || !k.height) return; // seçici kapalıyken boyu sıfır
  ozel.s =Math.min(1, Math.max(0, (e.clientX - k.left) / k.width));
  ozel.v = 1 - Math.min(1, Math.max(0, (e.clientY - k.top) / k.height));
  ozelUygula();
}
$("ozelAlan").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  e.currentTarget.focus();
  ozelAlandan(e);
});
$("ozelAlan").addEventListener("pointermove", (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) ozelAlandan(e); });
$("ozelAlan").addEventListener("keydown", (e) => {
  const adim = e.shiftKey ? 0.1 : 0.02;
  const [ad, fark] = { ArrowLeft: ["s", -adim], ArrowRight: ["s", adim], ArrowDown: ["v", -adim], ArrowUp: ["v", adim] }[e.key] || [];
  if (!ad) return;
  e.preventDefault();
  ozel[ad] = Math.min(1, Math.max(0, ozel[ad] + fark));
  ozelUygula();
});
$("ozelTon").addEventListener("input", (e) => { ozel.h = Number(e.target.value); ozelUygula(); });
$("ozelHex").addEventListener("input", (e) => {
  const m = e.target.value.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m || !gorselAlan) return;
  const hex = `#${m[1].toLowerCase()}`;
  ozelRenkEsitle(hex);
  gorselDegistir(gorselAlan, { renk: hex }, "ozel");
});
// Yarım kalan ya da hatalı kod, kutudan çıkınca geçerli renge döner.
$("ozelHex").addEventListener("change", (e) => {
  const ref = referanslar.get(gorselAlan);
  if (ref) e.target.value = ref.veri.renk;
});

// ---- çizgi, tarama, ad -------------------------------------------------------------

for (const [id, ayar] of [["gorselKalinlik", "kalinlik"], ["gorselAralik", "aralik"], ["gorselOpaklik", "opaklik"]]) {
  $(id).addEventListener("input", (e) => { if (gorselAlan) gorselDegistir(gorselAlan, { [ayar]: Number(e.target.value) }); });
}
document.querySelectorAll("input[name=cizgi]").forEach((x) => x.addEventListener("change", () => {
  if (gorselAlan) gorselDegistir(gorselAlan, { cizgi: x.value });
}));
$("gorselDesenler").addEventListener("change", (e) => {
  if (e.target.name === "desen" && gorselAlan) gorselDegistir(gorselAlan, { desen: e.target.value });
});
$("gorselEtiket").addEventListener("change", (e) => { if (gorselAlan) gorselDegistir(gorselAlan, { etiket: e.target.checked }); });

// Varsayılanlar sunucuda: boş görünüm gönderilir, sunucu varsayılanla doldurup döndürür.
$("gorselVarsayilan").addEventListener("click", () => {
  const id = gorselAlan;
  if (!id) return;
  clearTimeout(gorselKayit.bekleyen.get(id));
  gorselKayit.bekleyen.delete(id);
  gorselKayit.kuyruk = gorselKayit.kuyruk.then(async () => {
    try {
      referansCiz(await postJson(`referanslar/${id}/guncelle`, { gorsel: {} }));
      referansListeCiz();
      if (id === gorselAlan) gorselDuzenDoldur();
    } catch (err) { mesaj(err.message, true); }
  });
});

// ---- katman listesi: seçme, ad ve görünürlük, sıralama ---------------------------------

$("katmanSirasi").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-is]");
  if (!b) return;
  const id = kimlik(b.closest("li").dataset.id);
  if (notlar.has(id)) {
    if (id === seciliNot) return notaYaklas(notlar.get(id));
    notSec(id);
  } else if (b.dataset.is === "etiket") gorselDegistir(id, { etiket: b.getAttribute("aria-pressed") !== "true" });
  else if (id === gorselAlan) return alanaYaklas(id);
  else {
    const onceki = notlar.get(seciliNot);
    seciliNot = null;
    if (onceki) notCiz(onceki);
    gorselAlan = id;
    katmanSirasiCiz();
    gorselDuzenDoldur();
    notDuzenDoldur();
  }
  document.querySelector(`#katmanSirasi li[data-id="${id}"] [data-is="${b.dataset.is}"]`)?.focus();
});

$("katmanSirasi").addEventListener("change", async (e) => {
  if (e.target.dataset.is !== "gorunur") return;
  const id = kimlik(e.target.closest("li").dataset.id);
  if (notlar.has(id)) {
    notGuncelle(id, { gorunur: e.target.checked });
    return document.querySelector(`#katmanSirasi li[data-id="${id}"] [data-is=gorunur]`)?.focus();
  }
  try {
    referansCiz(await postJson(`referanslar/${id}/guncelle`, { gorunur: e.target.checked }));
    referansListeCiz();
    document.querySelector(`#katmanSirasi li[data-id="${id}"] [data-is=gorunur]`)?.focus();
  } catch (err) { mesaj(err.message, true); }
});

$("adlarHepsi").addEventListener("click", () => {
  const gorunenler = katmanSirasi.map((id) => referanslar.get(id)?.veri).filter((r) => r?.gorunur);
  const ac = !gorunenler.some((r) => r.gorsel.etiket);
  gorunenler.forEach((r) => gorselDegistir(r.id, { etiket: ac }));
});

$("alanSekmesineGit").addEventListener("click", () => sekmeAc("alan"));

function siraOku() {
  const yeni = [...$("katmanSirasi").children].map((li) => kimlik(li.dataset.id));
  katmanSirasi.splice(0, katmanSirasi.length, ...yeni, ...katmanSirasi.filter((id) => !yeni.includes(id)));
  sirayiUygula();
}

// Tutamaçtan sürükleyerek ya da yukarı/aşağı okla sıralanan liste (katmanlar, lejant öğeleri).
// Yer değiştiren komşu öğedir; sürüklenen öğe DOM'da kalır, yoksa işaretçi yakalaması kopar.
// Dönen nesnenin li'si sürükleme sürerken doludur; liste o arada yeniden çizilmez.
function siralanabilir(liste, degisti) {
  const s = { li: null, y: 0 };
  liste.addEventListener("pointerdown", (e) => {
    const tutamac = e.target.closest(".tutamac");
    if (!tutamac || e.button !== 0) return;
    e.preventDefault();
    liste.setPointerCapture(e.pointerId);
    s.li = tutamac.closest("li");
    s.y = e.clientY;
    s.li.classList.add("suruklenen");
  });
  liste.addEventListener("pointermove", (e) => {
    if (!s.li) return;
    let fark = e.clientY - s.y;
    const komsu = fark > 0 ? s.li.nextElementSibling : s.li.previousElementSibling;
    if (komsu && Math.abs(fark) > komsu.offsetHeight / 2) {
      const once = s.li.offsetTop;
      fark > 0 ? s.li.before(komsu) : s.li.after(komsu);
      s.y += s.li.offsetTop - once;
      fark = e.clientY - s.y;
      degisti();
    }
    s.li.style.transform = `translateY(${fark}px)`;
  });
  const bitti = () => {
    if (!s.li) return;
    s.li.classList.remove("suruklenen");
    s.li.style.transform = "";
    s.li = null;
  };
  liste.addEventListener("pointerup", bitti);
  liste.addEventListener("pointercancel", bitti);
  liste.addEventListener("keydown", (e) => {
    const tutamac = e.target.closest(".tutamac");
    if (!tutamac || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const li = tutamac.closest("li");
    const komsu = e.key === "ArrowUp" ? li.previousElementSibling : li.nextElementSibling;
    if (!komsu) return;
    e.key === "ArrowUp" ? li.after(komsu) : li.before(komsu);
    degisti();
  });
  return s;
}

// ================================================================================
// Lejant: haritadaki açıklama kutusu; öğeleri kullanıcı seçer, adlandırır, sıralar
// ================================================================================
// Tercih tarayıcıda saklanır. Alanlar sayfa açılışında sıfırlandığı için önceki oturumun alan öğeleri
// atılır; parsel, boşluk ve özel öğeler kalır. Alan öğesinin örneği alanın güncel görünümünü izler.

function sekilOrnegi(sekil, renk, { dolgu = 0.25, kalinlik = 2, dizi = "" } = {}) {
  const kenar = `stroke="${esc(renk)}" stroke-width="${kalinlik}"${dizi ? ` stroke-dasharray="${dizi}"` : ""}`;
  const ic = sekil === "cizgi" ? `<path d="M3 16C9 16 10 6 16 6s8 10 13 10" fill="none" ${kenar} stroke-linecap="round"/>`
    : sekil === "nokta" ? `<circle cx="16" cy="11" r="5.5" fill="${esc(renk)}" fill-opacity="${dolgu}" ${kenar}/>`
    : `<rect x="2" y="2" width="28" height="18" rx="3" fill="${esc(renk)}" fill-opacity="${dolgu}" ${kenar}/>`;
  return `<svg class="katman-ornek" viewBox="0 0 32 22" aria-hidden="true">${ic}</svg>`;
}

const LEJANT_SABIT = {
  parsel: { ad: "Parsel", ornek: () => sekilOrnegi("alan", HR.parsel, { dolgu: 0.15, kalinlik: 1.5 }) },
  secili: { ad: "Seçili parsel", ornek: () => sekilOrnegi("alan", HR.secili, { dolgu: 0.3 }) },
  bosluk: { ad: "Sorgulanmamış boşluk", ornek: () => sekilOrnegi("alan", HR.bosluk, { dolgu: 0.14, kalinlik: 1.5, dizi: "3 3" }) },
  taranan: { ad: "Parsel çıkmayan nokta", ornek: () => sekilOrnegi("nokta", HR.taranan, { kalinlik: 1, dizi: "2 2" }) },
};
const OZEL_SEKIL = { alan: { dolgu: 0.3 }, cizgi: { kalinlik: 3 }, nokta: { dolgu: 0.9, kalinlik: 1.5 } };

const lejant = { acik: false, daralt: false, baslik: "Lejant", ogeler: [] };
try {
  const kayitli = JSON.parse(localStorage.getItem("lejant") || "{}");
  if (kayitli && typeof kayitli === "object") Object.assign(lejant, kayitli);
} catch { /* bozuk kayıt: varsayılan */ }
lejant.baslik = String(lejant.baslik ?? "");
lejant.ogeler = (Array.isArray(lejant.ogeler) ? lejant.ogeler : []).filter((o) => o && (Object.hasOwn(LEJANT_SABIT, o.tur)
  || (o.tur === "nitelik" && typeof o.nitelik === "string")
  || (o.tur === "ozel" && typeof o.k === "string" && typeof o.ad === "string" && /^#[0-9a-f]{6}$/i.test(o.renk) && Object.hasOwn(OZEL_SEKIL, o.sekil))));

function lejantKaydet() {
  try { localStorage.setItem("lejant", JSON.stringify(lejant)); } catch { /* tercih saklanamazsa önemli değil */ }
}

// Öğe türleri: alan, not (ok), ozel ve LEJANT_SABIT'teki hazır öğeler.
const ogeAnahtari = (o) => (o.tur === "alan" || o.tur === "not" ? `${o.tur}-${o.id}` : o.tur === "ozel" ? o.k
  : o.tur === "nitelik" ? `nitelik-${o.nitelik}` : o.tur);
const lejantAlani = (o) => referanslar.get(o.id)?.veri;
const lejantGecerli = (o) => (o.tur === "alan" ? referanslar.has(o.id) : o.tur === "not" ? notlar.has(o.id) : true);
const lejantGorunur = (o) => (o.tur === "alan" ? lejantAlani(o).gorunur : o.tur === "not" ? notlar.get(o.id).gorunur
  : o.tur === "nitelik" ? nitelikRenk.acik : true); // nitelik renkleri kapalıyken lejantta da yok
const lejantVarsayilanAdi = (o) => (o.tur === "alan" ? lejantAlani(o).ad : o.tur === "not" ? notAdi(notlar.get(o.id))
  : o.tur === "ozel" ? "Özel öğe" : o.tur === "nitelik" ? o.nitelik : LEJANT_SABIT[o.tur].ad);
const lejantAdi = (o) => o.ad ?? lejantVarsayilanAdi(o);

function lejantOrnegi(o) {
  if (o.tur === "alan") return katmanOrnegi(lejantAlani(o));
  if (o.tur === "not") return notOrnegi(notlar.get(o.id));
  if (o.tur === "ozel") return sekilOrnegi(o.sekil, o.renk, OZEL_SEKIL[o.sekil]);
  if (o.tur === "nitelik") return sekilOrnegi("alan", nitelikRengi(o.nitelik), { dolgu: 0.45, kalinlik: 1.5 });
  return LEJANT_SABIT[o.tur].ornek();
}

// Haritadaki kutu. Haritada gizli alan lejantta da görünmez.
function lejantCiz() {
  const ogeler = lejant.ogeler.filter((o) => lejantGecerli(o) && lejantGorunur(o));
  $("lejant").hidden = !lejant.acik || !ogeler.length;
  $("lejant").classList.toggle("dar", !!lejant.daralt);
  $("lejantUst").setAttribute("aria-expanded", !lejant.daralt);
  $("lejantBaslik").textContent = lejant.baslik.trim() || "Lejant";
  $("lejantListe").innerHTML = ogeler.map((o) => `<li>${lejantOrnegi(o)}<span>${esc(lejantAdi(o))}</span></li>`).join("");
}

let lejantEklenebilir = [];

// Görsel sekmesindeki düzenleyici. Yeniden çizilirken yazılan ad kutusunun odağı ve imleci korunur.
function lejantDuzenCiz() {
  if (lejantSurukleme.li) return;
  const ogeler = lejant.ogeler.filter(lejantGecerli);
  $("lejantAcik").checked = lejant.acik;
  if (document.activeElement !== $("lejantBaslikGirdi")) $("lejantBaslikGirdi").value = lejant.baslik;
  $("lejantBos").hidden = ogeler.length > 0;
  const odak = document.activeElement?.closest?.("#lejantOgeleri [data-is]");
  const odakK = odak?.closest("li").dataset.k, odakIs = odak?.dataset.is, imlec = odak?.selectionStart;
  $("lejantOgeleri").innerHTML = ogeler.map((o) => {
    const ad = lejantAdi(o);
    const gizli = !lejantGorunur(o);
    const ornek = o.tur === "ozel"
      ? `<button type="button" class="ornek-dugme" data-is="renk" aria-label="${esc(ad)} rengi" title="Rengi değiştir">${lejantOrnegi(o)}</button>`
      : lejantOrnegi(o);
    return `
    <li data-k="${esc(ogeAnahtari(o))}"${gizli ? ` class="gizli" title="Haritada gizli; lejantta da görünmez"` : ""}>
      <button type="button" class="tutamac" aria-label="${esc(ad)} öğesini taşı" title="Sürükle ya da yukarı/aşağı okla taşı">${ikon("tutamac")}</button>
      ${ornek}
      <input class="oge-ad" data-is="ad" value="${esc(ad)}" placeholder="${esc(lejantVarsayilanAdi(o))}" maxlength="60" autocomplete="off" spellcheck="false" aria-label="Lejanttaki adı">
      <button type="button" class="ikon-dugme" data-is="cikar" aria-label="${esc(ad)} lejanttan çıkar" title="Lejanttan çıkar">${ikon("kapat")}</button>
    </li>`;
  }).join("");
  if (odakK) {
    const el = $("lejantOgeleri").querySelector(`li[data-k="${CSS.escape(odakK)}"] [data-is="${odakIs}"]`);
    el?.focus();
    if (imlec != null) el?.setSelectionRange?.(imlec, imlec);
  }
  lejantEklenebilir = [
    ...katmanSirasi.filter((id) => (referanslar.has(id) || notlar.get(id)?.tur === "ok") && !lejant.ogeler.some((o) => o.id === id))
      .map((id) => ({ tur: referanslar.has(id) ? "alan" : "not", id })),
    ...Object.keys(LEJANT_SABIT).filter((tur) => !lejant.ogeler.some((o) => o.tur === tur)).map((tur) => ({ tur })),
    // Nitelik renkleri açıkken listedeki nitelikler
    ...(nitelikRenk.acik ? [...new Set([...durum.parseller.values()].map((f) => nitelikAdi(f.properties)))]
      .filter((n) => !lejant.ogeler.some((o) => o.tur === "nitelik" && o.nitelik === n)).map((nitelik) => ({ tur: "nitelik", nitelik })) : []),
  ];
  $("lejantCipler").innerHTML = lejantEklenebilir.map((o, i) =>
    `<button type="button" class="cip" data-i="${i}" title="Lejanta ekle">${lejantOrnegi(o)}<span>${esc(lejantAdi(o))}</span>${ikon("arti")}</button>`).join("")
    || `<span class="ikincil-metin">Haritadakilerin hepsi lejantta.</span>`;
}

function lejantDegisti() {
  lejantKaydet();
  lejantCiz();
  lejantDuzenCiz();
}

// Yeni alan, lejant açıksa kendiliğinden eklenir (istenmezse çıkarılır).
function lejantaAlanEkle(id) {
  if (!lejant.acik || lejant.ogeler.some((o) => o.tur === "alan" && o.id === id)) return;
  lejant.ogeler.push({ tur: "alan", id });
  lejantKaydet();
}

// Silinen alan ya da not lejanttan da çıkar.
function lejantAlanCikar(id) {
  const n = lejant.ogeler.length;
  lejant.ogeler = lejant.ogeler.filter((o) => o.id !== id);
  if (lejant.ogeler.length !== n) lejantKaydet();
}

const lejantOgesi = (el) => lejant.ogeler.find((o) => ogeAnahtari(o) === el.closest("li").dataset.k);

function lejantSiraOku() {
  const sira = [...$("lejantOgeleri").children].map((li) => li.dataset.k);
  lejant.ogeler.sort((a, b) => sira.indexOf(ogeAnahtari(a)) - sira.indexOf(ogeAnahtari(b)));
  lejantKaydet();
  lejantCiz();
}
const lejantSurukleme = siralanabilir($("lejantOgeleri"), lejantSiraOku);

$("lejantUst").addEventListener("click", () => {
  lejant.daralt = !lejant.daralt;
  lejantKaydet();
  lejantCiz();
});

// İlk açılışta haritadakilerle başlar: görünen alanlar ve listede parsel varsa parsel.
$("lejantAcik").addEventListener("change", (e) => {
  lejant.acik = e.target.checked;
  if (lejant.acik && !lejant.ogeler.some(lejantGecerli)) {
    lejant.ogeler = katmanSirasi.filter((id) => referanslar.get(id)?.veri.gorunur).map((id) => ({ tur: "alan", id }));
    if (durum.parseller.size) lejant.ogeler.push({ tur: "parsel" });
  }
  lejantDegisti();
});

$("lejantBaslikGirdi").addEventListener("input", (e) => {
  lejant.baslik = e.target.value;
  lejantKaydet();
  lejantCiz();
});

$("lejantCipler").addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]");
  if (!b) return;
  lejant.ogeler.push(lejantEklenebilir[Number(b.dataset.i)]);
  lejant.acik = true; // eklenen görünsün
  lejantDegisti();
  $("lejantCipler").querySelector("button")?.focus();
});

$("lejantOgeleri").addEventListener("input", (e) => {
  if (e.target.dataset.is !== "ad") return;
  const o = lejantOgesi(e.target), deger = e.target.value;
  // Alan ve hazır öğelerde boş ya da varsayılan ad, kendi adını kullanmak demek (alan adı değişirse izler).
  if (o.tur === "ozel") o.ad = deger;
  else if (!deger.trim() || deger === lejantVarsayilanAdi(o)) delete o.ad;
  else o.ad = deger;
  lejantKaydet();
  lejantCiz();
});
$("lejantOgeleri").addEventListener("change", (e) => {
  if (e.target.dataset.is !== "ad" || e.target.value.trim()) return;
  const o = lejantOgesi(e.target);
  if (o.tur === "ozel") o.ad = "Özel öğe";
  e.target.value = lejantAdi(o);
  lejantKaydet();
  lejantCiz();
});
$("lejantOgeleri").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-is]");
  if (!b) return;
  const o = lejantOgesi(b);
  if (b.dataset.is === "cikar") {
    const sonraki = b.closest("li").nextElementSibling?.dataset.k;
    lejant.ogeler.splice(lejant.ogeler.indexOf(o), 1);
    lejantDegisti();
    (sonraki && $("lejantOgeleri").querySelector(`li[data-k="${CSS.escape(sonraki)}"] [data-is=cikar]`) || $("lejantCipler").querySelector("button"))?.focus();
  } else if (b.dataset.is === "renk") {
    renkPaletiAc(b, {
      anahtar: `lejant-${o.k}`, renk: o.renk,
      sec: (renk) => {
        o.renk = renk;
        lejantDegisti();
        $("lejantOgeleri").querySelector(`li[data-k="${CSS.escape(o.k)}"] [data-is=renk]`)?.focus();
      },
    });
  }
});

// Özel öğe: haritada olmayan bir şeyi de (dere, yol, proje sınırı) açıklamak için.
const ozelOge = { renk: token(ALAN_RENKLERI[0][0]) };
$("ozelOgeRenkler").innerHTML = ALAN_RENKLERI.map(([ad, isim]) => {
  const renk = token(ad);
  return `<button type="button" data-renk="${renk}" style="--ornek:${renk}" aria-label="${isim}" data-ipucu="${isim}" aria-pressed="${renk === ozelOge.renk}"></button>`;
}).join("");
$("ozelOgeRenkler").addEventListener("click", (e) => {
  const b = e.target.closest("[data-renk]");
  if (!b) return;
  ozelOge.renk = b.dataset.renk;
  [...$("ozelOgeRenkler").children].forEach((x) => x.setAttribute("aria-pressed", x === b));
});
$("ozelOgeEkle").addEventListener("click", () => {
  const ad = $("ozelOgeAd").value.trim();
  if (!ad) return alanHatasi($("ozelOgeAd"), "Lejantta görünecek adı yaz.");
  const sekil = document.querySelector("input[name=ozelSekil]:checked").value;
  lejant.ogeler.push({ tur: "ozel", k: `ozel-${Date.now().toString(36)}`, ad, renk: ozelOge.renk, sekil });
  lejant.acik = true;
  $("ozelOgeAd").value = "";
  lejantDegisti();
});
$("ozelOgeAd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("ozelOgeEkle").click(); }
});

// ================================================================================
// Notlar: haritaya yazı ve ok. Alanlarla aynı katman listesinde durur; sadece bu sayfa açıkken yaşar.
// ================================================================================
// Kimlikleri "n1", "n2"... (alanlarınki sayı). Görsel sekmesi açıkken tıklanır ve sürüklenir; diğer
// sekmelerde tıklamayı haritaya bırakır.

const notlar = new Map();
let notSayac = 0;
let seciliNot = null; // Görsel sekmesinde düzenlenen not
const okTaslak = { bas: null, cizgi: null };
const gorselSekmesinde = () => !$("panel-gorsel").hidden;
const kimlik = (s) => (/^\d+$/.test(s) ? Number(s) : s);

const NOT_RENKLERI = [["--not-beyaz", "Beyaz"], ["--not-siyah", "Siyah"], ...ALAN_RENKLERI];
const acikRenk = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b > 150; };
const notAdi = (n) => n.ad || (n.tur === "yazi" ? n.metin.split("\n")[0].slice(0, 40) || "Yazı"
  : { ok: "Ok", gorsel: "Görsel", tablo: "Tablo", grafik: "Grafik" }[n.tur]);

// Listede ve lejantta okun küçük örneği (uçlar elle hesaplandı: 7 boy, 7 taban).
function okOrnegi(renk, uc = "tek", cizgi = "duz") {
  const dizi = cizgi === "kesik" ? ` stroke-dasharray="4 3"` : "";
  const uclar = { tek: ["M26 5.5L21.6 12L18.2 5.9z"], cift: ["M26 5.5L21.6 12L18.2 5.9z", "M6 16.5L13.8 16.1L10.4 10z"], yok: [] }[uc];
  return `<svg class="katman-ornek" viewBox="0 0 32 22" aria-hidden="true"><path d="M8 15.4L23 7" stroke="${esc(renk)}" stroke-width="2.2" stroke-linecap="round"${dizi}/>` +
    uclar.map((d) => `<path d="${d}" fill="${esc(renk)}"/>`).join("") + "</svg>";
}

function notOrnegi(n) {
  if (n.tur === "ok") return okOrnegi(n.renk, n.uc, n.cizgi);
  if (n.tur === "gorsel") return `<img class="katman-ornek gorsel-ornek" src="${esc(n.url)}" alt="">`;
  if (n.tur === "grafik") {
    return `<svg class="katman-ornek" viewBox="0 0 32 22" aria-hidden="true"><circle cx="16" cy="11" r="7.5" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="4"/>`
      + `<path d="M16 3.5A7.5 7.5 0 0 1 23.1 13.4" fill="none" stroke="${esc(nitelikRengi(n.veri.dilimler[0].ad, "kagit"))}" stroke-width="4"/></svg>`;
  }
  if (n.tur === "tablo") {
    return `<svg class="katman-ornek" viewBox="0 0 32 22" aria-hidden="true"><rect x="2.5" y="2.5" width="27" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-opacity=".5"/>` +
      `<path d="M2.5 13.5h27M11.5 8v11.5M20.5 8v11.5" stroke="currentColor" stroke-opacity=".3"/><path d="M5 2.5h22a2.5 2.5 0 0 1 2.5 2.5v3h-27V5A2.5 2.5 0 0 1 5 2.5z" fill="${esc(n.renk)}"/></svg>`;
  }
  return `<svg class="katman-ornek" viewBox="0 0 32 22" aria-hidden="true"><rect x="2" y="2" width="28" height="18" rx="3" fill="none" stroke="currentColor" stroke-opacity=".25"/>
    <text x="16" y="15.5" text-anchor="middle" font-size="12" font-weight="700" fill="${esc(n.renk)}" stroke="${acikRenk(n.renk) ? token("--harita-yazi-hale") : "transparent"}" stroke-width="2" paint-order="stroke">Aa</text></svg>`;
}

function yaziHtml(n) {
  const acik = acikRenk(n.renk);
  const secili = n.id === seciliNot && gorselSekmesinde();
  return `<span class="harita-not ${n.stil}${n.kalin ? " kalin" : ""}${secili ? " secili" : ""}" style="--not-renk:${esc(n.renk)};--not-boyut:${n.boyut}px;` +
    `--not-hale:${acik ? "var(--harita-yazi-hale)" : "var(--not-hale-acik)"};--not-zemin:${acik ? "var(--not-zemin-koyu)" : "var(--not-zemin-acik)"}">${esc(n.metin)}</span>`;
}

// Okun ucu SVG işaretidir (marker); çizgiyle birlikte döner, kalınlıkla büyür.
function okUcuYaz(n) {
  const id = `ok-ucu-${n.id}`;
  let isaret = document.getElementById(id);
  if (!isaret) {
    isaret = svgEl("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 3.4, markerHeight: 3.4, markerUnits: "strokeWidth", orient: "auto-start-reverse" });
    isaret.append(svgEl("path", { d: "M0 0L10 5L0 10z" }));
    $("desenler").append(isaret);
  }
  isaret.firstChild.setAttribute("fill", n.renk);
  const yol = n.katman.getElement();
  if (n.uc === "yok") yol.removeAttribute("marker-end"); else yol.setAttribute("marker-end", `url(#${id})`);
  if (n.uc === "cift") yol.setAttribute("marker-start", `url(#${id})`); else yol.removeAttribute("marker-start");
}

const ortaNokta = (n) => L.latLng((n.noktalar[0][0] + n.noktalar[1][0]) / 2, (n.noktalar[0][1] + n.noktalar[1][1]) / 2);

function notCiz(n) {
  n.katman?.remove();
  n.tutamaclar?.forEach((t) => t.remove());
  n.katman = null;
  n.tutamaclar = [];
  if (n.gorunur) {
    const pane = katmanBolmesi(n.id);
    harita.getPane(pane).classList.add("not-katmani");
    harita.getPane(pane).style.mixBlendMode = n.tur === "gorsel" && n.karistir ? "multiply" : "";
    if (n.tur === "yazi" || n.tur === "tablo" || n.tur === "grafik") {
      const html = { yazi: yaziHtml, tablo: tabloHtml, grafik: grafikHtml }[n.tur](n);
      n.katman = L.marker(n.konum, {
        pane, draggable: true, keyboard: false,
        icon: L.divIcon({ className: "harita-yazi-ikon", html, iconSize: null }),
      });
      n.katman.on("dragend", () => { const p = n.katman.getLatLng(); n.konum = [p.lat, p.lng]; });
      n.katman.on("click", () => notSec(n.id));
      n.katman.on("dblclick", (e) => { L.DomEvent.stop(e); notSec(n.id); if (n.tur === "yazi") $("notMetin").focus(); });
    } else if (n.tur === "gorsel") {
      n.katman = new DonukGorsel(n, { pane });
    } else {
      n.katman = L.polyline(n.noktalar, {
        pane, color: n.renk, weight: n.kalinlik, opacity: 1, lineCap: "round", bubblingMouseEvents: false,
        dashArray: n.cizgi === "kesik" ? `${n.kalinlik * 3} ${n.kalinlik * 2.2}` : null,
      });
      n.katman.on("click", () => notSec(n.id));
    }
    n.katman.addTo(harita);
    if (n.tur === "ok") okUcuYaz(n);
    if (n.id === seciliNot && gorselSekmesinde()) tutamaclariCiz(n);
  }
  sirayiUygula();
}

// Seçili okun uçlarında ve ortasında sürüklenebilir noktalar: uçlar yönü, ortadaki yeri değiştirir.
// Görselde ortadaki nokta taşır, köşedeki büyütür ve döndürür.
function tutamaclariCiz(n) {
  if (!n.katman || n.tur === "yazi" || n.tur === "tablo" || n.tur === "grafik") return;
  const tutamac = (konum, tasi, sinif) => {
    const t = L.marker(konum, {
      draggable: true, keyboard: false, zIndexOffset: 1000,
      icon: L.divIcon({ className: `not-tutamac ${sinif}`, iconSize: [14, 14], iconAnchor: [7, 7] }),
    }).addTo(harita);
    t.on("drag", () => tasi(t.getLatLng()));
    n.tutamaclar.push(t);
    return t;
  };
  if (n.tur === "gorsel") {
    const kose = tutamac(gorselKosesi(n), (p) => { gorselKoseyeGore(n, p); n.katman.guncelle(); notDuzenDoldur(); }, "kose");
    tutamac(n.merkez, (p) => { n.merkez = [p.lat, p.lng]; n.katman.guncelle(); kose.setLatLng(gorselKosesi(n)); }, "orta");
    return;
  }
  const yenile = () => { n.katman.setLatLngs(n.noktalar); orta.setLatLng(ortaNokta(n)); };
  const bas = tutamac(n.noktalar[0], (p) => { n.noktalar[0] = [p.lat, p.lng]; yenile(); }, "uc");
  const son = tutamac(n.noktalar[1], (p) => { n.noktalar[1] = [p.lat, p.lng]; yenile(); }, "uc");
  const orta = tutamac(ortaNokta(n), (p) => {
    const o = ortaNokta(n), dLat = p.lat - o.lat, dLng = p.lng - o.lng;
    n.noktalar = n.noktalar.map(([a, b]) => [a + dLat, b + dLng]);
    n.katman.setLatLngs(n.noktalar);
    bas.setLatLng(n.noktalar[0]);
    son.setLatLng(n.noktalar[1]);
  }, "orta");
}

function notEkle(tur, ayar) {
  const id = `n${++notSayac}`;
  const n = tur === "yazi"
    ? { id, tur, ad: "", gorunur: true, metin: "Yazı", boyut: 16, renk: token("--not-beyaz"), stil: "hale", kalin: true, ...ayar }
    : { id, tur, ad: "", gorunur: true, renk: token("--alan-renk-3"), kalinlik: 3, uc: "tek", cizgi: "duz", ...ayar };
  notlar.set(id, n);
  katmanSirasi.unshift(id); // yeni katman en üste
  notCiz(n);
  notSec(id);
  return n;
}

function notSec(id) {
  const onceki = notlar.get(seciliNot);
  seciliNot = id;
  gorselAlan = null;
  if (!gorselSekmesinde()) sekmeAc("gorsel");
  if (onceki && onceki.id !== id) notCiz(onceki); // seçim çerçevesi ve tutamaçlar kalksın
  const n = notlar.get(id);
  if (n) notCiz(n);
  katmanSirasiCiz();
  gorselDuzenDoldur();
  notDuzenDoldur();
}

function notGuncelle(id, degisim) {
  const n = notlar.get(id);
  if (!n) return;
  Object.assign(n, degisim);
  notCiz(n);
  katmanSirasiCiz();
  notDuzenDoldur();
}

function notSil(id) {
  const n = notlar.get(id);
  if (!n) return;
  n.katman?.remove();
  n.tutamaclar?.forEach((t) => t.remove());
  notlar.delete(id);
  if (katmanSirasi.includes(id)) katmanSirasi.splice(katmanSirasi.indexOf(id), 1);
  document.getElementById(`ok-ucu-${id}`)?.remove();
  harita.getPane(`katman-${id}`)?.style.removeProperty("mix-blend-mode");
  if (n.tur === "gorsel") { URL.revokeObjectURL(n.url); n.pdf?.destroy(); }
  lejantAlanCikar(id);
  if (seciliNot === id) seciliNot = null;
  katmanSirasiCiz();
  notDuzenDoldur();
}

function notaYaklas(n) {
  if (n.tur === "yazi") harita.panTo(n.konum);
  else harita.fitBounds(L.latLngBounds(n.noktalar), { padding: [80, 80], maxZoom: harita.getZoom() });
}

// Görsel sekmesinden çıkınca seçim çerçevesi ve tutamaçlar gizlenir, notlar tıklanmaz olur.
function notlariSekmeyeUydur() {
  document.body.classList.toggle("gorsel-acik", gorselSekmesinde());
  if (!gorselSekmesinde()) notModu(null);
  const n = notlar.get(seciliNot);
  if (n) notCiz(n);
}

// ---- yerleştirme: "Yazı ekle" haritada bir tık, "Ok ekle" iki tık ------------------------

function notModu(tur) {
  if (tur && durum.mod === "sorgu") sorguModu(false);
  if (tur && durum.mod === "cizim") cizimIptal();
  okTaslak.cizgi?.remove();
  okTaslak.bas = okTaslak.cizgi = null;
  if (tur) durum.mod = `not-${tur}`;
  else if (durum.mod?.startsWith("not-")) durum.mod = null;
  $("yaziEkle").setAttribute("aria-pressed", tur === "yazi");
  $("okEkle").setAttribute("aria-pressed", tur === "ok");
  $("notIpucu").hidden = !tur;
  $("notIpucu").textContent = tur === "yazi" ? "Haritada yazının yerine tıkla. Vazgeçmek için Esc."
    : tur === "ok" ? "Okun başladığı yere, sonra gösterdiği yere tıkla. Vazgeçmek için Esc." : "";
  imlecGuncelle();
}

function notTikla(latlng) {
  if (durum.mod === "not-yazi") {
    notModu(null);
    notEkle("yazi", { konum: [latlng.lat, latlng.lng] });
    $("notMetin").focus();
    $("notMetin").select();
    return;
  }
  if (!okTaslak.bas) {
    okTaslak.bas = latlng;
    okTaslak.cizgi = L.polyline([latlng, latlng], { color: HR.cizim, weight: 2, dashArray: "6 5", interactive: false }).addTo(harita);
    $("notIpucu").textContent = "Şimdi okun gösterdiği yere tıkla.";
    return;
  }
  const bas = okTaslak.bas;
  notModu(null);
  notEkle("ok", { noktalar: [[bas.lat, bas.lng], [latlng.lat, latlng.lng]] });
}

harita.on("mousemove", (e) => { if (okTaslak.cizgi) okTaslak.cizgi.setLatLngs([okTaslak.bas, e.latlng]); });
$("yaziEkle").addEventListener("click", () => notModu(durum.mod === "not-yazi" ? null : "yazi"));
$("okEkle").addEventListener("click", () => notModu(durum.mod === "not-ok" ? null : "ok"));

// ---- not düzenleyici -------------------------------------------------------------------

$("notRenkler").innerHTML = NOT_RENKLERI.map(([ad, isim]) => {
  const renk = token(ad);
  return `<button type="button" data-renk="${renk}" style="--ornek:${renk}" aria-label="${isim}" data-ipucu="${isim}" aria-pressed="false"></button>`;
}).join("");

function notDuzenDoldur() {
  const n = notlar.get(seciliNot);
  $("notDuzen").hidden = !n;
  if (!n) return;
  document.querySelectorAll("#notDuzen [data-not]").forEach((el) => { el.hidden = !el.dataset.not.split(" ").includes(n.tur); });
  $("notBaslik").textContent = notAdi(n);
  [...$("notRenkler").children].forEach((b) => b.setAttribute("aria-pressed", b.dataset.renk.toLowerCase() === (n.renk || "").toLowerCase()));
  if (document.activeElement !== $("notAd")) $("notAd").value = n.ad;
  $("notAd").placeholder = notAdi({ ...n, ad: "" });
  const kaydirici = (id, deger, metin) => { $(id).value = deger; $(`${id}Deger`).textContent = metin; kaydiriciDoldur($(id)); };
  if (n.tur === "yazi") {
    if (document.activeElement !== $("notMetin")) $("notMetin").value = n.metin;
    kaydirici("notBoyut", n.boyut, `${n.boyut} px`);
    document.querySelectorAll("input[name=notStil]").forEach((x) => { x.checked = x.value === n.stil; });
    $("notKalin").checked = n.kalin;
  } else if (n.tur === "ok") {
    kaydirici("notKalinlik", n.kalinlik, kalinlikMetni(n.kalinlik));
    document.querySelectorAll("input[name=notUc]").forEach((x) => { x.checked = x.value === n.uc; });
    document.querySelectorAll("input[name=notCizgi]").forEach((x) => { x.checked = x.value === n.cizgi; });
  } else if (n.tur === "gorsel") {
    kaydirici("notOpaklik", n.opaklik, `%${n.opaklik}`);
    kaydirici("notAci", n.aci, `${String(n.aci).replace(".", ",")}°`);
    $("notKaristir").checked = n.karistir;
  } else if (n.tur === "grafik") {
    kaydirici("notGrafikBoyut", Math.round(n.boyut * 100), `%${Math.round(n.boyut * 100)}`);
  } else {
    kaydirici("notTabloBoyut", n.boyut, `${n.boyut} px`);
    $("notBaslikSatiri").checked = n.baslikSatiri;
    $("notKesildi").hidden = !n.sayfalar[n.sayfa].kesildi;
  }
  // PDF'in sayfaları ya da Excel'in çalışma sayfaları arasında gezinme
  const sayfali = (n.tur === "gorsel" && n.sayfaSayisi > 1) || (n.tur === "tablo" && n.sayfalar.length > 1);
  $("notSayfa").hidden = !sayfali;
  if (sayfali) {
    const [no, toplam, ad] = n.tur === "gorsel" ? [n.sayfa, n.sayfaSayisi, "Sayfa"] : [n.sayfa + 1, n.sayfalar.length, n.sayfalar[n.sayfa].ad];
    $("notSayfaAd").textContent = `${ad} · ${no}/${toplam}`;
    $("notSayfaGeri").disabled = no <= 1;
    $("notSayfaIleri").disabled = no >= toplam;
  }
}

$("notMetin").addEventListener("input", (e) => notGuncelle(seciliNot, { metin: e.target.value }));
$("notMetin").addEventListener("change", (e) => { if (!e.target.value.trim()) notGuncelle(seciliNot, { metin: "Yazı" }); });
$("notAd").addEventListener("input", (e) => notGuncelle(seciliNot, { ad: e.target.value.trim() }));
$("notBoyut").addEventListener("input", (e) => notGuncelle(seciliNot, { boyut: Number(e.target.value) }));
$("notKalinlik").addEventListener("input", (e) => notGuncelle(seciliNot, { kalinlik: Number(e.target.value) }));
$("notKalin").addEventListener("change", (e) => notGuncelle(seciliNot, { kalin: e.target.checked }));
for (const ad of ["notStil", "notUc", "notCizgi"]) {
  document.querySelectorAll(`input[name=${ad}]`).forEach((x) => x.addEventListener("change", () => {
    notGuncelle(seciliNot, { [{ notStil: "stil", notUc: "uc", notCizgi: "cizgi" }[ad]]: x.value });
  }));
}
$("notRenkler").addEventListener("click", (e) => {
  const b = e.target.closest("[data-renk]");
  if (b) notGuncelle(seciliNot, { renk: b.dataset.renk });
});
$("notSil").addEventListener("click", () => notSil(seciliNot));

// ---- haritaya görsel, PDF ve tablo --------------------------------------------------------

// Bu enlemde ve yakınlıkta bir ekran pikselinin metre karşılığı (Web Mercator).
const metrePiksel = (enlem) => (40075016.686 * Math.cos((enlem * Math.PI) / 180)) / (256 * 2 ** harita.getZoom());

// Haritaya oturan görsel: merkez, genişlik (metre) ve açıyla yerleşir; harita yakınlaşınca birlikte büyür.
// Yakınlaşma animasyonu sırasında gizlenir, bitince yeni ölçeğe göre yeniden konur.
const DonukGorsel = L.Layer.extend({
  initialize(n, secenek) {
    this._n = n;
    L.setOptions(this, secenek);
  },
  onAdd() {
    this._img = L.DomUtil.create("img", "harita-gorsel leaflet-zoom-hide");
    this._img.alt = "";
    this._img.draggable = false;
    this.getPane().append(this._img);
    this.guncelle();
  },
  onRemove() { this._img.remove(); },
  getEvents() { return { zoomend: this.guncelle, viewreset: this.guncelle }; },
  boyut() {
    const n = this._n, en = n.genislik / metrePiksel(n.merkez[0]);
    return { en, boy: (en * n.boy) / n.en };
  },
  guncelle() {
    if (!this._map) return;
    const n = this._n, m = this._map.latLngToLayerPoint(n.merkez), { en, boy } = this.boyut();
    if (this._img.getAttribute("src") !== n.url) this._img.src = n.url;
    Object.assign(this._img.style, {
      width: `${en}px`, height: `${boy}px`, left: `${m.x - en / 2}px`, top: `${m.y - boy / 2}px`,
      transform: `rotate(${n.aci}deg)`, opacity: n.opaklik / 100,
    });
  },
});

// Görselin sağ üst köşesi (döndürülmüş): ölçek ve açı tutamacı burada durur.
function gorselKosesi(n) {
  const m = harita.latLngToLayerPoint(n.merkez), en = n.genislik / metrePiksel(n.merkez[0]), boy = (en * n.boy) / n.en;
  const a = (n.aci * Math.PI) / 180, x = en / 2, y = -boy / 2;
  return harita.layerPointToLatLng(L.point(m.x + x * Math.cos(a) - y * Math.sin(a), m.y + x * Math.sin(a) + y * Math.cos(a)));
}

// Köşe tutamacı sürüklenince: merkezden uzaklık ölçeği, yön açıyı verir (en/boy oranı korunur).
function gorselKoseyeGore(n, p) {
  const m = harita.latLngToLayerPoint(n.merkez), h = harita.latLngToLayerPoint(p);
  const en = n.genislik / metrePiksel(n.merkez[0]), boy = (en * n.boy) / n.en;
  const vx = h.x - m.x, vy = h.y - m.y;
  n.genislik = Math.max(1, n.genislik * (Math.hypot(vx, vy) / Math.hypot(en / 2, boy / 2)));
  let aci = ((Math.atan2(vy, vx) - Math.atan2(-boy / 2, en / 2)) * 180) / Math.PI;
  aci = ((aci + 540) % 360) - 180;
  n.aci = Math.round(aci * 10) / 10;
}

// Yeni görsel ekranın ortasına, görünen genişliğin yarısı kadar konur.
function gorseliEkranaSigdir(n) {
  const sinir = harita.getBounds(), merkez = harita.getCenter();
  const genislik = harita.distance([merkez.lat, sinir.getWest()], [merkez.lat, sinir.getEast()]);
  Object.assign(n, { merkez: [merkez.lat, merkez.lng], genislik: Math.round(genislik * 0.5), aci: 0 });
}

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
let pdfjsSozu = null;
function pdfjsYukle() {
  pdfjsSozu ??= new Promise((coz, red) => {
    const betik = Object.assign(document.createElement("script"), { src: `${PDFJS}/pdf.min.js` });
    betik.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`; coz(window.pdfjsLib); };
    betik.onerror = () => { pdfjsSozu = null; red(new Error("PDF okuyucu yüklenemedi; internet bağlantısını kontrol et.")); };
    document.head.append(betik);
  });
  return pdfjsSozu;
}

// PDF sayfası, uzun kenarı ~2600 piksel olacak şekilde görsele çevrilir (haritada ve çıktıda yeterli).
async function pdfSayfasi(belge, no) {
  const sayfa = await belge.getPage(no);
  const temel = sayfa.getViewport({ scale: 1 });
  const gorunum = sayfa.getViewport({ scale: Math.min(4, 2600 / Math.max(temel.width, temel.height)) });
  const tuval = Object.assign(document.createElement("canvas"), { width: Math.round(gorunum.width), height: Math.round(gorunum.height) });
  const ctx = tuval.getContext("2d");
  ctx.fillStyle = token("--not-beyaz"); // kağıt
  ctx.fillRect(0, 0, tuval.width, tuval.height);
  await sayfa.render({ canvasContext: ctx, viewport: gorunum }).promise;
  const blob = await new Promise((coz) => tuval.toBlob(coz, "image/png"));
  return { url: URL.createObjectURL(blob), en: tuval.width, boy: tuval.height };
}

const resimYukle = (url) => new Promise((coz, red) => {
  const img = new Image();
  img.onload = () => coz(img);
  img.onerror = () => red(new Error("Görsel açılamadı."));
  img.src = url;
});

const PDF_MI = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const GORSEL_MI = (f) => PDF_MI(f) || /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);
const TABLO_MI = (f) => /\.(xlsx|xlsm|csv)$/i.test(f.name);

async function gorselOku(dosya) {
  if (PDF_MI(dosya)) {
    const pdfjs = await pdfjsYukle();
    const veri = new Uint8Array(await dosya.arrayBuffer());
    const belge = await pdfjs.getDocument({ data: veri.slice() }).promise; // pdf.js veriyi devralır; aslı projeye kaydedilir
    return { ...(await pdfSayfasi(belge, 1)), pdf: belge, pdfVeri: veri, sayfa: 1, sayfaSayisi: belge.numPages };
  }
  const url = URL.createObjectURL(dosya);
  try {
    const img = await resimYukle(url);
    return { url, en: img.naturalWidth || 1000, boy: img.naturalHeight || 1000 };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

async function gorselNotuEkle(dosya) {
  const ad = dosya.name.replace(/\.[^.]+$/, "");
  const veri = await gorselOku(dosya);
  const n = { opaklik: 85, karistir: false, ...veri, ad };
  gorseliEkranaSigdir(n);
  return notEkle("gorsel", n);
}

async function tabloNotuEkle(dosya) {
  const r = await api("tablo-oku", { method: "POST", headers: { "X-Dosya-Adi": encodeURIComponent(dosya.name) }, body: await dosyaIcerigi(dosya) });
  const merkez = harita.getCenter();
  return notEkle("tablo", { ad: dosya.name.replace(/\.[^.]+$/, ""), sayfalar: r.sayfalar, sayfa: 0, baslikSatiri: true, boyut: 12,
    konum: [merkez.lat, merkez.lng], renk: token("--not-siyah") });
}

// Görsel, PDF ve tablo dosyalarını not olarak ekler; kalanları (KML, JSON...) geri verir.
async function notDosyalariniAl(dosyalar) {
  const kalan = [];
  for (const f of dosyalar) {
    try {
      if (GORSEL_MI(f)) await gorselNotuEkle(f);
      else if (TABLO_MI(f)) await tabloNotuEkle(f);
      else kalan.push(f);
    } catch (e) { mesaj(`${f.name}: ${e.message}`, true); }
  }
  return kalan;
}

function tabloHtml(n) {
  const s = n.sayfalar[n.sayfa];
  const [ilk, ...kalan] = s.satirlar;
  const satir = (h, et) => `<tr>${h.map((x) => `<${et}>${esc(x)}</${et}>`).join("")}</tr>`;
  const govde = (n.baslikSatiri ? kalan : s.satirlar).map((h) => satir(h, "td")).join("");
  const secili = n.id === seciliNot && gorselSekmesinde();
  return `<div class="harita-tablo${secili ? " secili" : ""}" style="--tablo-boyut:${n.boyut}px;--tablo-renk:${esc(n.renk)};--tablo-yazi:${acikRenk(n.renk) ? "var(--not-siyah)" : "var(--not-beyaz)"}">` +
    `<table>${n.baslikSatiri ? `<thead>${satir(ilk, "th")}</thead>` : ""}<tbody>${govde}</tbody></table></div>`;
}

$("gorselEkle").addEventListener("click", () => $("gorselSec").click());
$("tabloEkle").addEventListener("click", () => $("tabloSec").click());
$("gorselSec").addEventListener("change", async (e) => {
  const dosyalar = [...e.target.files];
  e.target.value = "";
  yukleniyor($("gorselEkle"), true);
  try { await notDosyalariniAl(dosyalar); } finally { yukleniyor($("gorselEkle"), false); }
});
$("tabloSec").addEventListener("change", async (e) => {
  const dosyalar = [...e.target.files];
  e.target.value = "";
  yukleniyor($("tabloEkle"), true);
  try { await notDosyalariniAl(dosyalar); } finally { yukleniyor($("tabloEkle"), false); }
});

// Düzenleyicideki sayfa gezgini: PDF'te sayfa, Excel'de çalışma sayfası.
$("notSayfaGeri").addEventListener("click", () => notSayfaDegistir(-1));
$("notSayfaIleri").addEventListener("click", () => notSayfaDegistir(1));
async function notSayfaDegistir(fark) {
  const n = notlar.get(seciliNot);
  if (!n) return;
  if (n.tur === "tablo") return notGuncelle(n.id, { sayfa: Math.min(n.sayfalar.length - 1, Math.max(0, n.sayfa + fark)) });
  const no = Math.min(n.sayfaSayisi, Math.max(1, n.sayfa + fark));
  if (!(n.pdf || n.pdfVeri) || no === n.sayfa) return;
  try {
    n.pdf ??= await (await pdfjsYukle()).getDocument({ data: n.pdfVeri.slice() }).promise; // projeden açılan PDF'te ilk kez
    const eski = n.url;
    const s = await pdfSayfasi(n.pdf, no);
    // Yeni sayfanın en/boy oranı farklı olabilir; genişlik aynı kalır.
    notGuncelle(n.id, { ...s, sayfa: no });
    URL.revokeObjectURL(eski);
  } catch (e) { mesaj(e.message, true); }
}

$("notOpaklik").addEventListener("input", (e) => notGuncelle(seciliNot, { opaklik: Number(e.target.value) }));
$("notAci").addEventListener("input", (e) => notGuncelle(seciliNot, { aci: Number(e.target.value) }));
$("notKaristir").addEventListener("change", (e) => notGuncelle(seciliNot, { karistir: e.target.checked }));
$("notBaslikSatiri").addEventListener("change", (e) => notGuncelle(seciliNot, { baslikSatiri: e.target.checked }));
$("notTabloBoyut").addEventListener("input", (e) => notGuncelle(seciliNot, { boyut: Number(e.target.value) }));
$("notGrafikBoyut").addEventListener("input", (e) => notGuncelle(seciliNot, { boyut: Number(e.target.value) / 100 }));

// Haritadaki grafik kartı: Analiz sekmesindeki dilim grafiğinin aynısı (analiz.js dilimGrafigiSvg)
function grafikHtml(n) {
  const secili = n.id === seciliNot && gorselSekmesinde();
  return `<div class="harita-grafik${secili ? " secili" : ""}" style="--grafik-olcek:${n.boyut}">${dilimGrafigiSvg(n.veri, "kagit", n.ad).svg}</div>`;
}
$("notSigdir").addEventListener("click", () => {
  const n = notlar.get(seciliNot);
  if (!n) return;
  gorseliEkranaSigdir(n);
  notGuncelle(n.id, {});
});



// ---- yeni sürüm uyarısı ----------------------------------------------------------
// Sunucu açılışta GitHub'daki son sürüme bakar (parselapp/guncelleme.py). Yeni sürüm varsa her açılışta
// söylenir: indir ya da devam et. Denetlenemezse (internet yok, kaynaktan çalışıyor) bir şey gösterilmez.
async function guncellemeDenetle() {
  let g;
  try { g = await apiIstek("guncelleme"); } catch { return; }
  if (!g?.yeni) return;
  $("guncellemeMetin").textContent = `Parsel Sorgu + v${g.son} yayınlandı${g.baslik ? ` (${g.baslik})` : ""}. Bu bilgisayardaki sürüm v${g.surum}.`;
  $("guncellemeIndir").href = g.indir;
  $("guncellemeKutusu").showModal();
}
$("guncellemeIndir").addEventListener("click", () => $("guncellemeKutusu").close("indir"));

// ---- başlangıç -----------------------------------------------------------------

(() => {
  let sekme = "parsel";
  try { sekme = localStorage.getItem("sekme") || "parsel"; } catch { /* yoksa varsayılan */ }
  sekmeAc(Object.hasOwn(SAYFALAR, sekme) ? sekme : "parsel");
})();
// Sayfa açılışı = yeni oturum: liste ve alanlar boş başlar. Önbellek (daha önce sorgulanan
// parseller, il/ilçe/mahalle listeleri) sunucuda kalır; tekrar sorgulanınca TKGM'ye gidilmez.
postJson("oturum/yeni", {}).catch((e) => mesaj(e.message, true));
guncellemeDenetle();
listeCiz();
referansListeCiz();
sayacGuncelle();
