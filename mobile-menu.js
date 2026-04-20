(() => {
  function closeMenu(nav) {
    nav.classList.remove("mobile-open");
    document.body.classList.remove("no-scroll");
    const btn = nav.querySelector(".burger-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function openMenu(nav) {
    nav.classList.add("mobile-open");
    document.body.classList.add("no-scroll");
    const btn = nav.querySelector(".burger-btn");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function setupNav(nav) {
    const burger = nav.querySelector(".burger-btn");
    const menu = nav.querySelector(".mobile-menu");
    if (!burger || !menu) return;

    burger.addEventListener("click", () => {
      if (nav.classList.contains("mobile-open")) {
        closeMenu(nav);
      } else {
        openMenu(nav);
      }
    });

    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => closeMenu(nav));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu(nav);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 640) closeMenu(nav);
    });
  }

  document.querySelectorAll(".nav").forEach((nav) => {
    setupNav(nav);
    requestAnimationFrame(() => {
      nav.classList.add("nav-ready");
    });
  });
})();
