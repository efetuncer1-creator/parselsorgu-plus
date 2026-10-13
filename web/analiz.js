"use strict";

// ================================================================================
// Analiz: alandaki (ya da listedeki) parsellerin nelerden oluştuğu
// ================================================================================
// İki tablo: parsel türleri (niteliğe göre adet, alan, pay) ve ada/parsel tablosu (sütunları kullanıcı
// seçer). Parsel bilgileri tarayıcıda zaten var; sunucudan sadece alan içinde kalan m² gelir
// (/referanslar/<id>/alan-ici). Tablolar Excel'e indirilir, haritaya tablo katmanı (Görsel sekmesi)
// ya da çıktı sayfasına tablo olarak eklenir. app.js ve cikti.js'teki durumu kullanır.

// alanli: sadece bir alanla analizde anlamlı (alan içi m² ve oran)
const ANALIZ_SUTUNLARI = [
  { id: "sira", ad: "Sıra", tur: "tamsayi", deger: (p, i) => i + 1 },
  { id: "il", ad: "İl", tur: "metin", deger: (p) => p.il },
  { id: "ilce", ad: "İlçe", tur: "metin", deger: (p) => p.ilce },
  { id: "mahalle", ad: "Mahalle", tur: "metin", deger: (p) => p.mahalle },
  { id: "ada", ad: "Ada", tur: "kod", deger: (p) => p.ada },
  { id: "parsel", ad: "Parsel", tur: "kod", deger: (p) => p.parsel },
  { id: "adaParsel", ad: "Ada/Parsel", tur: "metin", deger: (p) => `${p.ada}/${p.parsel}` },
  { id: "nitelik", ad: "Nitelik", tur: "metin", deger: (p) => p.nitelik || "" },
  { id: "mevkii", ad: "Mevkii", tur: "metin", deger: (p) => p.mevkii || "" },
  { id: "pafta", ad: "Pafta", tur: "metin", deger: (p) => p.pafta || "" },
  { id: "zemin", ad: "Zemin", tur: "metin", deger: (p) => p.zemin || "" },
  { id: "tapu", ad: "Tapu alanı (m²)", tur: "sayi", deger: (p) => p.alan_m2 ?? null },
  { id: "alanIci", ad: "Alan içi (m²)", tur: "sayi", deger: (p, i, ic) => ic?.[0] ?? null, alanli: true },
  { id: "oran", ad: "Alan içi oran", tur: "yuzde", deger: (p, i, ic) => ic?.[1] ?? null, alanli: true },
  { id: "kaynak", ad: "Kaynak", tur: "metin", deger: (p) => (p.kaynak === "tkgm" ? "TKGM" : (p.kaynak || "").replace(/^dosya:/, "")) },
  { id: "tarih", ad: "Veri tarihi", tur: "metin", deger: (p) => (p.kaynak_tarih || "").slice(0, 10) },
];
const HAZIR_SUTUNLAR = {
  temel: ["sira", "mahalle", "ada", "parsel", "nitelik", "tapu", "alanIci", "oran"],
  konum: ["il", "ilce", "mahalle"],
  tumu: ANALIZ_SUTUNLARI.map((c) => c.id),
};
const KAPSAM_ADI = { kesisen: "alana değen", icinde: "alan içindeki", secili: "seçili", tumu: "listedeki" };
const ONIZLEME_SATIR = 8;

