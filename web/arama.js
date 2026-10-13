"use strict";

// ================================================================================
// Hızlı arama (Ctrl+K): bu oturumdaki parseller, alanlar, katmanlar, komutlar ve koordinat
// ================================================================================
// Hepsi tarayıcıda aranır; TKGM'ye bir şey sorulmaz. Sorgu harcayabilecek satırlar ("sorgula") bunu
// açıkça yazar ve sadece seçilince çalışır. Koordinat: enlem/boylam doğrudan, ITRF96/ED50 3° sunucuda
// çevrilir (sayılardan hangi sistem olduğu anlaşılmadığı için ikisi de listelenir).

const hizli = { satirlar: [], aktif: 0, istek: 0, isaret: null };
const HIZLI_DILIMLER = [27, 30, 33, 36, 39, 42, 45];

// Seçili dışa aktarma: Parsel sekmesindeki formla aynı yol (biçim seçilir, form gönderilir).
function hizliDisaAktar(b) {
  if (!durum.secili.size) return mesaj("Önce listeden ya da haritadan parsel seç.", true);
  sekmeAc("parsel");
  const r = document.querySelector(`input[name=bicim][value=${b}]`);
  r.checked = true;
  r.dispatchEvent(new Event("change"));
  $("disaForm").requestSubmit($("disaButon"));
}

