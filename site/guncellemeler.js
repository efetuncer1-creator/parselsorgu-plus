/* Parsel Sorgu + — update history. Source of truth: guncellemeler.json (also feeds the GitHub release notes).
   - [data-surumler]       → full history (guncellemeler.html)
   - [data-son-guncelleme] → latest version summary (download section on the home page) */
(function () {
  "use strict";
  const REPO = "efetuncer1-creator/parselsorgu-plus";
  const TUR = { yeni: "Yeni", iyilestirme: "İyileştirme", duzeltme: "Düzeltme" };
  const tarihFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const tarih = (iso) => { const [y, m, d] = iso.split("-").map(Number); return tarihFmt.format(new Date(y, m - 1, d)); };
  const notListesi = (notlar) => {
    const ul = el("ul", "rx-notlar");
    for (const n of notlar) {
      const li = el("li");
      li.append(el("span", `rx-not-tur rx-not-tur--${n.tur}`, TUR[n.tur] || n.tur), el("span", "rx-not-metin", n.metin));
      ul.append(li);
    }
    return ul;
  };

  function tamListe(kok, surumler) {
    kok.replaceChildren();
    surumler.forEach((s, i) => {
      const li = el("li", "rx-surum");
      li.id = `v${s.surum}`;
      const yan = el("div", "rx-surum__yan");
      const zaman = el("time", "rx-surum__tarih", tarih(s.tarih));
      zaman.dateTime = s.tarih;
      yan.append(el("span", "rx-surum__no", `v${s.surum}`), zaman);
      if (i === 0) yan.append(el("span", "rx-surum__rozet", "En yeni"));
      const govde = el("div", "rx-surum__govde");
      const link = el("a", "rx-surum__link", "GitHub sürüm sayfası →");
      link.href = `https://github.com/${REPO}/releases/tag/v${s.surum}`;
      govde.append(el("h2", "rx-surum__baslik", s.baslik), notListesi(s.notlar), link);
      li.append(yan, govde);
      kok.append(li);
    });
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }

  function ozet(kok, s) {
    kok.replaceChildren(
      el("p", "rx-son-surum__ust", `Bu sürümde · v${s.surum} · ${tarih(s.tarih)}`),
      el("p", "rx-son-surum__baslik", s.baslik),
      notListesi(s.notlar.slice(0, 3)),
    );
    const link = el("a", "rx-son-surum__link", "Güncelleme geçmişi →");
    link.href = "guncellemeler.html";
    kok.append(link);
    kok.hidden = false;
  }

  const tam = document.querySelector("[data-surumler]");
  const kisa = document.querySelector("[data-son-guncelleme]");
  if (tam || kisa) {
    fetch("guncellemeler.json", { cache: "no-cache" })
      .then((r) => r.json())
      .then((veri) => {
        const surumler = (veri.surumler || []).filter((s) => !s.taslak);
        if (tam) tamListe(tam, surumler);
        if (kisa && surumler.length) ozet(kisa, surumler[0]);
      })
      .catch(() => {
        if (tam) tam.replaceChildren(el("li", "rx-surumler__bekle", "Güncellemeler yüklenemedi. GitHub sürüm sayfasına bakabilirsin."));
      });
  }

  // On this page the download button points straight at the latest installer.
  if (tam) {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rel) => {
        const exe = rel && (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
        if (exe) document.querySelectorAll("[data-indir]").forEach((a) => { a.href = exe.browser_download_url; });
      })
      .catch(() => { /* falls back to the releases page */ });
  }
})();