// tercih: kullanıcının seçtiği kapsam; kapsam: geçerli olan (alan yokken alanlı tercih "tumu" olur, alan gelince geri döner)
const analizDurumu = { tercih: "kesisen", kapsam: "kesisen", alanId: null, sutunlar: [...HAZIR_SUTUNLAR.temel], sonuc: null, surum: 0, zamanlayici: 0 };
try {
  const k = JSON.parse(localStorage.getItem("analiz") || "{}");
  if (Object.hasOwn(KAPSAM_ADI, k.kapsam)) analizDurumu.tercih = analizDurumu.kapsam = k.kapsam;
  if (Array.isArray(k.sutunlar)) analizDurumu.sutunlar = k.sutunlar.filter((id) => ANALIZ_SUTUNLARI.some((c) => c.id === id));
} catch { /* varsayılanlar */ }
const analizKaydet = () => {
  try { localStorage.setItem("analiz", JSON.stringify({ kapsam: analizDurumu.tercih, sutunlar: analizDurumu.sutunlar })); } catch { /* önemli değil */ }
};
const analizSekmesinde = () => !$("panel-analiz").hidden;
const alanliKapsam = () => analizDurumu.kapsam === "kesisen" || analizDurumu.kapsam === "icinde";

// İl, ilçe, mahalle, sonra ada ve parsel numarası sırasıyla (12 < 101)
const SIRALAYICI = new Intl.Collator("tr", { numeric: true });
const parselSirasi = (a, b) => SIRALAYICI.compare(a.il || "", b.il || "") || SIRALAYICI.compare(a.ilce || "", b.ilce || "")
  || SIRALAYICI.compare(a.mahalle || "", b.mahalle || "") || SIRALAYICI.compare(a.ada || "", b.ada || "")
  || SIRALAYICI.compare(a.parsel || "", b.parsel || "");

// ---- hesap -----------------------------------------------------------------------------------------

async function analizHesapla() {
  const surum = ++analizDurumu.surum;
  const alanli = alanliKapsam();
  let keys = analizDurumu.kapsam === "secili" ? [...durum.secili] : [...durum.parseller.keys()];
  let ic = null;
  if (alanli) {
    if (!referanslar.has(analizDurumu.alanId)) { analizDurumu.sonuc = { hata: "Analiz için bir alan seç ya da kapsamı değiştir." }; return analizCiz(); }
    try {
      ic = keys.length ? await postJson(`referanslar/${analizDurumu.alanId}/alan-ici`, { keys, kapsam: analizDurumu.kapsam }) : {};
    } catch (e) {
      if (surum === analizDurumu.surum) { analizDurumu.sonuc = { hata: e.message }; analizCiz(); }
      return;
    }
    keys = keys.filter((k) => ic[k]);
  }
  if (surum !== analizDurumu.surum) return;
  const parseller = keys.map((k) => durum.parseller.get(k)?.properties).filter(Boolean).sort(parselSirasi);
  analizDurumu.sonuc = { alanli, parseller, ic, alan: alanli ? referanslar.get(analizDurumu.alanId).veri : null };
  analizCiz();
}

function analizZamanla() {
  clearTimeout(analizDurumu.zamanlayici);
  analizDurumu.zamanlayici = setTimeout(analizHesapla, 200);
}

// Tablolar ham değerlerle kurulur (Excel'e sayı olarak gider); ekranda ve haritada hucreMetni ile yazılır.
function nitelikTablosu(s) {
  const gruplar = new Map();
  for (const p of s.parseller) {
    const ad = p.nitelik || "Belirtilmemiş";
    const g = gruplar.get(ad) ?? { adet: 0, tapu: 0, ic: 0 };
    g.adet++;
    g.tapu += p.alan_m2 || 0;
    g.ic += s.ic?.[p.key]?.[0] || 0;
    gruplar.set(ad, g);
  }
  const olcu = (g) => (s.alanli ? g.ic : g.tapu); // pay: alanda alan içi m², listede tapu alanı
  const toplam = [...gruplar.values()].reduce((t, g) => ({ adet: t.adet + g.adet, tapu: t.tapu + g.tapu, ic: t.ic + g.ic }), { adet: 0, tapu: 0, ic: 0 });
  const sirali = [...gruplar].sort((a, b) => olcu(b[1]) - olcu(a[1]));
  const satir = (ad, g) => [ad, g.adet, g.tapu, ...(s.alanli ? [g.ic] : []), olcu(toplam) ? olcu(g) / olcu(toplam) : 0];
  return {
    ad: "Parsel türleri",
    sutunlar: [{ ad: "Nitelik", tur: "metin" }, { ad: "Parsel", tur: "tamsayi" }, { ad: "Tapu (m²)", tur: "sayi" },
      ...(s.alanli ? [{ ad: "Alan içi (m²)", tur: "sayi" }] : []), { ad: "Pay", tur: "yuzde" }],
    satirlar: sirali.map(([ad, g]) => satir(ad, g)),
    toplam: satir("Toplam", toplam),
  };
}

