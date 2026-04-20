(() => {

  const THEME_KEY = "nova_theme";

  const LANG_KEY = "nova_lang";



  const I18N = {

    ru: {

      theme: "Тема",

      dark: "Тёмная",

      light: "Светлая",

      language: "Язык"

    },

    en: {

      theme: "Theme",

      dark: "Dark",

      light: "Light",

      language: "Language"

    }

  };



  const TEXT_MAP = [

    { ru: "Вход", en: "Login" },

    { ru: "Регистрация", en: "Sign up" },

    { ru: "Главная", en: "Home" },

    { ru: "Вход в аккаунт", en: "Sign in" },

    { ru: "Сбросить пароль", en: "Reset password" },

    { ru: "Назад ко входу", en: "Back to login" },

    { ru: "Сброс пароля", en: "Password reset" },

    { ru: "Обновить пароль", en: "Update password" },

    { ru: "Вход в панель", en: "Panel login" },

    { ru: "Регистрация в панель", en: "Panel registration" },

    { ru: "Панель управления сервером", en: "Server control panel" },

    { ru: "Включить сервер", en: "Start server" },

    { ru: "Выключить сервер", en: "Stop server" },

    { ru: "Обновить статус", en: "Refresh status" },

    { ru: "Ключ администратора", en: "Admin key" },

    { ru: "Пароль", en: "Password" },

    { ru: "Имя", en: "Name" },

    { ru: "Повторите пароль", en: "Confirm password" },

    { ru: "Новый пароль", en: "New password" },

    { ru: "Повторите новый пароль", en: "Confirm new password" },

    { ru: "Введите пароль", en: "Enter password" },

    { ru: "Минимум 6 символов", en: "At least 6 characters" },

    { ru: "Секретный ключ", en: "Secret key" },

    { ru: "Войти", en: "Sign in" },

    { ru: "Зарегистрироваться", en: "Create account" },

    { ru: "Уже есть аккаунт?", en: "Already have an account?" },

    { ru: "Нет аккаунта?", en: "No account yet?" },

    { ru: "Пользователь", en: "User" }

  ];



  function getLang() {

    return localStorage.getItem(LANG_KEY) || "ru";

  }



  function setLang(lang) {

    localStorage.setItem(LANG_KEY, lang);

    document.documentElement.lang = lang;

    applyTranslations(lang);

    renderEnhancementsUI(lang);

  }



  function applyTranslations(lang) {

    const dict = TEXT_MAP;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    const textNodes = [];

    while (walker.nextNode()) {

      textNodes.push(walker.currentNode);

    }

    textNodes.forEach((node) => {

      let el = node.parentElement;

      while (el) {

        if (el.classList && el.classList.contains("no-translate")) return;

        el = el.parentElement;

      }

      const value = (node.nodeValue || "").trim();

      if (!value) return;

      const match = dict.find((d) => d.ru === value || d.en === value);

      if (!match) return;

      node.nodeValue = node.nodeValue.replace(value, lang === "en" ? match.en : match.ru);

    });



    document.querySelectorAll("input[placeholder]").forEach((input) => {

      const current = input.getAttribute("placeholder");

      const match = dict.find((d) => d.ru === current || d.en === current);

      if (match) {

        input.setAttribute("placeholder", lang === "en" ? match.en : match.ru);

      }

    });

  }



  function applyTheme(theme) {

    document.body.classList.toggle("theme-light", theme === "light");

    localStorage.setItem(THEME_KEY, theme);

    const toggle = document.getElementById("themeToggle");

    if (toggle) {

      const t = I18N[getLang()];

      toggle.textContent = `${t.theme}: ${theme === "light" ? t.light : t.dark}`;

    }

  }



  function getTheme() {

    return localStorage.getItem(THEME_KEY) || "dark";

  }



  function renderEnhancementsUI(lang) {

    const t = I18N[lang];

    const old = document.getElementById("enhancementsDock");

    if (old) old.remove();



    const dock = document.createElement("div");

    dock.id = "enhancementsDock";

    dock.className = "enhancements-dock";

    dock.innerHTML = `

      <button id="themeToggle" class="dock-btn"></button>

      <label class="dock-select-wrap">

        <span>${t.language}:</span>

        <select id="langSelect" class="dock-select">

          <option value="ru">RU</option>

          <option value="en">EN</option>

        </select>

      </label>

    `;

    document.body.appendChild(dock);



    const themeToggle = document.getElementById("themeToggle");

    const langSelect = document.getElementById("langSelect");



    langSelect.value = lang;

    themeToggle.addEventListener("click", () => {

      const next = getTheme() === "dark" ? "light" : "dark";

      applyTheme(next);

    });

    applyTheme(getTheme());



    langSelect.addEventListener("change", (e) => setLang(e.target.value));

  }



  const lang = getLang();

  document.documentElement.lang = lang;

  applyTheme(getTheme());

  applyTranslations(lang);

  renderEnhancementsUI(lang);

})();