// ad: metin ya da o anki duruma göre metin döndüren işlev; ek: aramada eşleşen başka kelimeler.
const HIZLI_KOMUTLAR = [
  { ad: "Parsel sekmesi", ek: "sorgu ada liste", ikon: "parsel", yap: () => sekmeAc("parsel") },
  { ad: "Alan sekmesi", ek: "sınır osb plan tespit tarama boşluk", ikon: "alan", yap: () => sekmeAc("alan") },
  { ad: "Analiz sekmesi", ek: "tür nitelik tablo grafik", ikon: "analiz", yap: () => sekmeAc("analiz") },
  { ad: "Görsel sekmesi", ek: "katman stil renk lejant", ikon: "gorsel", yap: () => sekmeAc("gorsel") },
  { ad: "Çıktı sekmesi", ek: "pdf png yazdır sayfa", ikon: "yazici", yap: () => sekmeAc("cikti") },
  { ad: "Haritadan parsel sorgula", ek: "tıkla tkgm", ikon: "hedef", yap: () => { sekmeAc("parsel"); sorguModu(true); } },
  { ad: "Alan çiz", ek: "pin sınır çizim", ikon: "kalem", yap: () => { sekmeAc("alan"); if (durum.mod !== "cizim") cizimBasla(); } },
  { ad: "Sınır dosyası yükle", ek: "kml kmz netcad osb alan", ikon: "yukle", yap: () => { sekmeAc("alan"); $("referansSec").click(); } },
  { ad: "Parsel dosyası içe aktar", ek: "kml json fav_list", ikon: "yukle", yap: () => { sekmeAc("parsel"); $("dosyaSec").click(); } },
  { ad: "Ölç: mesafe ya da alan", ek: "ölçü metre m² cetvel uzunluk", ikon: "cetvel", yap: () => { sekmeAc("gorsel"); notModu("olcu"); } },
  { ad: "Yazı ekle", ek: "not metin", ikon: "yazi", yap: () => { sekmeAc("gorsel"); notModu("yazi"); } },
  { ad: "Ok ekle", ek: "işaret", ikon: "ok-isaret", yap: () => { sekmeAc("gorsel"); notModu("ok"); } },
  { ad: "Görsel ya da PDF ekle", ek: "resim plan pafta taranmış", ikon: "resim", yap: () => { sekmeAc("gorsel"); $("gorselEkle").click(); } },
  { ad: "Tablo ekle", ek: "excel csv xlsx", ikon: "tablo", yap: () => { sekmeAc("gorsel"); $("tabloEkle").click(); } },
  { ad: "Projeyi kaydet", ek: "parselsorgu", ikon: "kaydet", kisayol: "Ctrl S", yap: () => projeKaydet() },
  { ad: "Proje aç", ek: "parselsorgu dosya", ikon: "klasor", yap: () => projeSecVeAc() },
  { ad: "PDF indir", ek: "çıktı yazdır", ikon: "indir", yap: () => { sekmeAc("cikti"); $("ciktiPdf").click(); } },
  { ad: "PNG indir", ek: "çıktı görüntü resim", ikon: "indir", yap: () => { sekmeAc("cikti"); $("ciktiPng").click(); } },
  { ad: "Çıktıyı önizle", ek: "sayfa yerleştir", ikon: "goz", yap: () => { sekmeAc("cikti"); $("ciktiOnizle").click(); } },
  { ad: "Seçilenleri KML olarak dışa aktar", ek: "indir google earth", ikon: "harita", yap: () => hizliDisaAktar("kml") },
  { ad: "Seçilenleri Excel olarak dışa aktar", ek: "indir koordinat xlsx itrf96 ed50", ikon: "tablo", yap: () => hizliDisaAktar("excel") },
  { ad: "Bütün parselleri göster", ek: "yaklaş sığdır", ikon: "odak", yap: () => $("hepsiniGoster").click() },
  { ad: "Listedeki bütün parselleri seç", ek: "tümünü seç", ikon: "hepsi", yap: () => $("tumunuSec").click() },
  { ad: "Seçimi temizle", ek: "bırak kaldır", ikon: "kapat", yap: () => $("secimiKaldir").click() },
  { ad: () => `Ada/parsel numaralarını ${$("parselNoGoster").checked ? "gizle" : "göster"}`, ek: "etiket numara", ikon: "etiket", yap: () => $("parselNoGoster").click() },
  { ad: () => `Niteliklere göre renklendirmeyi ${$("nitelikAcik").checked ? "kapat" : "aç"}`, ek: "nitelik renk tarla", ikon: "gorsel", yap: () => $("nitelikAcik").click() },
  { ad: () => `Lejantı ${$("lejantAcik").checked ? "gizle" : "göster"}`, ek: "lejant", ikon: "liste-cikar", yap: () => $("lejantAcik").click() },
  { ad: () => `Çıktı sayfasını haritada ${$("ciktiCanli").checked ? "gizle" : "göster"}`, ek: "canlı sayfa çerçeve", ikon: "cerceve", yap: () => { sekmeAc("cikti"); $("ciktiCanli").click(); } },
  { ad: "Altlık: uydu görüntüsü", ek: "uydu esri", ikon: "harita", yap: () => document.querySelector("input[name=altlik][value=Uydu]").click() },
  { ad: "Altlık: OpenStreetMap", ek: "harita sokak osm", ikon: "harita", yap: () => document.querySelector("input[name=altlik][value=OpenStreetMap]").click() },
  { ad: () => `Yer adlarını ve yolları ${$("etiketler").getAttribute("aria-pressed") === "true" ? "gizle" : "göster"}`, ek: "etiket yol", ikon: "etiket",
    gorunur: () => !$("etiketler").disabled, yap: () => $("etiketler").click() },
];

// ---- eşleştirme ---------------------------------------------------------------

