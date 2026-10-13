"use strict";

// ================================================================================
// Görsel sekmesi: parselleri niteliklerine göre renklendirme
// ================================================================================
// Durum, renk kuralı ve parsel stili app.js'te (nitelikRenk, nitelikRengi, parselStili); burada
// düzenleyici. Renk tercihi tarayıcıda ve proje dosyasında saklanır. Çıktıya ve lejanta da yansır.

function nitelikKaydet() {
  try { localStorage.setItem("nitelikRenkleri", JSON.stringify(nitelikRenk)); } catch { /* önemli değil */ }
}

function nitelikleriUygula() {
  durum.parseller.forEach((_, key) => stilUygula(key));
  for (const n of notlar.values()) if (n.tur === "grafik") notCiz(n); // grafik renkleri nitelik rengini izler
  if (analizSekmesinde()) analizCiz();
  canliZamanla();
  nitelikKaydet();
  nitelikListesiCiz();
  lejantCiz();
  lejantDuzenCiz();
}

// Listedeki nitelikler, çoktan aza
function nitelikSayilari() {
  const say = new Map();
  for (const f of durum.parseller.values()) {
    const ad = nitelikAdi(f.properties);
    say.set(ad, (say.get(ad) || 0) + 1);
  }
  return [...say].sort((a, b) => b[1] - a[1] || SIRALAYICI.compare(a[0], b[0]));
}

function nitelikListesiCiz() {
  $("nitelikAcik").checked = nitelikRenk.acik;
  const liste = nitelikSayilari();
  $("nitelikBos").hidden = liste.length > 0;
  $("nitelikEylemleri").hidden = !liste.length;
  $("nitelikListesi").innerHTML = liste.map(([ad, n]) => `
    <li data-nitelik="${esc(ad)}"${nitelikRenk.acik ? "" : ' class="pasif"'}>
      <button type="button" class="renk-secici" data-is="renk" style="background:${esc(nitelikRengi(ad))}" title="Rengi değiştir"
        aria-label="${esc(ad)} rengi" aria-haspopup="true" aria-expanded="false"></button>
      <span class="nitelik-ad">${esc(ad)}</span><span class="say">${sayi(n)}</span>
    </li>`).join("");
}

$("nitelikAcik").addEventListener("change", (e) => {
  nitelikRenk.acik = e.target.checked;
  nitelikleriUygula();
});

$("nitelikListesi").addEventListener("click", (e) => {
  const b = e.target.closest("[data-is=renk]");
  if (!b) return;
  const ad = b.closest("li").dataset.nitelik;
  renkPaletiAc(b, {
    anahtar: `nitelik-${ad}`, renk: nitelikRengi(ad), renkler: NITELIK_RENKLERI,
    sec: (renk) => {
      const yuva = NITELIK_RENKLERI.findIndex(([tk]) => token(tk).toLowerCase() === renk.toLowerCase());
      nitelikRenk.renkler[ad] = yuva >= 0 ? Number(NITELIK_RENKLERI[yuva][0].split("-").pop()) : renk;
      nitelikRenk.acik = true; // renk seçmek renklendirmeyi de açar
      nitelikleriUygula();
      $("nitelikListesi").querySelector(`li[data-nitelik="${CSS.escape(ad)}"] [data-is=renk]`)?.focus();
    },
  });
});

$("nitelikLejant").addEventListener("click", () => {
  const eksik = nitelikSayilari().map(([ad]) => ad).filter((ad) => !lejant.ogeler.some((o) => o.tur === "nitelik" && o.nitelik === ad));
  lejant.ogeler.push(...eksik.map((nitelik) => ({ tur: "nitelik", nitelik })));
  nitelikRenk.acik = true;
  lejant.acik = true;
  lejantKaydet();
  nitelikleriUygula();
  mesaj(eksik.length ? `${eksik.length} nitelik lejanta eklendi.` : "Niteliklerin hepsi zaten lejantta.", "basari");
});

$("nitelikVarsayilan").addEventListener("click", () => {
  nitelikRenk.renkler = {};
  nitelikleriUygula();
});

document.addEventListener("parseller", () => { if (gorselSekmesinde()) { nitelikListesiCiz(); lejantDuzenCiz(); } });
document.addEventListener("sekme", () => { if (gorselSekmesinde()) nitelikListesiCiz(); });
nitelikListesiCiz();
