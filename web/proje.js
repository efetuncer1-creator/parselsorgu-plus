"use strict";

// ================================================================================
// Proje: çalışmanın tamamı tek dosyada (.parselsorgu) kaydedilir ve açılır
// ================================================================================
// Dosya JSON'dur: parseller sınırlarıyla, alanlar görünümleriyle, notlar (görseller ve PDF'ler gömülü),
// katman sırası, lejant, çıktı düzeni ve harita görünümü. Açılınca parseller ve alanlar sunucuya yazılır
// (POST /api/proje/yukle); başka bilgisayarda da TKGM'ye sorgu gitmez. Tarayıcı izin veriyorsa (Chrome,
// Edge) dosya bir kez seçilir, sonraki kayıtlar aynı dosyaya yazılır; yoksa indirilir.
// app.js ve cikti.js'teki durumu kullanır.

const PROJE_TURU = "parsel-sorgu-proje";
const PROJE_SURUMU = 1;
const PROJE_UZANTISI = ".parselsorgu";
const PROJE_DOSYA_TURU = [{ description: "Parsel Sorgu + projesi", accept: { "application/json": [PROJE_UZANTISI] } }];
const proje = { dosya: null, kaydedildi: null }; // dosya: seçilen dosyanın tutamacı (File System Access)

const blobVeri = (blob) => new Promise((coz, red) => {
  const okuyucu = new FileReader();
  okuyucu.onload = () => coz(okuyucu.result);
  okuyucu.onerror = () => red(okuyucu.error);
  okuyucu.readAsDataURL(blob);
});
const adresVeri = async (url) => blobVeri(await (await fetch(url)).blob());
const veriBlob = async (veri) => (await fetch(veri)).blob();

const projeAdi = () => $("projeAd").value.trim();
const projeDosyaAdi = () => `${(projeAdi() || "parsel-projesi").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}${PROJE_UZANTISI}`;
const calismaVar = () => durum.parseller.size > 0 || referanslar.size > 0 || notlar.size > 0 || cikti.sayfaOgeleri.length > 0;

// ---- kaydetme ----------------------------------------------------------------------------------

async function projeOlustur() {
  const merkez = harita.getCenter();
  const notKaydi = async (n) => {
    const { katman, tutamaclar, pdf, url, pdfVeri, ...kayit } = n;
    if (n.tur === "gorsel") {
      kayit.resim = await adresVeri(url);
      if (pdfVeri) kayit.pdfVeri = await blobVeri(new Blob([pdfVeri], { type: "application/pdf" }));
    }
    return kayit;
  };
  const sayfaOgesiKaydi = async (o) => {
    const { url, ...kayit } = o;
    if (o.tur === "gorsel") kayit.resim = await adresVeri(url);
    return kayit;
  };
  return {
    tur: PROJE_TURU, surum: PROJE_SURUMU, kaydedildi: new Date().toISOString(), ad: projeAdi(),
    harita: { merkez: [merkez.lat, merkez.lng], zoom: harita.getZoom(), altlik: aktifAltlik === altlik.Uydu ? "Uydu" : "OpenStreetMap" },
    parseller: [...durum.parseller.values()],
    secili: [...durum.secili],
    alanlar: [...referanslar.values()].map(({ veri: r }) => ({
      id: r.id, ad: r.ad, renk: r.renk, geojson: r.geojson, gizli: r.gizli, hesap_katmani: r.hesap_katmani,
      gorsel: r.gorsel, gorunur: r.gorunur, taranan: r.taranan,
    })),
    aktifAlan,
    notlar: await Promise.all([...notlar.values()].map(notKaydi)),
    katmanSirasi: [...katmanSirasi],
    gruplar: [...gruplar].map(([gid, g]) => ({ ad: g.ad, acik: g.acik, uyeler: [...katmanGrubu].filter(([, x]) => x === gid).map(([id]) => id) })),
    lejant: { acik: lejant.acik, daralt: lejant.daralt, baslik: lejant.baslik, ogeler: lejant.ogeler },
    nitelikRenk: { acik: nitelikRenk.acik, renkler: nitelikRenk.renkler },
    cikti: {
      sablon: cikti.sablon, yon: cikti.yon, olcek: cikti.olcek, dpi: cikti.dpi, carpan: cikti.carpan, sistem: cikti.sistem,
      canli: cikti.canli, ogeler: cikti.ogeler, baslik: cikti.baslik, tarih: cikti.tarih, serbest: cikti.serbest,
      konumlar: cikti.konumlar, boyutlar: cikti.boyutlar, sayfaOgeleri: await Promise.all(cikti.sayfaOgeleri.map(sayfaOgesiKaydi)),
    },
  };
}