// Bütün kelimeler metinde geçmeli. Puan: başta geçen ve kelime başında geçen öne çıkar.
function hizliPuan(metin, kelimeler, ek = "") {
  const m = trKucuk(metin), e = trKucuk(ek);
  let puan = 0;
  for (const k of kelimeler) {
    const i = m.indexOf(k);
    if (i < 0) { if (!e.includes(k)) return 0; puan += 1; continue; }
    puan += i === 0 ? 6 : /[\s/(·-]/.test(m[i - 1]) ? 4 : 2;
  }
  return puan;
}

// Kelimelerin metinde geçtiği yerler kalın yazılır.
function hizliVurgula(metin, kelimeler) {
  const m = trKucuk(metin), isaret = new Array(metin.length).fill(false);
  for (const k of kelimeler) {
    const i = m.indexOf(k);
    if (i >= 0) for (let j = i; j < i + k.length; j++) isaret[j] = true;
  }
  let html = "", acik = false;
  for (let i = 0; i < metin.length; i++) {
    if (isaret[i] !== acik) { html += acik ? "</mark>" : "<mark>"; acik = isaret[i]; }
    html += esc(metin[i]);
  }
  return acik ? html + "</mark>" : html;
}

// "409/26", "409 26", "409-26": ada ve parsel. Sadece "409": ada ya da parsel.
function hizliAdaParsel(q) {
  const m = q.match(/^(\d{1,6})\s*[/\- ]\s*(\d{1,6})$/);
  return m ? { ada: String(Number(m[1])), parsel: String(Number(m[2])) } : null;
}

function hizliParseller(q, kelimeler) {
  const ap = hizliAdaParsel(q);
  const sonuc = [];
  for (const f of durum.parseller.values()) {
    const p = f.properties;
    const no = `${p.ada}/${p.parsel}`;
    let puan;
    if (ap) puan = p.ada === ap.ada && p.parsel === ap.parsel ? 100 : p.ada === ap.ada && p.parsel.startsWith(ap.parsel) ? 20 : 0;
    else if (/^\d+$/.test(q)) puan = p.ada === q ? 30 : p.parsel === q ? 20 : no.startsWith(q) ? 5 : 0;
    else puan = hizliPuan(`${no} ${p.mahalle} ${p.nitelik || ""} ${p.mevkii || ""}`, kelimeler, `${p.ilce} ${p.il}`);
    if (puan) sonuc.push({ f, puan });
  }
  sonuc.sort((a, b) => b.puan - a.puan || Number(a.f.properties.ada) - Number(b.f.properties.ada)
    || Number(a.f.properties.parsel) - Number(b.f.properties.parsel));
  return { ap, eslesen: sonuc };
}

// ---- koordinat ----------------------------------------------------------------

const hizliDilim = () => Math.min(45, Math.max(27, Math.round(harita.getCenter().lng / 3) * 3));

// Enlem/boylam (ondalık ya da derece-dakika-saniye) ya da Y/X (dilim düzleminde metre).
// Üçüncü sayı 27-45 arası 3'ün katıysa dilim (DOM) sayılır; yoksa haritanın ortasındaki dilim.
function hizliKoordinat(metin) {
  let t = metin.trim();
  const dms = [...t.matchAll(/(\d{1,3})\s*[°º]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|'')\s*)?/g)];
  let sayilar, derece = true;
  if (dms.length === 2) {
    sayilar = dms.map((m) => Number(m[1]) + Number((m[2] || "0").replace(",", ".")) / 60 + Number((m[3] || "0").replace(",", ".")) / 3600);
  } else {
    // Binlikleri boşlukla ayrılmış sayılar ("4 552 080,89") önce denenir.
    const parcalar = t.match(/\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) || [];
    sayilar = parcalar.map((s) => Number(s.replace(/ /g, "").replace(",", ".")));
    derece = parcalar.some((s) => /[.,]/.test(s)); // "37 32" ada/parsel olabilir; derece ondalıkla yazılır
  }
  if (sayilar.length === 3) {
    const i = sayilar.findIndex((v) => HIZLI_DILIMLER.includes(v));
    if (i < 0) return null;
    const dom = sayilar.splice(i, 1)[0];
    return hizliMetrik(sayilar, dom);
  }
  if (sayilar.length !== 2) return null;
  const [a, b] = sayilar;
  const enlemMi = (v) => derece && v >= 35 && v <= 43, boylamMi = (v) => derece && v >= 25 && v <= 46;
  if (enlemMi(a) && boylamMi(b)) return { enlem: a, boylam: b };
  if (boylamMi(a) && enlemMi(b)) return { enlem: b, boylam: a };
  return hizliMetrik(sayilar, null);
}

