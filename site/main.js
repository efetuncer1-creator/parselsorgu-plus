/* Parsel Sorgu + — site wiring: hero intro, scroll scenes, latest release link. */
(function () {
  "use strict";
  const { initSmoothScroll, pinScene, parallax, reveals, horizontalRail, refreshWhenReady } = window.rxScroll;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const REPO = "efetuncer1-creator/parselsorgu-plus";

  // Intro pages: a reload should replay the intro instead of landing mid-page.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (!location.hash) window.scrollTo(0, 0);

  const lenis = initSmoothScroll();

  // ---- HERO -------------------------------------------------------------------
  // The wordmark and mark stack above the UI block; its height drives their offsets.
  const hero = document.querySelector(".rx-hero");
  const heroUi = document.querySelector(".rx-hero__ui");
  const measure = () => hero.style.setProperty("--rx-hero-ui-h", heroUi.offsetHeight + "px");
  measure();
  new ResizeObserver(measure).observe(heroUi);

  const DURATION = 2.8, STEPS = 28, beat = DURATION / STEPS;
  const ui = gsap.utils.toArray("[data-hero-ui]");
  const nav = document.querySelector("[data-nav]");
  gsap.set([...ui, nav], { autoAlpha: 0 });
  gsap.set(".rx-parcels path", { strokeDasharray: 1, strokeDashoffset: 1 });

  const intro = heroDepthIntro(document.querySelector("[data-hero]"), { duration: DURATION, steps: STEPS });
  // The plate settles while the camera flies in; outlines draw themselves on the beat grid.
  intro.fromTo("[data-plate]", { scale: 1.18 }, { scale: 1, duration: DURATION, ease: "expo.out" }, 0);
  intro.to(".rx-parcels .alan", { strokeDashoffset: 0, duration: 12 * beat, ease: "power2.inOut" }, 3 * beat);
  intro.to(".rx-parcels .p", { strokeDashoffset: 0, duration: 7 * beat, ease: "power2.out", stagger: { each: 0.022, from: "random" } }, 7 * beat);
  intro.to(nav, { autoAlpha: 1, duration: 0.6, ease: "power1.out" }, "afterLand");
  intro.fromTo(ui, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: "power2.out", stagger: 0.12 }, "afterLand+=0.1");

  // Leaving the hero: the map pushes in and dims.
  if (!reduce) {
    gsap.to("[data-hero]", {
      scale: 1.06, autoAlpha: 0.35, ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true },
    });
  }
  ScrollTrigger.create({
    trigger: hero, start: "bottom top+=80",
    onEnter: () => nav.classList.add("is-solid"), onLeaveBack: () => nav.classList.remove("is-solid"),
  });

  // ---- AREA SCENE: screen tilts flat while the counters fill ---------------------
  const counters = gsap.utils.toArray("[data-sayac]");
  const format = (el, v) => el.dataset.bicim === "yuzde"
    ? "%" + v.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.round(v).toLocaleString("tr-TR");
  const countUp = (tl, at) => counters.forEach((el, i) => {
    const state = { v: 0 };
    tl.to(state, { v: parseFloat(el.dataset.sayac), duration: 1, onUpdate: () => { el.textContent = format(el, state.v); } }, at + i * 0.15);
  });

  const mm = gsap.matchMedia();
  if (!reduce) {
    mm.add("(min-width: 1024px)", () => {
      counters.forEach((el) => { el.textContent = format(el, 0); });
      pinScene(document.querySelector("[data-alan]"), (tl) => {
        tl.fromTo(".rx-alan__ekran img",
          { rotateX: 16, scale: 0.86, yPercent: 6, autoAlpha: 0.35 },
          { rotateX: 0, scale: 1, yPercent: 0, autoAlpha: 1, duration: 1 }, 0);
        tl.from(".rx-alan__icerik > *", { autoAlpha: 0, y: 30, stagger: 0.1, duration: 0.6 }, 0.1);
        countUp(tl, 0.55);
        tl.to({}, { duration: 0.5 });
      }, { length: "+=160%" });
      return () => counters.forEach((el) => { el.textContent = format(el, parseFloat(el.dataset.sayac)); });
    });
    mm.add("(max-width: 1023.98px)", () => {
      ScrollTrigger.create({
        trigger: ".rx-sayaclar", start: "top 85%", once: true,
        onEnter: () => {
          counters.forEach((el) => { el.textContent = format(el, 0); });
          const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
          countUp(tl, 0);
        },
      });
    });
  }

  // ---- SCENES, COPY, RAIL ---------------------------------------------------------
  parallax("[data-speed]");
  reveals("[data-reveal]");

  mm.add("(min-width: 768px)", () => {
    horizontalRail(document.querySelector("[data-rail]"), document.querySelector("[data-rail-track]"));
  });
  mm.add("(max-width: 767.98px)", () => {
    const track = document.querySelector("[data-rail-track]");
    Object.assign(track.style, { overflowX: "auto", width: "auto", scrollSnapType: "x mandatory", paddingBottom: "8px" });
    track.setAttribute("data-lenis-prevent", "");
    return () => { track.removeAttribute("style"); track.removeAttribute("data-lenis-prevent"); };
  });

  // In-page anchors go through Lenis.
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (id.length < 2 || !lenis) return;
    const target = document.querySelector(id);
    if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: -64 }); }
  }));

  // ---- LATEST RELEASE: direct installer link, version and size -------------------
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => {
      if (!rel) return;
      document.querySelectorAll("[data-surum]").forEach((el) => { el.textContent = rel.tag_name; });
      const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
      if (!exe) return;
      const mb = (exe.size / 1048576).toLocaleString("tr-TR", { maximumFractionDigits: 1 });
      document.querySelectorAll("[data-indir]").forEach((a) => { a.href = exe.browser_download_url; });
      document.querySelectorAll("[data-indir-bilgi]").forEach((el) => { el.textContent = `${rel.tag_name} · ${mb} MB · Windows 10/11`; });
    })
    .catch(() => { /* the button already points at the releases page */ });

  refreshWhenReady();
})();