// Dosya seçimi ve yazma izni tıklamanın hemen ardından istenmeli (tarayıcı kuralı); proje sonra hazırlanır.
async function projeKaydet(farkli = false) {
  const buton = $("projeKaydet");
  try {
    const izinli = !farkli && proje.dosya && (await proje.dosya.requestPermission({ mode: "readwrite" })) === "granted";
    const dosya = izinli ? proje.dosya : await kayitYeriSor(projeDosyaAdi()); // app.js; null: indirilir
    if (dosya === false) return; // vazgeçildi
    yukleniyor(buton, true);
    const metin = JSON.stringify(await projeOlustur());
    // Seçilen dosyaya yazılabildiyse sonraki kayıtlar aynı dosyanın üstüne (app.js dosyaYaz)
    proje.dosya = (await dosyaYaz(dosya, new Blob([metin], { type: "application/json" }), projeDosyaAdi())) ? dosya : null;
    proje.kaydedildi = new Date();
    projeBilgisi();
  } catch (e) {
    if (e.name !== "AbortError") mesaj(`Proje kaydedilemedi: ${e.message}`, true);
  } finally { yukleniyor(buton, false); }
}

function projeBilgisi() {
  const saat = proje.kaydedildi?.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  $("projeDurum").textContent = saat ? `Kaydedildi ${saat}${proje.dosya ? ` · ${proje.dosya.name}` : ""}` : "";
  $("projeFarkli").hidden = !proje.dosya;
}

// ---- dosyadaki notların doğrulanması ---------------------------------------------------------------
// Dosya başka birinden gelmiş olabilir: alanlar tek tek okunur, beklenmeyen değer varsayılana döner;
// renkler sadece #rrggbb (stil özniteliğine giriyor).

const RENK = /^#[0-9a-f]{6}$/i;
const sayiAl = (v, alt, ust, varsayilan) => (Number.isFinite(Number(v)) ? Math.min(ust, Math.max(alt, Number(v))) : varsayilan);
const secenekAl = (v, secenekler, varsayilan) => (secenekler.includes(v) ? v : varsayilan);
const renkAl = (v, varsayilan) => (typeof v === "string" && RENK.test(v) ? v : varsayilan);
const metinAl = (v, uzunluk, varsayilan = "") => (typeof v === "string" ? v.slice(0, uzunluk) : varsayilan);
const noktaAl = (v) => (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x) && Math.abs(x) <= 180) ? [v[0], v[1]] : null);

// Dilim grafiğinin verisi: en çok 6 dilim; adlar ve sayılar doğrulanır.
function grafikVerisiniOku(v) {
  if (!v || typeof v !== "object" || !Array.isArray(v.dilimler)) return null;
  const dilimler = v.dilimler.slice(0, EN_COK_DILIM).filter((d) => d && typeof d.ad === "string" && Number.isFinite(d.deger) && Number.isFinite(d.pay))
    .map((d) => ({ ad: d.ad.slice(0, 80), deger: Math.max(0, d.deger), pay: Math.min(1, Math.max(0, d.pay)), adet: Math.round(sayiAl(d.adet, 0, 1e7, 0)),
      ...(d.diger === true ? { diger: true, icerik: (Array.isArray(d.icerik) ? d.icerik : []).filter((x) => typeof x === "string").slice(0, 50) } : {}) }));
  return dilimler.length >= 2 ? { dilimler, toplam: sayiAl(v.toplam, 0, 1e12, 0), birim: metinAl(v.birim, 40, "m²"), parsel: Math.round(sayiAl(v.parsel, 0, 1e7, 0)) } : null;
}