function hizliMetrik([a, b], dom) {
  const yMi = (v) => v >= 100000 && v <= 900000, xMi = (v) => v >= 3500000 && v <= 4800000;
  if (yMi(a) && xMi(b)) return { y: a, x: b, dom };
  if (xMi(a) && yMi(b)) return { y: b, x: a, dom };
  return null;
}

const dereceMetni = (enlem, boylam) => `${sayi(enlem, 6)}° K, ${sayi(boylam, 6)}° D`;

function konumIsaretiKaldir() {
  hizli.isaret?.remove();
  hizli.isaret = null;
}

function konumaGit(enlem, boylam, etiket) {
  konumIsaretiKaldir();
  hizli.isaret = L.marker([enlem, boylam], {
    keyboard: false,
    icon: L.divIcon({ className: "konum-isaret-ikon", html: `<span class="konum-isaret"></span><span class="konum-etiket">${esc(etiket)}</span>`, iconSize: [0, 0] }),
  }).addTo(harita);
  hizli.isaret.on("click", konumIsaretiKaldir);
  harita.setView([enlem, boylam], Math.max(harita.getZoom(), 17));
}

harita.on("click", () => { if (!durum.mod) konumIsaretiKaldir(); });

async function noktadanSorgula(enlem, boylam) {
  try {
    const r = await postJson("sorgu-nokta", { enlem, boylam });
    parselEkle(r.parsel, r.tkgmdenGeldi);
  } catch (err) { mesaj(err.message, true); }
  finally { sayacGuncelle(); }
}

function koordinatSatirlari(k) {
  const satirlar = (enlem, boylam, ad, alt) => [
    { grup: "Koordinat", ikon: "hedef", ad, alt, yap: () => konumaGit(enlem, boylam, ad) },
    { grup: "Koordinat", ikon: "ara", ad: "Bu noktadaki parseli sorgula", alt: "Önbellekte yoksa TKGM'den 1 sorgu",
      yap: () => { konumaGit(enlem, boylam, ad); noktadanSorgula(enlem, boylam); } },
  ];
  if (k.enlem != null) return satirlar(k.enlem, k.boylam, dereceMetni(k.enlem, k.boylam), "WGS84 enlem, boylam");
  return [{ grup: "Koordinat", ikon: "hedef", ad: `Y ${sayi(k.y, 2)} · X ${sayi(k.x, 2)}`, alt: "ITRF96 ve ED50 karşılıkları hesaplanıyor…", bekliyor: true }];
}

async function koordinatCevir(k, istek) {
  const dom = k.dom ?? hizliDilim();
  let r;
  try { r = await postJson("koordinat", { y: k.y, x: k.x, dilim: dom }); } catch (err) { r = { hata: err.message }; }
  if (istek !== hizli.istek) return; // bu arada yazı değişti
  const yer = hizli.satirlar.findIndex((s) => s.bekliyor);
  if (yer < 0) return;
  const yeni = r.hata || !r.sonuclar.length
    ? [{ grup: "Koordinat", ikon: "uyari", ad: `Y ${sayi(k.y, 2)} · X ${sayi(k.x, 2)}`, alt: r.hata || `DOM ${dom} diliminde Türkiye dışına düşüyor. Dilimi üçüncü sayı olarak yaz, ör. 27.`, yap: null }]
    : r.sonuclar.map((s) => ({
      grup: "Koordinat", ikon: "hedef", ad: `${s.ad} · DOM ${s.dom}`, alt: dereceMetni(s.enlem, s.boylam),
      yap: () => konumaGit(s.enlem, s.boylam, `${s.ad} DOM ${s.dom}: Y ${sayi(k.y, 2)} X ${sayi(k.x, 2)}`),
    }));
  if (!r.hata && r.sonuclar.length) {
    const ilk = r.sonuclar[0];
    yeni.push({ grup: "Koordinat", ikon: "ara", ad: "Bu noktadaki parseli sorgula", alt: `${ilk.ad} karşılığında; önbellekte yoksa TKGM'den 1 sorgu`,
      yap: () => { konumaGit(ilk.enlem, ilk.boylam, `${ilk.ad} DOM ${ilk.dom}`); noktadanSorgula(ilk.enlem, ilk.boylam); } });
  }
  hizli.satirlar.splice(yer, 1, ...yeni);
  if (hizli.aktif >= yer) hizli.aktif = yeni[0].yap ? yer : hizli.aktif + yeni.length - 1;
  hizliCiz();
}

