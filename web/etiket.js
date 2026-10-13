// ---- çıktıda ada/parsel numaraları: hepsi yazılır, sığdırılır --------------------------------------------
// Her parselin numarası yazılır; sırayla denenir:
//  1. yatay, parselin içine: taban boyda, sığmazsa en küçük okunur boya kadar küçültülerek
//  2. parselin uzun eksenine döndürülerek (ince uzun parseller)
//  3. parselin üstüne, sınırlarından taşarak (çevresi boşsa)
//  4. dışarıda boş bir yere, parselden ince bir çizgiyle bağlanarak (çok küçük parseller, kalabalık yerler)
// Yazılar birbirinin, çizgilerin ve parsel noktalarının üstüne binmez. Hesap sayfa pikseliyle yapılır; yazı boyu
// ile harita aynı oranda büyüyüp küçüldüğünden yerleşim çözünürlükten bağımsızdır, ölçeğe ve sayfa boyutuna
// göre kendiliğinden değişir. Canlı sayfada da aynısı çizilir (haritadaki numaralar o sırada gizlenir).

const PARSEL_YAZI = { taban: 11.5, enAz: 7, disari: 8.5 }; // ekran pikseli (1/96 inç); 7 px ≈ 5 pt, basılıda okunur
const YAZI_PAYI = 0.15; // yazının çevresinde bırakılan boşluk (yazı boyunun oranı; hale buraya düşer)

// ---- geometri ----------------------------------------------------------------------------------------

const kesisir = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Halkayı dikdörtgene kırpar (Sutherland–Hodgman): çerçeveden taşan parselin görünen kısmı.
function halkaKirp(h, k) {
  const kes = (a, b, e, v) => { const t = (v - a[e]) / (b[e] - a[e]); return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
  let s = h;
  for (const [e, v, ic] of [[0, k.x0, (q) => q[0] >= k.x0], [0, k.x1, (q) => q[0] <= k.x1], [1, k.y0, (q) => q[1] >= k.y0], [1, k.y1, (q) => q[1] <= k.y1]]) {
    const yeni = [];
    s.forEach((b, i) => {
      const a = s[(i + s.length - 1) % s.length];
      if (ic(b)) { if (!ic(a)) yeni.push(kes(a, b, e, v)); yeni.push(b); } else if (ic(a)) yeni.push(kes(a, b, e, v));
    });
    s = yeni;
    if (!s.length) break;
  }
  return s;
}

function noktaIcinde(x, y, halkalar) { // çift-tek kuralı: delikler de doğru sayılır
  let ic = false;
  for (const h of halkalar) for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
    const a = h[i], b = h[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ic = !ic;
  }
  return ic;
}

// İçerideyse sınıra en kısa uzaklık, dışarıdaysa eksi
function isaretliUzaklik(x, y, halkalar) {
  let enAz = Infinity;
  for (const h of halkalar) for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
    const a = h[i], b = h[j];
    let px = a[0], py = a[1], dx = b[0] - px, dy = b[1] - py;
    if (dx || dy) {
      const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy);
      if (t > 1) { px = b[0]; py = b[1]; } else if (t > 0) { px += dx * t; py += dy * t; }
    }
    enAz = Math.min(enAz, (x - px) ** 2 + (y - py) ** 2);
  }
  return (noktaIcinde(x, y, halkalar) ? 1 : -1) * Math.sqrt(enAz);
}