function parselTablosu(s) {
  const secilen = ANALIZ_SUTUNLARI.filter((c) => analizDurumu.sutunlar.includes(c.id) && (!c.alanli || s.alanli));
  return {
    ad: "Parseller",
    sutunlar: secilen.map((c) => ({ ad: c.ad, tur: c.tur })),
    satirlar: s.parseller.map((p, i) => secilen.map((c) => c.deger(p, i, s.ic?.[p.key]))),
  };
}

// kisa: çekmecedeki önizleme dar; m² kuruşsuz yazılır (Excel, harita ve sayfa iki ondalıklı)
function hucreMetni(v, tur, kisa = false) {
  if (v == null || v === "") return "";
  if (tur === "sayi") return sayi(v, kisa ? 0 : 2);
  if (tur === "tamsayi") return sayi(v);
  if (tur === "yuzde") return `%${sayi(v * 100, 1)}`;
  return String(v);
}
const tabloMetinleri = (t) => [t.sutunlar.map((c) => c.ad), ...[...t.satirlar, ...(t.toplam ? [t.toplam] : [])]
  .map((r) => r.map((v, i) => hucreMetni(v, t.sutunlar[i].tur)))];

// ---- ekran -------------------------------------------------------------------------------------------

// cubuk: payı ilk hücrenin zemininde çubuk olarak da gösterir (nitelik tablosu)
function onizlemeTablosu(t, { enCok = Infinity, cubuk = false } = {}) {
  const sag = (tur) => (tur === "metin" ? "" : ' class="sag"');
  const satirlar = t.satirlar.slice(0, enCok);
  const payIndeksi = t.sutunlar.findIndex((c) => c.tur === "yuzde");
  const hucre = (v, i, et) => `<${et}${sag(t.sutunlar[i].tur)}>${esc(hucreMetni(v, t.sutunlar[i].tur, true))}</${et}>`;
  const satir = (r) => (cubuk && payIndeksi >= 0
    ? `<td class="pay-zemin" style="--pay:${Math.round((r[payIndeksi] || 0) * 100)}%">${esc(hucreMetni(r[0], t.sutunlar[0].tur, true))}</td>${r.slice(1).map((v, i) => hucre(v, i + 1, "td")).join("")}`
    : r.map((v, i) => hucre(v, i, "td")).join(""));
  return `<div class="analiz-tablo-kap"><table class="analiz-tablo">
    <thead><tr>${t.sutunlar.map((c) => `<th${sag(c.tur)}>${esc(c.ad)}</th>`).join("")}</tr></thead>
    <tbody>${satirlar.map((r) => `<tr>${satir(r)}</tr>`).join("")}</tbody>
    ${t.toplam ? `<tfoot><tr>${t.toplam.map((v, i) => hucre(v, i, "th")).join("")}</tr></tfoot>` : ""}
  </table></div>${t.satirlar.length > enCok ? `<p class="ikincil-metin">… ${sayi(t.satirlar.length - enCok)} satır daha; tamamı Excel'de, haritada ve sayfada.</p>` : ""}`;
}

