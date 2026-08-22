const DEFAULT_THEME = "starry";
const THEME_STORAGE_KEY = "ds-console-theme";

const THEMES = Object.freeze({
  starry: Object.freeze({ key: "starry", label: "Giao diện Tối" }),
  ocean: Object.freeze({ key: "ocean", label: "Giao diện Biển" })
});

function isTheme(value) {
  return typeof value === "string" && value in THEMES;
}

function readStoredTheme() {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(storedTheme) ? storedTheme : DEFAULT_THEME;
}

function updateThemeButtons(theme) {
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.themeOption === theme);
  });
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  updateThemeButtons(theme);
  document.dispatchEvent(new CustomEvent("themechange", { detail: THEMES[theme] }));
}

export function getThemeMeta(theme) {
  return THEMES[theme] ?? THEMES[DEFAULT_THEME];
}

export function setupThemeController() {
  const setTheme = (theme) => {
    if (isTheme(theme)) {
      applyTheme(theme);
    }
  };

  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.onclick = () => setTheme(button.dataset.themeOption);
  });

  setTheme(readStoredTheme());

  return Object.freeze({
    getTheme() {
      return document.body.dataset.theme || DEFAULT_THEME;
    },
    setTheme
  });
}
