function animateWithCss(elements) {
  elements.forEach((element, index) => {
    element.classList.remove("is-motion-ready");
    element.style.animationDelay = `${Math.min(index * 35, 280)}ms`;
    void element.offsetWidth;
    element.classList.add("is-motion-ready");
  });
}

function animateWithGsap(elements) {
  window.gsap.killTweensOf(elements);
  window.gsap.fromTo(
    elements,
    { autoAlpha: 0, y: 14 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.48,
      ease: "power3.out",
      overwrite: true,
      stagger: 0.035,
      onComplete: () => window.gsap.set(elements, { clearProps: "opacity,transform,visibility" })
    }
  );
}

function isVisible(element) {
  return Boolean(element) && !element.closest(".hidden");
}

function getViewMotionElements(authenticated) {
  const root = document.getElementById(authenticated ? "app-view" : "login-view");
  if (!isVisible(root)) {
    return [];
  }

  return Array.from(root.querySelectorAll("[data-motion]")).filter(isVisible);
}

function getTabMotionElements(tab) {
  const panel = document.getElementById(`tab-${tab}`);
  return panel?.matches("[data-motion]") && isVisible(panel) ? [panel] : [];
}

export function setupMotionEffects() {
  const run = (elements) => {
    if (!elements.length) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => {
        element.style.opacity = "1";
        element.style.transform = "none";
      });
      return;
    }

    if (window.gsap) {
      animateWithGsap(elements);
      return;
    }

    animateWithCss(elements);
  };

  let activeView = document.getElementById("app-view")?.classList.contains("hidden")
    ? "login"
    : "app";

  requestAnimationFrame(() => run(getViewMotionElements(activeView === "app")));
  document.addEventListener("apptabchange", (event) => {
    requestAnimationFrame(() => run(getTabMotionElements(event.detail?.tab)));
  });
  document.addEventListener("appviewchange", (event) => {
    const nextView = event.detail?.authenticated ? "app" : "login";
    if (nextView === activeView) {
      return;
    }

    activeView = nextView;
    requestAnimationFrame(() => run(getViewMotionElements(activeView === "app")));
  });

  return { run };
}
