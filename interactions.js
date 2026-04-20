(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isCoarse = window.matchMedia("(pointer: coarse)").matches;
  const isNarrow = window.matchMedia("(max-width: 768px)").matches;
  const useParallax = !reduceMotion && !isCoarse && !isNarrow;

  function setupRevealOnScroll() {
    const targets = document.querySelectorAll(".auth-card, .hero-copy, .nav");
    if (reduceMotion) {
      targets.forEach((el) => el.classList.add("reveal", "reveal-visible"));
      return;
    }
    targets.forEach((el) => el.classList.add("reveal"));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" }
    );

    targets.forEach((el) => observer.observe(el));
  }

  function setupParallax() {
    if (!useParallax) {
      document.body.classList.add("no-parallax");
      return;
    }

    const body = document.body;
    let rafId = null;
    let mouseX = 0;
    let mouseY = 0;
    let scrollY = window.scrollY || 0;

    const render = () => {
      rafId = null;
      const x = ((mouseX / Math.max(window.innerWidth, 1)) - 0.5) * 16;
      const y = ((mouseY / Math.max(window.innerHeight, 1)) - 0.5) * 12 + scrollY * 0.02;
      body.style.setProperty("--parallax-x", `${x.toFixed(2)}px`);
      body.style.setProperty("--parallax-y", `${y.toFixed(2)}px`);
    };

    const requestRender = () => {
      if (rafId === null) rafId = requestAnimationFrame(render);
    };

    window.addEventListener(
      "mousemove",
      (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        requestRender();
      },
      { passive: true }
    );

    window.addEventListener(
      "scroll",
      () => {
        scrollY = window.scrollY || 0;
        requestRender();
      },
      { passive: true }
    );

    render();
  }

  setupRevealOnScroll();
  setupParallax();
})();