// Excel görünüşü (parselapp/tablo.py): stil tablosu, hücre başına stil numarası, sütun genişlikleri
const STIL_ALANI = { k: (v) => v === 1, i: (v) => v === 1, r: (v) => RENK.test(v), d: (v) => RENK.test(v), h: (v) => ["l", "c", "r"].includes(v) };
function tabloSayfasiniOku(s) {
  const sayfa = { ad: metinAl(s.ad, 60, "Sayfa"), satirlar: s.satirlar, kesildi: s.kesildi === true };
  if (Array.isArray(s.stiller) && Array.isArray(s.stil) && s.stil.length === s.satirlar.length
    && s.stil.every((r) => Array.isArray(r) && r.every((v) => Number.isInteger(v) && v >= 0 && v < s.stiller.length))) {
    sayfa.stiller = s.stiller.map((st) => Object.fromEntries(Object.entries(st && typeof st === "object" ? st : {}).filter(([a, v]) => STIL_ALANI[a]?.(v))));
    sayfa.stil = s.stil;
  }
  if (Array.isArray(s.genislikler)) sayfa.genislikler = s.genislikler.map((w) => (Number.isFinite(w) && w > 0 && w < 300 ? w : null));
  return sayfa;
}

function notKaydiniOku(k) {
  if (!k || typeof k !== "object") return null;
  const ortak = { ad: metinAl(k.ad, 60), gorunur: k.gorunur !== false, opaklik: sayiAl(k.opaklik, 5, 100, 100), kilit: k.kilit === true };
  if (k.tur === "olcu") {
    const noktalar = Array.isArray(k.noktalar) ? k.noktalar.slice(0, 1000).map(noktaAl) : [];
    return noktalar.length >= 2 && noktalar.every(Boolean) && { ...ortak, tur: "olcu", noktalar, kapali: k.kapali === true && noktalar.length > 2,
      renk: renkAl(k.renk, token("--alan-renk-3")), kalinlik: sayiAl(k.kalinlik, 0.5, 200, 2.5), cizgi: secenekAl(k.cizgi, ["duz", "kesik"], "duz"),
      parcalar: k.parcalar !== false, cevre: k.cevre === true };
  }
  if (k.tur === "yazi") {
    const konum = noktaAl(k.konum);
    return konum && { ...ortak, tur: "yazi", konum, metin: metinAl(k.metin, 300, "Yazı") || "Yazı", boyut: sayiAl(k.boyut, 1, 2000, 16),
      renk: renkAl(k.renk, token("--not-beyaz")), stil: secenekAl(k.stil, ["hale", "kutu", "sade"], "hale"), kalin: k.kalin !== false };
  }
  if (k.tur === "ok") {
    const noktalar = Array.isArray(k.noktalar) && k.noktalar.length === 2 ? k.noktalar.map(noktaAl) : [];
    return noktalar.length === 2 && noktalar.every(Boolean) && { ...ortak, tur: "ok", noktalar, renk: renkAl(k.renk, token("--alan-renk-3")),
      kalinlik: sayiAl(k.kalinlik, 0.5, 200, 3), uc: secenekAl(k.uc, ["tek", "cift", "yok"], "tek"), cizgi: secenekAl(k.cizgi, ["duz", "kesik"], "duz") };
  }
  if (k.tur === "gorsel") {
    const merkez = noktaAl(k.merkez);
    if (!merkez || typeof k.resim !== "string" || !k.resim.startsWith("data:image/")) return null;
    return { ...ortak, tur: "gorsel", merkez, resim: k.resim, en: sayiAl(k.en, 1, 1e5, 1000), boy: sayiAl(k.boy, 1, 1e5, 1000),
      genislik: sayiAl(k.genislik, 1, 1e6, 500), aci: sayiAl(k.aci, -180, 180, 0), opaklik: sayiAl(k.opaklik, 1, 100, 85),
      karistir: k.karistir === true, sayfa: Math.round(sayiAl(k.sayfa, 1, 1e4, 1)), sayfaSayisi: Math.round(sayiAl(k.sayfaSayisi, 1, 1e4, 1)),
      pdfVeri: typeof k.pdfVeri === "string" && k.pdfVeri.startsWith("data:application/pdf") ? k.pdfVeri : null };
  }
  if (k.tur === "grafik") {
    const konum = noktaAl(k.konum), veri = grafikVerisiniOku(k.veri);
    return konum && veri && { ...ortak, tur: "grafik", konum, veri, boyut: sayiAl(k.boyut, 0.05, 50, 1) };
  }
  if (k.tur === "tablo") {
    const konum = noktaAl(k.konum);
    const sayfalar = Array.isArray(k.sayfalar) ? k.sayfalar.filter((s) => s && Array.isArray(s.satirlar) && s.satirlar.length
      && s.satirlar.every((r) => Array.isArray(r) && r.every((h) => typeof h === "string"))).map(tabloSayfasiniOku) : [];
    return konum && sayfalar.length && { ...ortak, tur: "tablo", konum, sayfalar, sayfa: Math.round(sayiAl(k.sayfa, 0, sayfalar.length - 1, 0)),
      dizilis: secenekAl(k.dizilis, ["tek", "alt", "yan"], k.tumSayfalar === true ? "alt" : "tek"), baslikSatiri: k.baslikSatiri !== false, boyut: sayiAl(k.boyut, 1, 500, 12), renk: renkAl(k.renk, token("--not-siyah")) };
  }
  return null;
}