// Parselin içinde sınıra en uzak nokta (polylabel yöntemi: hücreler, en umutlusu bölünerek)
function enIcNokta(halkalar, hassas = 0.5) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of halkalar[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const hucre = (x, y, h) => { const d = isaretliUzaklik(x, y, halkalar); return { x, y, h, d, ust: d + h * Math.SQRT2 }; };
  const kenar = Math.min(x1 - x0, y1 - y0);
  let iyi = hucre((x0 + x1) / 2, (y0 + y1) / 2, 0);
  if (!(kenar > 0)) return iyi;
  const kuyruk = [];
  for (let x = x0; x < x1; x += kenar) for (let y = y0; y < y1; y += kenar) kuyruk.push(hucre(x + kenar / 2, y + kenar / 2, kenar / 2));
  for (let n = 0; kuyruk.length && n < 3000; n++) {
    let i = 0;
    for (let j = 1; j < kuyruk.length; j++) if (kuyruk[j].ust > kuyruk[i].ust) i = j;
    const c = kuyruk[i];
    kuyruk[i] = kuyruk[kuyruk.length - 1];
    kuyruk.pop();
    if (c.d > iyi.d) iyi = c;
    if (c.ust - iyi.d <= hassas) break; // kalanların hiçbiri daha iyisini veremez
    const h = c.h / 2;
    kuyruk.push(hucre(c.x - h, c.y - h, h), hucre(c.x + h, c.y - h, h), hucre(c.x - h, c.y + h, h), hucre(c.x + h, c.y + h, h));
  }
  return iyi;
}

// Doğru parçasının bir kısmı kutunun içinde mi (Liang–Barsky)
function dogruKutuda(a, b, k) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - k.x0], [dx, k.x1 - a[0]], [-dy, a[1] - k.y0], [dy, k.y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; t0 = Math.max(t0, r); } else { if (r < t0) return false; t1 = Math.min(t1, r); }
  }
  return true;
}

// Kutu tümüyle parselin içinde mi: köşeler içeride ve hiçbir kenar kutuya girmiyor.
function kutuIcinde(k, halkalar) {
  if (![[k.x0, k.y0], [k.x1, k.y0], [k.x0, k.y1], [k.x1, k.y1]].every(([x, y]) => noktaIcinde(x, y, halkalar))) return false;
  return !halkalar.some((h) => h.some((a, i) => dogruKutuda(a, h[(i + 1) % h.length], k)));
}

// Parselin uzun ekseni: dış bükey zarfı en küçük alanla saran dikdörtgenin uzun kenarı. Açı (-90°, 90°]
// aralığına getirilir; yazı soldan sağa (dikeyde aşağıdan yukarı) okunur.
function uzunEksen(h) {
  const n = [...h].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const capraz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const yarim = (dizi) => dizi.reduce((z, q) => { while (z.length > 1 && capraz(z[z.length - 2], z[z.length - 1], q) <= 0) z.pop(); z.push(q); return z; }, []);
  const alt = yarim(n), ust = yarim([...n].reverse());
  const zarf = [...alt.slice(0, -1), ...ust.slice(0, -1)];
  let iyi = { alan: Infinity, aci: 0, oran: 1 };
  zarf.forEach((a, i) => {
    const b = zarf[(i + 1) % zarf.length], aci = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(aci), s = Math.sin(aci);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of zarf) { const u = x * c + y * s, v = -x * s + y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const du = u1 - u0, dv = v1 - v0;
    if (du * dv < iyi.alan) iyi = { alan: du * dv, aci: du >= dv ? aci : aci + Math.PI / 2, oran: Math.max(du, dv) / (Math.min(du, dv) || 1e-9) };
  });
  let a = ((iyi.aci % Math.PI) + Math.PI) % Math.PI;
  if (a > (80 * Math.PI) / 180) a -= Math.PI; // dike yakınsa aşağıdan yukarı okunur
  return { aci: a, oran: iyi.oran };
}

// ---- yerleşim -------------------------------------------------------------------------------------------