// ---- sonuçlar -----------------------------------------------------------------

const NOT_TURU = { yazi: "Yazı", ok: "Ok", olcu: "Ölçü", gorsel: "Görsel", tablo: "Tablo", grafik: "Grafik" };

function hizliAra() {
  const q = trKucuk($("hizliGirdi").value.trim().replace(/\s+/g, " "));
  const kelimeler = q ? q.split(" ") : [];
  const satirlar = [];
  hizli.istek++;

  const k = q ? hizliKoordinat(q) : null;
  if (k) {
    satirlar.push(...koordinatSatirlari(k));
    if (k.y != null) koordinatCevir(k, hizli.istek);
  }

  if (q) {
    const { ap, eslesen } = k ? { ap: null, eslesen: [] } : hizliParseller(q, kelimeler);
    eslesen.slice(0, 8).forEach(({ f }) => {
      const p = f.properties;
      satirlar.push({ grup: "Parseller", ikon: "parsel", ad: `${p.ada}/${p.parsel}`, alt: `${p.mahalle} · ${p.nitelik || "Nitelik yok"}${p.alan ? ` · ${p.alan} m²` : ""}`,
        vurgu: !ap && !/^\d+$/.test(q), sag: durum.secili.has(p.key) ? "Seçili" : "", yap: () => aktifYap(p.key) });
    });
    if (eslesen.length > 1) {
      satirlar.push({ grup: "Parseller", ikon: "hepsi", ad: `Eşleşen ${eslesen.length} parseli seç`, alt: "Haritada ve listede seçilir",
        yap: () => {
          eslesen.forEach(({ f }) => { durum.secili.add(f.properties.key); stilUygula(f.properties.key); });
          listeCiz();
          harita.fitBounds(L.featureGroup(eslesen.map(({ f }) => durum.katmanlar.get(f.properties.key)).filter(Boolean)).getBounds(), { padding: [40, 40], maxZoom: 18 });
        } });
    }
    // Listede yoksa: Parsel sekmesindeki mahallede sorgula (önbellekte varsa sorgu harcamaz).
    if (ap && !eslesen.some((e) => e.puan === 100)) {
      const mahalle = $("mahalle").value ? $("mahalle").selectedOptions[0].textContent : null;
      satirlar.push({ grup: "Parseller", ikon: "ara", ad: mahalle ? `${mahalle} ${ap.ada}/${ap.parsel} sorgula` : `${ap.ada}/${ap.parsel} sorgula`,
        alt: mahalle ? "Parsel sekmesindeki mahallede; önbellekte yoksa TKGM'den 1 sorgu" : "Önce Parsel sekmesinde il, ilçe ve mahalle seç",
        yap: () => {
          sekmeAc("parsel");
          $("ada").value = ap.ada;
          $("parsel").value = ap.parsel;
          const eksik = SECICILER.find((ad) => !$(ad).value);
          if (eksik) return seciciAc(eksik);
          $("sorguForm").requestSubmit($("sorguForm").querySelector("[type=submit]"));
        } });
    }

    const alanlar = [...referanslar.values()].map(({ veri }) => ({ veri, puan: hizliPuan(veri.ad, kelimeler, "alan sınır") }))
      .filter((a) => a.puan).sort((a, b) => b.puan - a.puan).slice(0, 5);
    alanlar.forEach(({ veri }) => satirlar.push({ grup: "Alanlar", ornek: katmanOrnegi(veri), ad: veri.ad, vurgu: true,
      alt: veri.gorunur ? "Alan" : "Alan · gizli", yap: () => { sekmeAc("alan"); alanSec(veri.id); } }));
    // Proje dosyasıyla gelen alanın kendi katmanları (Netcad katmanları KML'de klasör olur): o katmana gidilir.
    const icKatmanlar = [];
    referanslar.forEach(({ veri }) => {
      const sayac = new Map();
      veri.geojson.features.forEach((f) => sayac.set(katmanAdi(f), (sayac.get(katmanAdi(f)) || 0) + 1));
      if (sayac.size < 2) return;
      sayac.forEach((n, ad) => {
        const puan = ad && hizliPuan(ad, kelimeler);
        if (puan) icKatmanlar.push({ veri, ad, n, puan });
      });
    });
    icKatmanlar.sort((a, b) => b.puan - a.puan).slice(0, 5).forEach(({ veri, ad, n }) => satirlar.push({
      grup: "Alanlar", ornek: katmanOrnegi(veri), ad, vurgu: true,
      alt: `${veri.ad} katmanı · ${n} nesne${(veri.gizli || []).includes(ad) || !veri.gorunur ? " · gizli" : ""}`,
      yap: () => {
        sekmeAc("alan");
        alanSec(veri.id, false);
        const b = L.geoJSON({ type: "FeatureCollection", features: veri.geojson.features.filter((f) => katmanAdi(f) === ad) }).getBounds();
        if (b.isValid()) harita.fitBounds(b, { padding: [30, 30], maxZoom: 18 });
      } }));

    const katmanlar = [...notlar.values()].map((n) => ({ n, puan: hizliPuan(notAdi(n), kelimeler, `${NOT_TURU[n.tur]} katman`) }))
      .filter((a) => a.puan).sort((a, b) => b.puan - a.puan).slice(0, 6);
    katmanlar.forEach(({ n }) => satirlar.push({ grup: "Katmanlar", ornek: notOrnegi(n), ad: notAdi(n), vurgu: true,
      alt: `${NOT_TURU[n.tur]}${n.tur === "olcu" ? ` · ${olcuOzeti(n)}` : ""}${n.gorunur ? "" : " · gizli"}`,
      yap: () => { notSec(n.id); notaYaklas(n); } }));
  }

  const komutlar = HIZLI_KOMUTLAR.filter((c) => !c.gorunur || c.gorunur())
    .map((c) => ({ c, ad: typeof c.ad === "function" ? c.ad() : c.ad }))
    .map((x) => ({ ...x, puan: q ? hizliPuan(x.ad, kelimeler, x.c.ek) : 1 }))
    .filter((x) => x.puan);
  if (q) komutlar.sort((a, b) => b.puan - a.puan);
  komutlar.slice(0, q ? 8 : komutlar.length).forEach(({ c, ad }) => satirlar.push({
    grup: "Komutlar", ikon: c.ikon, ad, vurgu: true, kisayol: c.kisayol, yap: c.yap }));

  hizli.satirlar = satirlar;
  hizli.kelimeler = kelimeler;
  hizli.aktif = Math.max(0, satirlar.findIndex((s) => s.yap));
  hizliCiz();
}