function sayfaOgesiniOku(o) {
  if (!o || typeof o !== "object") return null;
  if (o.tur === "gorsel" && typeof o.resim === "string" && o.resim.startsWith("data:image/")) {
    return { tur: "gorsel", ad: metinAl(o.ad, 80, "Görsel"), resim: o.resim, en: sayiAl(o.en, 1, 1e5, 1000), boy: sayiAl(o.boy, 1, 1e5, 1000),
      genislikMm: sayiAl(o.genislikMm, ...SAYFA_OGE_SINIRI, 40) };
  }
  if (o.tur === "grafik") {
    const veri = grafikVerisiniOku(o.veri);
    return veri && { tur: "grafik", ad: metinAl(o.ad, 80, "Grafik"), veri, genislikMm: sayiAl(o.genislikMm, ...SAYFA_OGE_SINIRI, 90) };
  }
  if (o.tur === "tablo") {
    const tablo = notKaydiniOku({ ...o, tur: "tablo", konum: [0, 0] });
    return tablo && { tur: "tablo", ad: metinAl(o.ad, 80, "Tablo"), sayfalar: tablo.sayfalar, sayfa: tablo.sayfa, dizilis: tablo.dizilis, baslikSatiri: tablo.baslikSatiri,
      renk: tablo.renk, boyutMm: sayiAl(o.boyutMm, ...SAYFA_OGE_SINIRI, 2.6) };
  }
  if (o.tur === "yazi") {
    const metin = metinAl(o.metin, 300, "Açıklama");
    return { tur: "yazi", ad: metin.split("\n")[0].slice(0, 30) || "Yazı", metin, kalin: o.kalin === true,
      renk: renkAl(o.renk, token("--not-siyah")), boyutMm: sayiAl(o.boyutMm, ...SAYFA_OGE_SINIRI, 4) };
  }
  return null;
}

// ---- açma ------------------------------------------------------------------------------------------

