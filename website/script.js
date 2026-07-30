/* GloveXcel — lightweight interactions for the static showcase */
(() => {
  "use strict";

  const header = document.querySelector(".site-header");
  const menuButton = document.querySelector(".menu-toggle");
  const navMenu = document.querySelector(".nav-menu");
  const navLinks = [...document.querySelectorAll(".nav-menu a")];

  // Mobile navigation
  const closeMenu = () => {
    navMenu.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation menu");
    document.body.classList.remove("menu-open");
  };

  menuButton.addEventListener("click", () => {
    const willOpen = !navMenu.classList.contains("open");
    navMenu.classList.toggle("open", willOpen);
    menuButton.setAttribute("aria-expanded", String(willOpen));
    menuButton.setAttribute("aria-label", willOpen ? "Close navigation menu" : "Open navigation menu");
    document.body.classList.toggle("menu-open", willOpen);
  });

  navLinks.forEach((link) => link.addEventListener("click", closeMenu));
  window.addEventListener("resize", () => {
    if (window.innerWidth > 820) closeMenu();
  });

  // Header state and active navigation link
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  const updateNavigation = () => {
    header.classList.toggle("scrolled", window.scrollY > 20);
    const marker = window.scrollY + 150;
    let currentId = sections[0]?.id;
    sections.forEach((section) => {
      if (section.offsetTop <= marker) currentId = section.id;
    });
    navLinks.forEach((link) => {
      const active = link.getAttribute("href") === `#${currentId}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };

  window.addEventListener("scroll", updateNavigation, { passive: true });
  updateNavigation();

  // Progressive scroll reveal; content stays visible if IntersectionObserver is unavailable
  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -45px" });
    revealItems.forEach((item) => revealObserver.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("visible"));
  }

  // Accessible gallery lightbox
  const lightbox = document.querySelector(".lightbox");
  const lightboxImage = lightbox.querySelector("img");
  const lightboxCaption = lightbox.querySelector("p");
  const lightboxClose = lightbox.querySelector(".lightbox-close");

  document.querySelectorAll("[data-full]").forEach((card) => {
    card.addEventListener("click", () => {
      lightboxImage.src = card.dataset.full;
      lightboxImage.alt = card.dataset.alt;
      lightboxCaption.textContent = card.dataset.alt;
      if (typeof lightbox.showModal === "function") lightbox.showModal();
    });
  });

  const closeLightbox = () => lightbox.close();
  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });
})();