function hizliCiz() {
  const ul = $("hizliListe");
  let grup = null;
  ul.innerHTML = hizli.satirlar.map((s, i) => {
    const baslik = s.grup !== grup ? `<li class="hizli-grup" role="presentation">${esc(s.grup)}</li>` : "";
    grup = s.grup;
    const simge = s.ornek ?? `<span class="hizli-simge">${ikon(s.ikon)}</span>`;
    const ad = s.vurgu ? hizliVurgula(s.ad, hizli.kelimeler) : esc(s.ad);
    const sag = s.kisayol ? `<kbd>${esc(s.kisayol)}</kbd>` : s.sag ? `<span class="hizli-sag">${esc(s.sag)}</span>` : "";
    return `${baslik}<li role="option" id="hizli-${i}" data-i="${i}" class="hizli-satir${s.yap ? "" : " pasif"}" aria-selected="false" aria-disabled="${!s.yap}">
      ${simge}<span class="hizli-metin"><b>${ad}</b>${s.alt ? `<small>${esc(s.alt)}</small>` : ""}</span>${sag}</li>`;
  }).join("");
  $("hizliBos").hidden = hizli.satirlar.length > 0;
  hizliAktifGoster();
}

function hizliAktifGoster() {
  $("hizliListe").querySelectorAll(".hizli-satir.aktif").forEach((li) => { li.classList.remove("aktif"); li.setAttribute("aria-selected", "false"); });
  const li = $(`hizli-${hizli.aktif}`);
  if (!li) return $("hizliGirdi").removeAttribute("aria-activedescendant");
  li.classList.add("aktif");
  li.setAttribute("aria-selected", "true");
  li.scrollIntoView({ block: "nearest" });
  $("hizliGirdi").setAttribute("aria-activedescendant", li.id);
}