// Parselin sayfadaki halkaları: çok parçalıysa en büyük parça; çerçeveden taşan kısım kırpılır.
function parselHalkalari(f, g, cerceve) {
  const geo = f.geometry, poligonlar = geo.type === "Polygon" ? [geo.coordinates] : geo.type === "MultiPolygon" ? geo.coordinates : [];
  let iyi = null, iyiAlan = 0.5;
  for (const pol of poligonlar) {
    const halkalar = pol.map((h) => {
      const q = h.map(([lon, lat]) => g.nokta(lat, lon));
      if (q.length > 1 && q[0][0] === q.at(-1)[0] && q[0][1] === q.at(-1)[1]) q.pop();
      return halkaKirp(q, cerceve);
    }).filter((h, i) => h.length >= 3 || i === 0);
    if (halkalar[0].length < 3) continue;
    const alan = halkaAlani(halkalar[0]);
    if (alan > iyiAlan) { iyi = halkalar; iyiAlan = alan; }
  }
  return iyi;
}

// Yazıyı verilen açıyla parselin içine en büyük boyda sığdırır. o: yazı boyu 1 px iken kutunun eni ve boyu.
function yaziSigdir(halkalar, aci, o, enAz, taban) {
  const c = Math.cos(aci), s = Math.sin(aci), oran = o.en / o.boy;
  const don = aci ? halkalar.map((h) => h.map(([x, y]) => [x * c + y * s, -x * s + y * c])) : halkalar;
  // Yükseklik en/boy oranıyla büyütülünce yazı kutusu kare olur; en uzak nokta o karenin en iyi yeridir.
  const m = enIcNokta(don.map((h) => h.map(([x, y]) => [x, y * oran])), enAz * 0.06);
  if (m.d <= 0) return null;
  const cx = m.x, cy = m.y / oran;
  // Merkez sabitken küçük kutu büyüğün içinde kalır: sığan en büyük boy ikiye bölerek bulunur.
  const sigar = (boy) => {
    const hw = (o.en * boy) / 2, hh = (o.boy * boy) / 2;
    return kutuIcinde({ x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }, don);
  };
  let alt = enAz, ust = Math.min(taban, (2 * m.d) / o.en);
  if (ust < alt || !sigar(alt)) return null;
  if (sigar(ust)) alt = ust;
  else while (ust - alt > 0.02 * enAz) { const orta = (alt + ust) / 2; if (sigar(orta)) alt = orta; else ust = orta; }
  return { boy: alt, aci, x: cx * c - cy * s, y: cx * s + cy * c };
}

// Yerleşmiş öğeler dizinde: yazı (döndürülmüş olabilir), bağlantı noktası ya da bağlantı çizgisi.
// Her öğenin eksenlere paralel bir dış kutusu (x0..y1) var; ızgara onunla sorgulanır, çarpışma kesin şekille bakılır.
function yaziOgesi(y, o, sahip) {
  const hw = (o.en * y.boy) / 2, hh = (o.boy * y.boy) / 2, c = Math.abs(Math.cos(y.aci)), s = Math.abs(Math.sin(y.aci));
  const ex = hw * c + hh * s, ey = hw * s + hh * c;
  return { tur: "yazi", x0: y.x - ex, y0: y.y - ey, x1: y.x + ex, y1: y.y + ey, cx: y.x, cy: y.y, hw, hh, aci: y.aci, sahip };
}

// Noktayı döndürülmüş yazının kendi eksenlerine çevirir
function yaziyaGore(e, [x, y]) {
  const c = Math.cos(e.aci), s = Math.sin(e.aci), dx = x - e.cx, dy = y - e.cy;
  return [dx * c + dy * s, -dx * s + dy * c];
}

// Eksenlere paralel kutu ile döndürülmüş yazı kesişiyor mu (ayırma ekseni yöntemi)
function yaziKutuyaDeger(e, k) {
  if (!kesisir(e, k)) return false;
  if (!e.aci) return true;
  const c = Math.cos(e.aci), s = Math.sin(e.aci), kw = (k.x1 - k.x0) / 2, kh = (k.y1 - k.y0) / 2;
  const dx = (k.x0 + k.x1) / 2 - e.cx, dy = (k.y0 + k.y1) / 2 - e.cy;
  // kutunun eksenlerine dış kutu sınamasıyla bakıldı; kalan, yazının iki ekseni
  return Math.abs(dx * c + dy * s) <= e.hw + kw * Math.abs(c) + kh * Math.abs(s)
    && Math.abs(-dx * s + dy * c) <= e.hh + kw * Math.abs(s) + kh * Math.abs(c);
}