function analizAlanlariniDoldur() {
  const sec = $("analizAlan");
  const alanlar = katmanSirasi.filter((id) => referanslar.has(id)).map((id) => referanslar.get(id).veri);
  if (!referanslar.has(analizDurumu.alanId)) analizDurumu.alanId = referanslar.has(aktifAlan) ? aktifAlan : alanlar[0]?.id ?? null;
  sec.innerHTML = alanlar.map((r) => `<option value="${r.id}">${esc(r.ad)}</option>`).join("");
  sec.disabled = !alanlar.length;
  if (analizDurumu.alanId != null) sec.value = String(analizDurumu.alanId);
  sec.dispatchEvent(new Event("change"));
  // Alan yoksa alanlı kapsamlar seçilemez
  document.querySelectorAll("input[name=analizKapsam]").forEach((x) => {
    x.disabled = !alanlar.length && (x.value === "kesisen" || x.value === "icinde");
  });
  const alanliTercih = analizDurumu.tercih === "kesisen" || analizDurumu.tercih === "icinde";
  analizDurumu.kapsam = !alanlar.length && alanliTercih ? "tumu" : analizDurumu.tercih;
  document.querySelectorAll("input[name=analizKapsam]").forEach((x) => { x.checked = x.value === analizDurumu.kapsam; });
  $("analizAlanSatiri").hidden = !alanliKapsam();
}

function analizCiz() {
  const s = analizDurumu.sonuc;
  const bos = !durum.parseller.size;
  $("analizBos").hidden = !bos;
  for (const id of ["analizNitelikKutu", "analizParselKutu", "analizExcel"]) $(id).hidden = bos || !s?.parseller;
  if (bos) { $("analizOzet").textContent = ""; return; }
  if (!s) { $("analizOzet").textContent = "Hesaplanıyor…"; return; }
  if (s.hata) {
    $("analizOzet").textContent = s.hata;
    for (const id of ["analizNitelikKutu", "analizParselKutu", "analizExcel"]) $(id).hidden = true;
    return;
  }
  const tapu = s.parseller.reduce((t, p) => t + (p.alan_m2 || 0), 0);
  const ic = s.alanli ? s.parseller.reduce((t, p) => t + (s.ic[p.key]?.[0] || 0), 0) : 0;
  $("analizOzet").textContent = s.parseller.length
    ? `${s.parseller.length} parsel · ${sayi(tapu)} m² tapu alanı${s.alanli ? ` · ${sayi(ic)} m² alan içinde` : ""}`
    : `Bu kapsamda parsel yok${s.alanli ? "; alanı tarayabilir ya da parsel içe aktarabilirsin" : ""}.`;
  for (const id of ["analizNitelikKutu", "analizParselKutu", "analizExcel"]) $(id).hidden = !s.parseller.length;
  if (!s.parseller.length) return;
  $("analizNitelik").innerHTML = onizlemeTablosu(nitelikTablosu(s), { cubuk: true });
  const pt = parselTablosu(s);
  $("analizParselAdet").textContent = s.parseller.length;
  $("analizParsel").innerHTML = pt.sutunlar.length ? onizlemeTablosu(pt, { enCok: ONIZLEME_SATIR })
    : `<p class="ikincil-metin">Tabloda görünecek sütunları seç.</p>`;
  document.querySelectorAll('[data-tablo="parsel"] button').forEach((b) => { b.disabled = !pt.sutunlar.length; });
  analizSutunlariniCiz();
}

function analizSutunlariniCiz() {
  const alanli = !!analizDurumu.sonuc?.alanli;
  $("analizSutunlar").innerHTML = ANALIZ_SUTUNLARI.filter((c) => !c.alanli || alanli).map((c) =>
    `<button type="button" class="cip secilebilir" data-sutun="${c.id}" aria-pressed="${analizDurumu.sutunlar.includes(c.id)}">${esc(c.ad)}</button>`).join("");
}

// ---- dışa verme, haritaya ve sayfaya ekleme --------------------------------------------------------------

function analizBasligi(t) {
  const s = analizDurumu.sonuc;
  return `${t.ad} · ${s.alanli ? s.alan.ad : `${KAPSAM_ADI[analizDurumu.kapsam]} parseller`}`;
}

function analizTablosu(hangi) {
  const s = analizDurumu.sonuc;
  return hangi === "nitelik" ? nitelikTablosu(s) : parselTablosu(s);
}

