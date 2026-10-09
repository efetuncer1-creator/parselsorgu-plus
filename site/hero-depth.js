/* ==========================================================================
   efe-rockstardesign — hero-depth.js
   Depth fly-through hero intro: layered cut-outs travel from deep Z to 0
   in the same duration (camera dolly), with staggered clip reveals, a logo
   mask reveal and a glow beat. Requires GSAP 3 (global `gsap`).

   Markup:
     <div class="rx-hero-stage" data-hero>
       <img class="rx-hero-layer" src="bg.webp"   data-z="0"      alt="">
       <img class="rx-hero-layer" src="car.webp"  data-z="-6000"  data-reveal-beat="5" alt="">
       <img class="rx-hero-layer" src="char.webp" data-z="-4300"  data-reveal-beat="4" alt="">
       <img class="rx-hero-layer" src="logo.svg"  data-z="-15800" data-role="logo" alt="Logo">
       <span class="rx-hero-layer" data-z="-13400" data-role="logo-secondary">VI</span>
     </div>

   Usage:
     const tl = heroDepthIntro(document.querySelector("[data-hero]"), { duration: 2.6, steps: 28 });
     tl.add(() => showNav(), "afterLand");
   ========================================================================== */

(function (global) {
  "use strict";

  const DEFAULTS = {
    duration: 2.6,        // whole intro (s)
    steps: 28,            // beat grid: every time is a multiple of duration/steps
    perspective: 1000,    // px
    cameraEase: "expo.out",
    revealEase: "power2.out",
    revealShape: "inset", // "inset" | "circle"
    glowA: null,          // defaults to CSS --rx-glow-a
    glowB: null,          // defaults to CSS --rx-glow-b
    autoplay: true,
    waitForImages: true,
    imageTimeout: 1200,   // ms: never hold the intro longer than this for slow images
  };

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function decodeImages(root) {
    const imgs = Array.from(root.querySelectorAll("img"));
    return Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
  }

  function heroDepthIntro(stage, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const beat = o.duration / o.steps;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const glowA = o.glowA || cssVar("--rx-glow-a", "#ffacfd");
    const glowB = o.glowB || cssVar("--rx-glow-b", "#ffd398");

    stage.style.perspective = o.perspective + "px";
    stage.style.transformStyle = "preserve-3d";

    const layers = Array.from(stage.querySelectorAll(".rx-hero-layer"));
    const logo = stage.querySelector('[data-role="logo"]');
    const logo2 = stage.querySelector('[data-role="logo-secondary"]');
    const subjects = layers.filter((el) => el !== logo && el !== logo2);

    const hidden = (shape) => (shape === "circle" ? "circle(0% at 50% 50%)" : "inset(50% 50% 50% 50%)");
    const shown = (shape) => (shape === "circle" ? "circle(75% at 50% 50%)" : "inset(0% 0% 0% 0%)");

    const tl = gsap.timeline({ paused: true, defaults: { duration: o.duration, ease: o.cameraEase } });

    // 1. camera dolly: every layer starts at its depth and lands at z:0 together
    layers.forEach((el, i) => {
      el.style.zIndex = String(i + 1);
      el.style.willChange = "transform, opacity, clip-path";
      const z = parseFloat(el.dataset.z || "0");
      if (z !== 0) tl.from(el, { z }, 0);
    });

    // 2. subjects: half-visible early, staggered clip reveal on the beat grid
    subjects.forEach((el) => {
      if (el.dataset.revealBeat == null) return;
      const start = parseFloat(el.dataset.revealBeat) * beat;
      const shape = el.dataset.shape || o.revealShape;
      gsap.set(el, { autoAlpha: 0 });
      tl.set(el, { autoAlpha: 0.5 }, 6 * beat);
      tl.fromTo(el, { clipPath: hidden(shape) },
        { clipPath: shown(shape), ease: o.revealEase, duration: Math.max(beat, o.duration - start) }, start);
      tl.to(el, { autoAlpha: 1, duration: 12 * beat, ease: "power1.out" }, o.duration);
    });

    // 3. logo: mask reveal + glow beat
    if (logo2) {
      gsap.set(logo2, { autoAlpha: 0, "--glow": "0px" });
      logo2.style.filter = `drop-shadow(0 0 var(--glow) ${glowA})`;
      tl.to(logo2, { autoAlpha: 1, duration: 6 * beat, ease: "none" }, 18 * beat);
      tl.fromTo(logo2, { "--glow": "4px" }, { "--glow": "28px", duration: 10 * beat, ease: "none" }, 22 * beat);
    }
    if (logo) {
      gsap.set(logo, { "--glow": "0px" });
      logo.style.filter = `drop-shadow(0 0 var(--glow) ${glowB})`;
      tl.fromTo(logo, { clipPath: "inset(0% 50% 0% 50%)" },
        { clipPath: "inset(0% 0% 0% 0%)", duration: 23 * beat, ease: "power3.inOut" }, 18 * beat);
      tl.to(logo, { "--glow": "18px", duration: 6 * beat, ease: "none" }, 26.6 * beat);
    }
    const glowing = [logo, logo2].filter(Boolean);
    if (glowing.length) tl.to(glowing, { "--glow": "0px", duration: 12 * beat, ease: "power2.in" }, 32.6 * beat);

    // 4. hook for UI after everything lands
    tl.addLabel("afterLand", o.duration);
    tl.eventCallback("onComplete", () => layers.forEach((el) => (el.style.willChange = "auto")));

    const start = () => {
      if (reduce) { tl.progress(1); return; }
      if (o.autoplay) tl.play(0);
    };
    if (o.waitForImages) Promise.race([decodeImages(stage), new Promise((r) => setTimeout(r, o.imageTimeout))]).then(start); else start();

    return tl;
  }

  global.heroDepthIntro = heroDepthIntro;
})(window);