// Açık çalışmayı kapatır: alanlar sunucudan da silinir, parseller önbellekte kalır.
async function calismayiTemizle() {
  notModu(null);
  gruplar.clear();
  katmanGrubu.clear();
  for (const id of [...notlar.keys()]) notSil(id);
  for (const id of [...referanslar.keys()]) {
    await postJson(`referanslar/${id}/sil`, {}).catch(() => {});
    referansKaldir(id);
  }
  alanSec(null);
  durum.katmanlar.forEach((k) => k.remove());
  durum.katmanlar.clear();
  durum.parseller.clear();
  durum.secili.clear();
  parselNo.isaretler.forEach((m) => m.remove());
  parselNo.isaretler.clear();
  durum.aktif = null;
  menuGoster(null);
  bosluklariTemizle();
  sonOzet = null;
  cikti.sayfaOgeleri.forEach((o) => { if (o.tur === "gorsel") URL.revokeObjectURL(o.url); });
  Object.assign(cikti, { sayfaOgeleri: [], konumlar: {}, boyutlar: {} });
  lejant.ogeler = [];
  katmanSirasi.length = 0;
  gorselAlan = seciliNot = null;
  listeCiz();
  referansListeCiz();
}

async function projeAc(dosya, tutamac = null) {
  let p;
  try { p = JSON.parse(await dosya.text()); } catch { return mesaj(`${dosya.name} proje dosyası olarak okunamadı.`, true); }
  if (p?.tur !== PROJE_TURU) return mesaj(`${dosya.name} bir Parsel Sorgu + projesi değil.`, true);
  if (p.surum > PROJE_SURUMU) return mesaj("Bu proje uygulamanın daha yeni bir sürümüyle kaydedilmiş; önce uygulamayı güncelle.", true);
  if (calismaVar() && !(await onayla("Açık çalışma kapanıp proje açılsın mı? Kaydetmediğin değişiklikler kaybolur.", "Projeyi aç"))) return;
  const buton = $("projeAcDugme");
  yukleniyor(buton, true);
  try {
    // Önce sunucu doğrular ve yazar; dosya bozuksa açık çalışma olduğu gibi kalır.
    const r = await postJson("proje/yukle", { parseller: Array.isArray(p.parseller) ? p.parseller : [], alanlar: Array.isArray(p.alanlar) ? p.alanlar : [] });
    await calismayiTemizle();
    const yeniKimlik = new Map(); // dosyadaki kimlik -> bu oturumdaki kimlik
    (p.alanlar || []).forEach((a, i) => yeniKimlik.set(a.id, r.alanlar[i].id));

    // Parseller ve seçim
    await oturumaEkle(r.keys, false);
    for (const k of Array.isArray(p.secili) ? p.secili : []) if (durum.parseller.has(k)) { durum.secili.add(k); stilUygula(k); }

    // Alanlar (lejant sonra kurulur; açık lejant yeni alanları kendiliğinden eklemesin)
    lejant.acik = false;
    for (const ref of r.alanlar) referansCiz(ref);

    // Notlar
    let atlanan = 0;
    for (const ham of Array.isArray(p.notlar) ? p.notlar : []) {
      const k = notKaydiniOku(ham);
      if (!k) { atlanan++; continue; }
      const id = `n${++notSayac}`;
      yeniKimlik.set(ham.id, id);
      const n = { ...k, id };
      if (n.tur === "gorsel") {
        n.url = URL.createObjectURL(await veriBlob(k.resim));
        delete n.resim;
        n.pdfVeri = k.pdfVeri ? new Uint8Array(await (await veriBlob(k.pdfVeri)).arrayBuffer()) : null; // sayfa değişince açılır
      }
      notlar.set(id, n);
      notCiz(n);
    }

    // Katman sırası; dosyada sırası olmayan katman en üste
    const sira = (Array.isArray(p.katmanSirasi) ? p.katmanSirasi : []).map((k) => yeniKimlik.get(k)).filter((k) => referanslar.has(k) || notlar.has(k));
    katmanSirasi.splice(0, katmanSirasi.length, ...new Set(sira));
    for (const k of [...referanslar.keys(), ...notlar.keys()]) if (!katmanSirasi.includes(k)) katmanSirasi.unshift(k);
    // Katman grupları
    for (const g of Array.isArray(p.gruplar) ? p.gruplar.slice(0, 200) : []) {
      const uyeler = (Array.isArray(g?.uyeler) ? g.uyeler : []).map((k) => yeniKimlik.get(k)).filter((k) => referanslar.has(k) || notlar.has(k));
      if (!uyeler.length) continue;
      const gid = `g${++grupSayac}`;
      gruplar.set(gid, { ad: metinAl(g.ad, 60, "Grup") || "Grup", acik: g.acik !== false });
      uyeler.forEach((k) => katmanGrubu.set(k, gid));
    }
    sirayiUygula();

    // Lejant
    const l = p.lejant || {};
    lejant.ogeler = (Array.isArray(l.ogeler) ? l.ogeler : []).map((o) => (o && (o.tur === "alan" || o.tur === "not") ? { ...o, id: yeniKimlik.get(o.id) }
      : o?.tur === "ozel" && o.not ? { ...o, not: yeniKimlik.get(o.not) ?? "" } : o)) // katmana bağlı özel öğe (Eğim sınıfları)
      .filter((o) => o && (o.ad === undefined || typeof o.ad === "string") && (o.tur === "alan" ? referanslar.has(o.id) : o.tur === "not" ? notlar.has(o.id)
        : Object.hasOwn(LEJANT_SABIT, o.tur) || (o.tur === "nitelik" && typeof o.nitelik === "string")
          || (o.tur === "ozel" && typeof o.k === "string" && RENK.test(o.renk) && Object.hasOwn(OZEL_SEKIL, o.sekil) && (!("not" in o) || notlar.has(o.not)))));
    Object.assign(lejant, { acik: l.acik === true, daralt: l.daralt === true, baslik: metinAl(l.baslik, 40, "Lejant") });
    lejantKaydet();

    // Nitelik renkleri (eski projelerde yok: o zaman tercih olduğu gibi kalır)
    if (p.nitelikRenk && typeof p.nitelikRenk === "object") {
      nitelikRenk.acik = p.nitelikRenk.acik === true;
      nitelikRenk.renkler = Object.fromEntries(Object.entries(p.nitelikRenk.renkler || {}).filter(([, v]) => nitelikRengiGecerli(v)));
      nitelikleriUygula();
    }

    // Çıktı düzeni ve sayfaya konanlar
    const c = p.cikti || {};
    Object.assign(cikti, {
      sablon: secenekAl(c.sablon, [...Object.keys(KAGITLAR), "serbest"], cikti.sablon), yon: secenekAl(c.yon, ["dikey", "yatay"], cikti.yon),
      olcek: c.olcek === "otomatik" || OLCEKLER.includes(c.olcek) ? c.olcek : cikti.olcek, dpi: secenekAl(c.dpi, [150, 300], cikti.dpi),
      carpan: secenekAl(c.carpan, [1, 2, 4], cikti.carpan), sistem: secenekAl(c.sistem, ["itrf96", "ed50"], cikti.sistem),
      canli: c.canli !== false, baslik: metinAl(c.baslik, 80), tarih: metinAl(c.tarih, 30),
      serbest: Array.isArray(c.serbest) && c.serbest.length === 2 && c.serbest.every(noktaAl) ? c.serbest : null,
      boyutlar: Object.fromEntries(Object.entries(c.boyutlar || {}).filter(([id, v]) => ["baslik", "lejant", "kuzey", "olcek"].includes(id) && Number.isFinite(v))
        .map(([id, v]) => [id, sayiAl(v, ...HAZIR_OGE_SINIRI, 1)])),
    });
    for (const ad of Object.keys(cikti.ogeler)) if (typeof c.ogeler?.[ad] === "boolean") cikti.ogeler[ad] = c.ogeler[ad];
    const konum = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && { x: Math.min(1, Math.max(0, v.x)), y: Math.min(1, Math.max(0, v.y)) };
    for (const id of ["baslik", "lejant", "kuzey", "olcek"]) if (konum(c.konumlar?.[id])) cikti.konumlar[id] = konum(c.konumlar[id]);
    for (const ham of Array.isArray(c.sayfaOgeleri) ? c.sayfaOgeleri : []) {
      const o = sayfaOgesiniOku(ham);
      if (!o) { atlanan++; continue; }
      o.id = `s${++sayfaSayac}`;
      if (o.tur === "gorsel") { o.url = URL.createObjectURL(await veriBlob(o.resim)); delete o.resim; }
      if (konum(c.konumlar?.[ham.id])) cikti.konumlar[o.id] = konum(c.konumlar[ham.id]);
      cikti.sayfaOgeleri.push(o);
    }
    ciktiKaydet();

    // Harita görünümü ve altlık
    const h = p.harita || {};
    if (noktaAl(h.merkez) && Number.isFinite(h.zoom)) harita.setView(h.merkez, Math.min(21, Math.max(2, h.zoom)));
    const altlikSecimi = document.querySelector(`input[name=altlik][value="${secenekAl(h.altlik, ["Uydu", "OpenStreetMap"], "Uydu")}"]`);
    if (!altlikSecimi.checked) { altlikSecimi.checked = true; altlikSecimi.dispatchEvent(new Event("change")); }

    const aktif = yeniKimlik.get(p.aktifAlan);
    if (aktif) alanSec(aktif, false);
    listeCiz();
    referansListeCiz();
    gorselDuzenDoldur();
    notDuzenDoldur();
    lejantDegisti();
    ciktiPaneliDoldur();
    cerceveCiz();

    proje.dosya = tutamac;
    proje.kaydedildi = null;
    $("projeAd").value = metinAl(p.ad, 80) || dosya.name.replace(/\.[^.]+$/, "");
    projeBilgisi();
    mesaj(`"${$("projeAd").value}" açıldı: ${durum.parseller.size} parsel, ${referanslar.size} alan, ${notlar.size} yazı/ok/görsel/tablo.`, "basari");
    if (atlanan) mesaj(`Dosyadaki ${atlanan} öğe okunamadığı için atlandı.`, true);
  } catch (e) {
    mesaj(`Proje açılamadı: ${e.message}`, true);
  } finally { yukleniyor(buton, false); }
}

// Açma penceresi yoksa (app.js dosyaPenceresi) tarayıcının dosya seçme kutusu açılır.
async function projeSecVeAc() {
  const secim = await dosyaPenceresi("showOpenFilePicker", { types: [{ ...PROJE_DOSYA_TURU[0], accept: { "application/json": [PROJE_UZANTISI, ".json"] } }] });
  if (secim === false) return;
  if (!secim) {
    // Pencere denenip kapandıysa tıklama hakkı bitmiş olabilir; o zaman bir kez daha tıklanır.
    if (navigator.userActivation && !navigator.userActivation.isActive) return mesaj("Dosyayı seçmek için bir kez daha tıkla.");
    return $("projeSec").click();
  }
  try {
    await projeAc(await secim[0].getFile(), secim[0]);
  } catch (e) { mesaj(e.message, true); }
}

$("projeKaydet").addEventListener("click", () => projeKaydet());
$("projeFarkli").addEventListener("click", () => projeKaydet(true));
$("projeAcDugme").addEventListener("click", projeSecVeAc);
$("projeSec").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) projeAc(f); });
// Ctrl+S: tarayıcının "sayfayı kaydet"i yerine projeyi kaydeder
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); projeKaydet(); }
});