function cizgiYaziyaDeger(a, b, e) {
  if (!e.aci) return dogruKutuda(a, b, e);
  return dogruKutuda(yaziyaGore(e, a), yaziyaGore(e, b), { x0: -e.hw, y0: -e.hh, x1: e.hw, y1: e.hh });
}

function dogrularKesisir(a, b, c, d) {
  const yon = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return yon(a, b, c) * yon(a, b, d) < 0 && yon(c, d, a) * yon(c, d, b) < 0;
}

// Izgara dizini: çarpışma sorgusu için. Kutular kapladıkları hücrelere, çizgiler geçtikleri hücrelere yazılır;
// bir öğe birden çok hücrede olabilir, sorguda damgayla bir kez döner.
function kutuDizini(boyut) {
  const hucreler = new Map();
  let damga = 0;
  const kutuHucreleri = (k, fn) => {
    const i1 = Math.floor(k.x1 / boyut), j0 = Math.floor(k.y0 / boyut), j1 = Math.floor(k.y1 / boyut);
    for (let i = Math.floor(k.x0 / boyut); i <= i1; i++) for (let j = j0; j <= j1; j++) fn(i * 1e6 + j);
  };
  const dogruHucreleri = (a, b, fn) => { // ızgarada hücre hücre yürüyerek
    let i = Math.floor(a[0] / boyut), j = Math.floor(a[1] / boyut);
    const dx = b[0] - a[0], dy = b[1] - a[1], si = Math.sign(dx), sj = Math.sign(dy);
    let tx = dx ? ((si > 0 ? i + 1 : i) * boyut - a[0]) / dx : Infinity, ty = dy ? ((sj > 0 ? j + 1 : j) * boyut - a[1]) / dy : Infinity;
    const adx = dx ? boyut / Math.abs(dx) : Infinity, ady = dy ? boyut / Math.abs(dy) : Infinity;
    let n = Math.abs(Math.floor(b[0] / boyut) - i) + Math.abs(Math.floor(b[1] / boyut) - j);
    fn(i * 1e6 + j);
    while (n-- > 0) {
      if (tx < ty) { i += si; tx += adx; } else { j += sj; ty += ady; }
      fn(i * 1e6 + j);
    }
  };
  const koy = (e) => (a) => { const h = hucreler.get(a); if (h) h.push(e); else hucreler.set(a, [e]); };
  const topla = (gez, ...arg) => {
    const sonuc = [], d = ++damga;
    gez(...arg, (a) => { for (const x of hucreler.get(a) || []) if (x.damga !== d) { x.damga = d; sonuc.push(x); } });
    return sonuc;
  };
  return {
    ekle(e) { if (e.tur === "cizgi") dogruHucreleri(e.a, e.b, koy(e)); else kutuHucreleri(e, koy(e)); },
    sor: (k) => topla(kutuHucreleri, k),
    sorDogru: (a, b) => topla(dogruHucreleri, a, b),
  };
}