async function analizExcel(tablolar, buton) {
  yukleniyor(buton, true);
  try {
    const s = analizDurumu.sonuc;
    const dosyaAdi = `analiz-${s.alanli ? s.alan.ad : KAPSAM_ADI[analizDurumu.kapsam]}-${new Date().toISOString().slice(0, 10)}`;
    const r = await postJson("tablo-excel", { dosyaAdi, sayfalar: tablolar });
    blobIndir(await r.blob(), `${dosyaAdi.replace(/[\\/:*?"<>|]+/g, "-")}.xlsx`);
  } catch (e) { mesaj(e.message, true); } finally { yukleniyor(buton, false); }
}

$("panel-analiz").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tablo] button[data-is]");
  if (!b) return;
  const hangi = b.closest("[data-tablo]").dataset.tablo;
  const t = analizTablosu(hangi);
  const ad = analizBasligi(t);
  const sayfalar = [{ ad: t.ad, satirlar: tabloMetinleri(t), kesildi: false }];
  if (b.dataset.is === "excel") return analizExcel([t], b);
  if (b.dataset.is === "harita") {
    const m = harita.getCenter();
    notEkle("tablo", { ad, sayfalar, sayfa: 0, baslikSatiri: true, boyut: 12, konum: [m.lat, m.lng], renk: token("--not-siyah") });
    mesaj(`"${ad}" haritaya eklendi; Görsel sekmesinde taşıyıp boyutlandırabilirsin.`, "basari");
  } else {
    cikti.sayfaOgeleri.push({ id: `s${++sayfaSayac}`, tur: "tablo", ad, sayfalar, sayfa: 0, baslikSatiri: true, boyutMm: 2.6, renk: token("--not-siyah") });
    sayfaOgeleriCiz();
    mesaj(`"${ad}" çıktı sayfasına eklendi; Çıktı sekmesinde yerleştirebilirsin.`, "basari");
  }
});
$("analizExcel").addEventListener("click", (e) => analizExcel([analizTablosu("nitelik"), analizTablosu("parsel")].filter((t) => t.sutunlar.length), e.currentTarget));

document.querySelectorAll("input[name=analizKapsam]").forEach((x) => x.addEventListener("change", () => {
  analizDurumu.tercih = analizDurumu.kapsam = x.value;
  analizKaydet();
  $("analizAlanSatiri").hidden = !alanliKapsam();
  analizDurumu.sonuc = null;
  analizCiz();
  analizHesapla();
}));
$("analizAlan").addEventListener("change", (e) => {
  const id = Number(e.target.value);
  if (!id || id === analizDurumu.alanId) return;
  analizDurumu.alanId = id;
  if (alanliKapsam()) analizHesapla();
});
$("analizSutunlar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sutun]");
  if (!b) return;
  const id = b.dataset.sutun, var_ = analizDurumu.sutunlar.includes(id);
  analizDurumu.sutunlar = var_ ? analizDurumu.sutunlar.filter((x) => x !== id) : ANALIZ_SUTUNLARI.map((c) => c.id).filter((x) => x === id || analizDurumu.sutunlar.includes(x));
  analizKaydet();
  analizCiz();
  $("analizSutunlar").querySelector(`[data-sutun="${id}"]`)?.focus();
});
document.querySelectorAll("[data-hazir]").forEach((b) => b.addEventListener("click", () => {
  analizDurumu.sutunlar = [...HAZIR_SUTUNLAR[b.dataset.hazir]];
  analizKaydet();
  analizCiz();
}));

// Sekmeye girince ve sekmedeyken parsel listesi ya da seçim değişince yeniden hesaplanır.
document.addEventListener("sekme", () => {
  if (!analizSekmesinde()) return;
  analizAlanlariniDoldur();
  analizHesapla();
});
document.addEventListener("parseller", () => { if (analizSekmesinde()) analizZamanla(); });
if (analizSekmesinde()) { analizAlanlariniDoldur(); analizHesapla(); }