function hizliKaydir(yon) {
  const n = hizli.satirlar.length;
  for (let i = 1; i <= n; i++) {
    const j = (hizli.aktif + yon * i + n * i) % n;
    if (hizli.satirlar[j].yap) { hizli.aktif = j; break; }
  }
  hizliAktifGoster();
}

// Pencere önce kapanır, sonra iş yapılır: odak haritaya ya da açılan panele geçer. Dosya seçme pencereleri
// tıklama ya da Enter'ın hemen ardından açılabildiği için aynı olayın içinde çalışır.
function hizliCalistir(i) {
  const s = hizli.satirlar[i];
  if (!s?.yap) return;
  $("hizliArama").close();
  try { s.yap(); } catch (err) { mesaj(err.message, true); }
}

function hizliAc() {
  const d = $("hizliArama");
  if (!d.open) {
    seciciKapat(false);
    d.showModal();
  }
  $("hizliGirdi").select();
  hizliAra();
}

$("hizliAramaAc").addEventListener("click", hizliAc);
$("hizliGirdi").addEventListener("input", hizliAra);
$("hizliGirdi").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); hizliKaydir(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); hizliKaydir(-1); }
  else if (e.key === "Enter") { e.preventDefault(); hizliCalistir(hizli.aktif); }
});
$("hizliArama").querySelector(".arama-temizle").addEventListener("click", () => { $("hizliGirdi").value = ""; $("hizliGirdi").focus(); hizliAra(); });
$("hizliListe").addEventListener("mousedown", (e) => e.preventDefault()); // yazı kutusu odakta kalsın
$("hizliListe").addEventListener("mousemove", (e) => {
  const li = e.target.closest(".hizli-satir:not(.pasif)");
  if (li && Number(li.dataset.i) !== hizli.aktif) { hizli.aktif = Number(li.dataset.i); hizliAktifGoster(); }
});
$("hizliListe").addEventListener("click", (e) => {
  const li = e.target.closest(".hizli-satir");
  if (li) hizliCalistir(Number(li.dataset.i));
});
// Perdeye (pencerenin dışına) tıklayınca kapanır.
$("hizliArama").addEventListener("click", (e) => { if (e.target === $("hizliArama")) $("hizliArama").close(); });

// Ctrl+K her yerde; "/" yazı yazılmayan yerde.
document.addEventListener("keydown", (e) => {
  const yazi = e.target.matches("input, textarea, select, [contenteditable]");
  if (((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") || (e.key === "/" && !yazi && !e.ctrlKey && !e.metaKey)) {
    if (document.querySelector("dialog[open]:not(#hizliArama)")) return; // başka pencere açıkken değil
    e.preventDefault();
    hizliAc();
  }
});
