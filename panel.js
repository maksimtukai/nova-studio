const USERS_STORAGE_KEY = "nova_users";
const SESSION_STORAGE_KEY = "nova_session";
const PANEL_KEY_STORAGE_KEY = "nova_panel_admin_key";
const API_BASES = Array.from(new Set([
  `http://${window.location.hostname}:8093/api`,
  "http://127.0.0.1:8093/api",
  "http://localhost:8093/api"
]));
const FIELD_ICONS = {
  adminKey: "🛡️",
  name: "👤",
  email: "✉️",
  password: "🔒",
  confirmPassword: "🔐",
};

const tabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("panelLoginForm");
const registerForm = document.getElementById("panelRegisterForm");
const loginMessage = document.getElementById("panelLoginMessage");
const registerMessage = document.getElementById("panelRegisterMessage");
const actionMessage = document.getElementById("panelActionMessage");

const panel = document.getElementById("controlPanel");
const serverStatus = document.getElementById("serverStatus");
const startBtn = document.getElementById("startServerBtn");
const stopBtn = document.getElementById("stopServerBtn");
const refreshBtn = document.getElementById("refreshStatusBtn");
const STATUS_REFRESH_MS = 10000;
let statusRefreshTimer = null;

function getUsers() {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || "[]");
    return Array.isArray(users) ? users : [];
  } catch (e) {
    return [];
  }
}

function setUsers(users) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function setMessage(target, text, type) {
  target.textContent = text;
  target.classList.remove("is-error", "is-success");
  if (type) target.classList.add(type);
}

function getPasswordStrength(value) {
  let score = 0;
  if (value.length >= 6) score += 1;
  if (value.length >= 10) score += 1;
  if (/[A-ZА-Я]/.test(value) && /[a-zа-я]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-zА-Яа-я0-9]/.test(value)) score += 1;

  if (!value) return { score: 0, label: "Надёжность пароля", color: "transparent" };
  if (score <= 2) return { score, label: "Слабый пароль", color: "#ff9f9f" };
  if (score <= 4) return { score, label: "Средний пароль", color: "#ffd27f" };
  return { score, label: "Сильный пароль", color: "#7cf0c8" };
}

function attachPasswordToggle(input) {
  if (!input || input.dataset.toggleInit === "1") return;
  input.dataset.toggleInit = "1";
  const wrap = document.createElement("div");
  wrap.className = "password-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "password-toggle";
  btn.textContent = "👁";
  btn.setAttribute("aria-label", "Показать пароль");
  btn.title = "Показать пароль";
  btn.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    btn.textContent = hidden ? "🙈" : "👁";
    btn.title = hidden ? "Скрыть пароль" : "Показать пароль";
  });
  wrap.appendChild(btn);
}

function attachStrengthMeter(input) {
  if (!input || input.dataset.strengthInit === "1") return;
  input.dataset.strengthInit = "1";
  const meter = document.createElement("div");
  meter.className = "strength-meter no-translate";
  meter.setAttribute("aria-hidden", "true");
  meter.innerHTML = '<div class="strength-meter__bar"><div class="strength-meter__fill"></div></div><div class="strength-meter__text">Надёжность пароля</div>';
  input.closest(".field")?.appendChild(meter);

  const fill = meter.querySelector(".strength-meter__fill");
  const text = meter.querySelector(".strength-meter__text");
  let meterRaf = null;
  const render = () => {
    const result = getPasswordStrength(String(input.value || ""));
    fill.style.width = `${Math.min(100, result.score * 20)}%`;
    fill.style.backgroundColor = result.color;
    text.textContent = result.label;
  };
  const scheduleRender = () => {
    if (meterRaf !== null) return;
    meterRaf = requestAnimationFrame(() => {
      meterRaf = null;
      render();
    });
  };
  input.addEventListener("input", scheduleRender);
  render();
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function setupFieldUI() {
  document.querySelectorAll(".field").forEach((field) => {
    const label = field.querySelector("span");
    const input = field.querySelector("input");
    if (!label || !input) return;
    const icon = FIELD_ICONS[input.name];
    if (icon) {
      label.dataset.icon = icon;
    }
    if (input.type === "password") {
      attachPasswordToggle(input);
    }
  });
  attachStrengthMeter(document.querySelector('#panelRegisterForm input[name="password"]'));
}

function wireLiveValidation(form, messageNode, validator) {
  if (!form || !messageNode) return;
  const run = () => {
    let text = "";
    const fields = Array.from(form.querySelectorAll("input"));
    fields.forEach((field) => {
      field.classList.remove("is-invalid");
      field.setCustomValidity("");
      if (!text && !field.checkValidity()) {
        text = field.validationMessage;
      }
    });

    if (validator) {
      const custom = validator();
      if (custom && custom.field) {
        custom.field.classList.add("is-invalid");
        custom.field.setCustomValidity(custom.message);
      }
      if (custom && !text) {
        text = custom.message;
      }
    }
    setMessage(messageNode, text, text ? "is-error" : "");
  };
  const runDebounced = debounce(run, 120);
  form.addEventListener("input", runDebounced);
  form.addEventListener("blur", run, true);
}

function switchTab(tab) {
  const nextTab = tab === "register" ? "login" : tab;
  tabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === nextTab);
  });
  if (loginForm) {
    loginForm.classList.toggle("is-hidden", nextTab !== "login");
  }
  if (registerForm) {
    registerForm.classList.add("is-hidden");
  }
}

function saveSession(user) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    name: user.name,
    email: user.email
  }));
}

function saveAdminKey(adminKey) {
  sessionStorage.setItem(PANEL_KEY_STORAGE_KEY, adminKey);
}

function getAdminKey() {
  return sessionStorage.getItem(PANEL_KEY_STORAGE_KEY) || "";
}

function getSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    return session && session.email ? session : null;
  } catch (e) {
    return null;
  }
}

function isAuthorized() {
  return Boolean(getSession() && getAdminKey());
}

function togglePanelVisibility() {
  panel.classList.toggle("is-hidden", !(isAuthorized() && getAdminKey()));
  if (panel.classList.contains("is-hidden")) {
    stopStatusAutoRefresh();
  } else {
    startStatusAutoRefresh();
  }
}

async function apiFetch(path, method = "GET") {
  const lastError = { value: null };
  for (const base of API_BASES) {
    let response;
    try {
      response = await fetch(`${base}/${path}`, {
        method,
        headers: {
          "X-Admin-Key": getAdminKey()
        }
      });
    } catch (e) {
      lastError.value = e;
      continue;
    }

    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      data = null;
    }

    if (!response.ok) {
      throw new Error((data && data.message) ? data.message : "Ошибка API");
    }
    return data || {};
  }

  throw new Error("Control API недоступен. Запустите control-api.ps1 (порт 8093).");
}

async function fetchServerStatus() {
  try {
    const data = await apiFetch("status");
    serverStatus.textContent = data.running
      ? `Статус: сервер включен (PID ${data.pid})`
      : "Статус: сервер выключен";
  } catch (e) {
    serverStatus.textContent = "Статус: доступ запрещен или API недоступен";
  }
}

function stopStatusAutoRefresh() {
  if (statusRefreshTimer !== null) {
    clearInterval(statusRefreshTimer);
    statusRefreshTimer = null;
  }
}

function startStatusAutoRefresh() {
  if (!isAuthorized() || panel.classList.contains("is-hidden")) {
    stopStatusAutoRefresh();
    return;
  }
  if (statusRefreshTimer !== null) {
    return;
  }
  statusRefreshTimer = setInterval(fetchServerStatus, STATUS_REFRESH_MS);
}

async function sendAction(path) {
  try {
    const data = await apiFetch(path, "POST");
    setMessage(actionMessage, data.message || "Готово", "is-success");
    await fetchServerStatus();
  } catch (e) {
    setMessage(actionMessage, e.message, "is-error");
  }
}

tabs.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

setupFieldUI();
wireLiveValidation(loginForm, loginMessage);
if (registerForm && registerMessage) {
  wireLiveValidation(registerForm, registerMessage, () => {
    const pass = registerForm.querySelector('input[name="password"]');
    const confirm = registerForm.querySelector('input[name="confirmPassword"]');
    if (pass && confirm && confirm.value && pass.value !== confirm.value) {
      return { field: confirm, message: "Пароли не совпадают." };
    }
    return null;
  });

  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(registerForm);
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const password = String(fd.get("password") || "");
    const confirmPassword = String(fd.get("confirmPassword") || "");

    if (!name || !email || !password) {
      setMessage(registerMessage, "Заполните все поля.", "is-error");
      return;
    }
    if (password.length < 6) {
      setMessage(registerMessage, "Пароль должен быть от 6 символов.", "is-error");
      return;
    }
    if (password !== confirmPassword) {
      setMessage(registerMessage, "Пароли не совпадают.", "is-error");
      return;
    }

    const users = getUsers();
    if (users.some((u) => u.email === email)) {
      setMessage(registerMessage, "Пользователь уже существует.", "is-error");
      return;
    }

    users.push({ name, email, password });
    setUsers(users);
    registerForm.reset();
    setMessage(registerMessage, "Регистрация успешна. Войдите.", "is-success");
    switchTab("login");
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fd = new FormData(loginForm);
  const adminKey = String(fd.get("adminKey") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");

  if (!adminKey) {
    setMessage(loginMessage, "Введите ключ администратора.", "is-error");
    return;
  }

  // Проверяем email+пароль через сервер
  let found = null;
  try {
    const authBase = location.protocol === 'file:' ? 'http://localhost:43219/nova/api/auth' : '/nova/api/auth';
    const r = await fetch(authBase + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await r.json();
    if (r.ok && data.name) {
      found = { name: data.name, email: data.email };
      // Сохраняем в localStorage для совместимости
      const users = getUsers();
      if (!users.find(u => u.email === found.email)) {
        users.push({ name: found.name, email: found.email, password });
        setUsers(users);
      }
    }
  } catch (e) {
    // fallback: проверяем localStorage
    const users = getUsers();
    found = users.find((u) => u.email === email && u.password === password) || null;
  }

  if (!found) {
    setMessage(loginMessage, "Неверный email или пароль.", "is-error");
    return;
  }

  saveAdminKey(adminKey);
  saveSession(found);
  try {
    await apiFetch("status");
    await fetchServerStatus();
    setMessage(loginMessage, "Вход выполнен.", "is-success");
    togglePanelVisibility();
  } catch (e) {
    // Не стираем ключ при недоступном API — пусть пользователь сможет повторить попытку,
    // когда Control API будет запущен.
    const msg = String(e && e.message ? e.message : "");
    if (msg.includes("Control API недоступен")) {
      setMessage(loginMessage, msg, "is-error");
    } else {
      sessionStorage.removeItem(PANEL_KEY_STORAGE_KEY);
      setMessage(loginMessage, "Неверный ключ администратора.", "is-error");
    }
  }
});

startBtn.addEventListener("click", () => sendAction("start"));
stopBtn.addEventListener("click", () => sendAction("stop"));
refreshBtn.addEventListener("click", fetchServerStatus);

togglePanelVisibility();
if (isAuthorized()) {
  apiFetch("status")
    .then(() => fetchServerStatus())
    .catch(() => {
      sessionStorage.removeItem(PANEL_KEY_STORAGE_KEY);
      togglePanelVisibility();
    });
}

