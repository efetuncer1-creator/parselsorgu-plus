/* ==========================================================================
   efe-rockstardesign — scroll-scenes.js
   Lenis smooth scroll wired to GSAP ScrollTrigger + scene recipes.
   Requires globals: gsap, ScrollTrigger, Lenis.
   ========================================================================== */

(function (global) {
  "use strict";

  gsap.registerPlugin(ScrollTrigger);
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- smooth scroll ---------------------------------------------------- */
  function initSmoothScroll(opts) {
    if (reduceMotion() || typeof Lenis === "undefined") return null;
    const lenis = new Lenis(Object.assign({ lerp: 0.07, wheelMultiplier: 1.2, smoothWheel: true, syncTouch: false }, opts));
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    return lenis;
  }

  /* ---- pinned scene: section sticks while `build(tl, el)` plays ---------- */
  // length: desktop/mobile pin lengths ("+=225%" etc.)
  function pinScene(section, build, opts) {
    const o = Object.assign({ length: "+=200%", mobileLength: "+=260%" }, opts);
    const mobile = window.matchMedia("(max-width: 767.98px)").matches;
    if (reduceMotion()) { const tl = gsap.timeline(); build(tl, section); tl.progress(1); return tl; }
    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: section, pin: true, start: "top top",
        end: mobile ? o.mobileLength : o.length, scrub: true,
        onLeave: o.onLeave, onEnterBack: o.onEnterBack,
      },
    });
    build(tl, section);
    return tl;
  }

  /* ---- enter scrub: animate while the section rises into view ----------- */
  function enterScrub(el, fromVars, opts) {
    const o = Object.assign({ start: "top bottom", end: "top top" }, opts);
    if (reduceMotion()) return null;
    return gsap.from(el, Object.assign({ ease: "none", scrollTrigger: { trigger: o.trigger || el, start: o.start, end: o.end, scrub: true } }, fromVars));
  }

  /* ---- overlapping pin: next section slides over this one --------------- */
  function stackPin(section, nextSection) {
    if (reduceMotion()) return null;
    return ScrollTrigger.create({ trigger: section, pin: true, pinSpacing: false, start: "top top", endTrigger: nextSection, end: "top top" });
  }

  /* ---- parallax: [data-speed] = percent of travel (e.g. 15 or -10) ------ */
  function parallax(selector) {
    if (reduceMotion()) return;
    gsap.utils.toArray(selector || "[data-speed]").forEach((el) => {
      const s = parseFloat(el.dataset.speed || "10");
      gsap.fromTo(el, { yPercent: -s }, { yPercent: s, ease: "none",
        scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
    });
  }

  /* ---- one-shot reveal for copy & cards (not scrubbed) ------------------- */
  function reveals(selector) {
    const els = gsap.utils.toArray(selector || "[data-reveal]");
    if (reduceMotion()) { gsap.set(els, { autoAlpha: 1, y: 0 }); return; }
    gsap.set(els, { autoAlpha: 0 });
    ScrollTrigger.batch(els, {
      start: "top 85%",
      onEnter: (batch) => gsap.fromTo(batch, { autoAlpha: 0, y: 32 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power2.out", stagger: 0.08, overwrite: true }),
      onLeaveBack: (batch) => gsap.to(batch, { autoAlpha: 0, y: 32, duration: 0.4, ease: "power2.in", overwrite: true }),
    });
  }

  /* ---- horizontal rail: vertical scroll drives a horizontal track -------- */
  function horizontalRail(section, track) {
    if (reduceMotion()) return null;
    const distance = () => track.scrollWidth - window.innerWidth;
    return gsap.to(track, {
      x: () => -distance(), ease: "none",
      scrollTrigger: { trigger: section, pin: true, start: "top top", end: () => "+=" + distance(), scrub: true, invalidateOnRefresh: true },
    });
  }

  /* ---- video scrubbed by scroll ----------------------------------------- */
  function scrubVideo(video, trigger, opts) {
    const o = Object.assign({ start: "top top", end: "+=200%", pin: true }, opts);
    const go = () => ScrollTrigger.create({
      trigger: trigger || video, start: o.start, end: o.end, pin: o.pin, scrub: true,
      onUpdate: ({ progress }) => { if (video.duration) video.currentTime = progress * video.duration; },
    });
    if (video.readyState >= 1) return go();
    video.addEventListener("loadedmetadata", go, { once: true });
  }

  /* ---- refresh after fonts/images so pin positions are correct ---------- */
  function refreshWhenReady() {
    const imgs = Array.from(document.images).filter((i) => !i.complete);
    Promise.all([document.fonts ? document.fonts.ready : null,
      ...imgs.map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }))])
      .then(() => ScrollTrigger.refresh());
  }

  global.rxScroll = { initSmoothScroll, pinScene, enterScrub, stackPin, parallax, reveals, horizontalRail, scrubVideo, refreshWhenReady };
})(window);