const aciFarki = (a, b) => Math.abs((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
// Dışarıya konan yazının bedeli: üst üste binme en ağır; çizginin bir yazının altından geçmesi (yazı halesiyle
// okunur kalır) ve uzak düşmek daha hafif. En düşük bedelli yer seçilir.
const BEDEL = { yazi: 100, nokta: 30, kutuCizgi: 6, cizgiYazi: 4, cizgiNokta: 5, cizgiCizgi: 3, adim: 1 };

// Kalabalık yerde içeridekiler de küçük yazılır: dışarıya taşanlara yer açılır, numaralar aynı boyda olur.
// İki boy denenir; dışarıya daha az yazı taşıyan seçilir.
function parselNumaralariniYerlestir(ogeler, cerceve, p) {
  const taban = PARSEL_YAZI.taban * p, kucuk = PARSEL_YAZI.disari * p;
  let kur = iceYerlestir(ogeler, cerceve, p, taban);
  if (kur.kalan.length) {
    const k = iceYerlestir(ogeler, cerceve, p, kucuk);
    kur = k.kalan.length < kur.kalan.length ? k : iceYerlestir(ogeler, cerceve, p, taban);
  }
  disariYerlestir(kur, ogeler, cerceve, p);
}

// 1-3. Sığma hesabı parsel başına bir kez yapılır (o.sigma); boy sınırı değişince yalnızca kırpılır.
function iceYerlestir(ogeler, cerceve, p, tavan) {
  const enAz = PARSEL_YAZI.enAz * p, enCok = PARSEL_YAZI.taban * p, disari = PARSEL_YAZI.disari * p;
  const dizin = kutuDizini(enCok * 1.5), nokta = 2.2 * p, bosluk = 1.5 * p;
  const disarida = [];
  for (const o of ogeler) {
    delete o.yazi; delete o.cizgi;
    if (!o.sigma) {
      // yatay; taban boyda sığmıyorsa uzun eksene döndürülmüş de
      const yatay = yaziSigdir(o.halkalar, 0, o.olcu, enAz, enCok);
      let doner = null;
      if (!yatay || yatay.boy < enCok) {
        const e = uzunEksen(o.halkalar[0]);
        if (e.oran > 1.4 && Math.abs(e.aci) > 0.14) doner = yaziSigdir(o.halkalar, e.aci, o.olcu, enAz, enCok);
      }
      o.sigma = { yatay, doner };
    }
    const kirp = (y) => y && { ...y, boy: Math.min(y.boy, tavan) };
    let y = kirp(o.sigma.yatay);
    const d = kirp(o.sigma.doner);
    if (d && (!y || d.boy > y.boy * 1.15)) y = d;
    if (y) {
      o.yazi = y;
      o.cipa = [y.x, y.y];
      dizin.ekle(yaziOgesi(y, o.olcu, o));
    } else {
      if (!o.merkez) { const m = enIcNokta(o.halkalar, enAz * 0.06); o.merkez = [m.x, m.y]; }
      o.cipa = o.merkez;
      disarida.push(o);
    }
  }
  // Bütün bağlantı noktaları işaretlenir: yazı başka parselin noktasını örtmesin.
  for (const o of disarida) dizin.ekle({ tur: "nokta", x0: o.cipa[0] - nokta, y0: o.cipa[1] - nokta, x1: o.cipa[0] + nokta, y1: o.cipa[1] + nokta, sahip: o });
  // 3: parselin üstü boşsa çizgisiz oraya, sınırlarından taşarak (büyükten küçüğe)
  const kalan = [];
  for (const o of disarida.sort((a, b) => halkaAlani(b.halkalar[0]) - halkaAlani(a.halkalar[0]))) {
    const hw = (o.olcu.en * disari) / 2 + bosluk, hh = (o.olcu.boy * disari) / 2 + bosluk;
    const k = { x0: o.cipa[0] - hw, y0: o.cipa[1] - hh, x1: o.cipa[0] + hw, y1: o.cipa[1] + hh };
    const bos = k.x0 >= cerceve.x0 && k.y0 >= cerceve.y0 && k.x1 <= cerceve.x1 && k.y1 <= cerceve.y1
      && !dizin.sor(k).some((e) => e.sahip !== o && (e.tur === "yazi" ? yaziKutuyaDeger(e, k) : kesisir(e, k)));
    if (!bos) { kalan.push(o); continue; }
    o.yazi = { boy: disari, aci: 0, x: o.cipa[0], y: o.cipa[1] };
    dizin.ekle(yaziOgesi(o.yazi, o.olcu, o));
  }
  return { dizin, kalan, nokta, bosluk };
}

// 4. Kalanlar çevrede en düşük bedelli yere, parsele ince çizgiyle bağlanarak. Çok kalabalıkta süre aşılırsa
// arama daraltılır, sonra bırakılır (kalanlar ilk boş görünen yere); yine de her numara yazılır.
function disariYerlestir({ dizin, kalan, nokta, bosluk }, ogeler, cerceve, p) {
  if (!kalan.length) return;
  const disari = PARSEL_YAZI.disari * p;
  // Önce komşu parsellerin az olduğu yönde aranır: yakındaki parsel noktalarından uzaklaşan yön
  const yaricap = PARSEL_YAZI.taban * p * 12;
  for (const o of kalan) {
    let vx = 0, vy = 0;
    for (const b of ogeler) {
      const dx = o.cipa[0] - b.cipa[0], dy = o.cipa[1] - b.cipa[1], d2 = dx * dx + dy * dy;
      if (b !== o && d2 < yaricap * yaricap) { vx += dx / (d2 + 1); vy += dy / (d2 + 1); }
    }
    o.yon = Math.hypot(vx, vy) > 1e-9 ? Math.atan2(vy, vx) : -Math.PI / 4;
  }
  // Kalabalığın dışındakiler önce yerleşir, içerdekiler onların ötesine
  const merkez = kalan.reduce((t, o) => [t[0] + o.cipa[0] / kalan.length, t[1] + o.cipa[1] / kalan.length], [0, 0]);
  const uzaklik = (o) => Math.hypot(o.cipa[0] - merkez[0], o.cipa[1] - merkez[1]);
  kalan.sort((a, b) => uzaklik(b) - uzaklik(a));
  const bas = performance.now();
  for (const o of kalan) {
    const gecen = performance.now() - bas, hizli = gecen > 1000, YON = hizli ? 8 : 16, enUzak = gecen > 2000 ? 0 : hizli ? 6 : 40;
    const hw = (o.olcu.en * disari) / 2, hh = (o.olcu.boy * disari) / 2, adim = Math.max(hh, 3 * p);
    const yonler = [...Array(YON).keys()].map((i) => (i * 2 * Math.PI) / YON).sort((a, b) => aciFarki(a, o.yon) - aciFarki(b, o.yon));
    let iyi = null;
    for (let r = 0; r <= enUzak && !(iyi && r * BEDEL.adim >= iyi.bedel); r++) {
      for (const a of yonler) {
        const x = o.cipa[0] + Math.cos(a) * (hw + nokta + bosluk + r * adim), y = o.cipa[1] + Math.sin(a) * (hh + nokta + bosluk + r * adim);
        const k = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
        if (k.x0 < cerceve.x0 || k.y0 < cerceve.y0 || k.x1 > cerceve.x1 || k.y1 > cerceve.y1) continue;
        const genis = { x0: k.x0 - bosluk, y0: k.y0 - bosluk, x1: k.x1 + bosluk, y1: k.y1 + bosluk };
        // Bedel, o ana kadarki en iyiyi geçince sayım bırakılır
        const sinir = iyi ? iyi.bedel : Infinity;
        let bedel = r * BEDEL.adim;
        for (const e of dizin.sor(genis)) {
          if (e.tur === "yazi") bedel += yaziKutuyaDeger(e, genis) ? BEDEL.yazi : 0;
          else if (e.tur === "nokta") bedel += kesisir(e, genis) ? BEDEL.nokta : 0;
          else bedel += dogruKutuda(e.a, e.b, genis) ? BEDEL.kutuCizgi : 0;
          if (bedel >= sinir) break;
        }
        if (bedel >= sinir) continue;
        const uc = [Math.min(Math.max(o.cipa[0], k.x0), k.x1), Math.min(Math.max(o.cipa[1], k.y0), k.y1)];
        for (const e of dizin.sorDogru(o.cipa, uc)) {
          if (e.sahip === o) continue;
          if (e.tur === "yazi") bedel += cizgiYaziyaDeger(o.cipa, uc, e) ? BEDEL.cizgiYazi : 0;
          else if (e.tur === "nokta") bedel += dogruKutuda(o.cipa, uc, e) ? BEDEL.cizgiNokta : 0;
          else bedel += dogrularKesisir(o.cipa, uc, e.a, e.b) ? BEDEL.cizgiCizgi : 0;
          if (bedel >= sinir) break;
        }
        if (bedel < sinir) iyi = { x, y, uc, bedel };
        if (bedel === r * BEDEL.adim) break; // bu uzaklıkta engelsiz yer
      }
    }
    if (!iyi) { // çerçevede hiç yer yok: noktanın üstüne
      const [x, y] = o.cipa;
      iyi = { x, y: y - hh - nokta, uc: [x, y - nokta] };
    }
    o.yazi = { boy: disari, aci: 0, x: iyi.x, y: iyi.y };
    o.cizgi = iyi.uc;
    dizin.ekle(yaziOgesi(o.yazi, o.olcu, o));
    dizin.ekle({ tur: "cizgi", a: o.cipa, b: iyi.uc, sahip: o });
  }
}

// ---- çizim ------------------------------------------------------------------------------------------------

function parselNumaralariCiz(ctx, g, hc, p) {
  const cerceve = { x0: hc.x, y0: hc.y, x1: hc.x + hc.en, y1: hc.y + hc.boy };
  ctx.save();
  ctx.font = "700 100px Inter, sans-serif";
  const ogeler = [];
  for (const f of durum.parseller.values()) {
    const halkalar = parselHalkalari(f, g, cerceve);
    if (!halkalar) continue;
    const metin = `${f.properties.ada}/${f.properties.parsel}`, m = ctx.measureText(metin);
    const ust = m.actualBoundingBoxAscent / 100, alt = m.actualBoundingBoxDescent / 100;
    ogeler.push({ metin, halkalar, olcu: { en: m.width / 100 + 2 * YAZI_PAYI, boy: ust + alt + 2 * YAZI_PAYI, kayma: (ust - alt) / 2 } });
  }
  parselNumaralariniYerlestir(ogeler, cerceve, p);

  const renk = token("--harita-yazi"), hale = token(acikRenk(renk) ? "--harita-yazi-hale" : "--not-hale-acik");
  ctx.lineJoin = ctx.lineCap = "round";
  // Önce bağlantı çizgileri ve noktaları (hale altta), sonra yazılar
  const cizgiler = ogeler.filter((o) => o.cizgi);
  for (const [w, c] of [[2.6 * p, hale], [0.9 * p, renk]]) {
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.beginPath();
    for (const o of cizgiler) { ctx.moveTo(...o.cipa); ctx.lineTo(...o.cizgi); }
    ctx.stroke();
  }
  for (const o of cizgiler) {
    ctx.beginPath();
    ctx.arc(...o.cipa, 1.7 * p, 0, 2 * Math.PI);
    ctx.fillStyle = renk; ctx.lineWidth = 0.9 * p; ctx.strokeStyle = hale;
    ctx.fill(); ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const o of ogeler) {
    const y = o.yazi;
    if (!y) continue;
    ctx.save();
    ctx.translate(y.x, y.y);
    if (y.aci) ctx.rotate(y.aci);
    ctx.font = `700 ${y.boy}px Inter, sans-serif`;
    ctx.lineWidth = y.boy * 0.3;
    ctx.strokeStyle = hale;
    ctx.strokeText(o.metin, 0, o.olcu.kayma * y.boy);
    ctx.fillStyle = renk;
    ctx.fillText(o.metin, 0, o.olcu.kayma * y.boy);
    ctx.restore();
  }
  ctx.restore();
}
