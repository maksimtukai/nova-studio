const authTabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const loginMessage = document.getElementById("loginMessage");
const registerMessage = document.getElementById("registerMessage");
const resetPasswordForm = document.getElementById("resetPasswordForm");
const resetPasswordMessage = document.getElementById("resetPasswordMessage");
const showResetPassword = document.getElementById("showResetPassword");
const cancelResetPassword = document.getElementById("cancelResetPassword");
const loginLink = document.getElementById("loginLink");
const userChip = document.getElementById("userChip");
const userIcon = document.getElementById("userIcon");
const userName = document.getElementById("userName");

const SESSION_STORAGE_KEY = "nova_session";
const AUTH_API = location.protocol === 'file:' ? 'http://localhost:43219/nova/api/auth' : '/nova/api/auth';
const FIELD_ICONS = {
  name: "👤",
  email: "✉️",
  password: "🔒",
  confirmPassword: "🔐",
  newPassword: "🔒",
  confirmNewPassword: "🔐",
};

async function apiAuth(endpoint, body) {
  const res = await fetch(`${AUTH_API}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

function getSessionUser() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    return session && session.name ? session : null;
  } catch (e) {
    return null;
  }
}

function renderUserIcon() {
  if (!loginLink || !userChip || !userIcon || !userName) return;

  const sessionUser = getSessionUser();
  if (!sessionUser) {
    loginLink.classList.remove("is-hidden");
    userChip.classList.add("is-hidden");
    return;
  }

  userIcon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7ef0d1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
  userName.textContent = sessionUser.name;
  loginLink.classList.add("is-hidden");
  userChip.classList.remove("is-hidden");

  const authCard = document.querySelector(".auth-card");
  if (authCard) authCard.classList.add("is-hidden");
}

function setMessage(target, text, type) {
  target.textContent = text;
  target.classList.remove("is-error", "is-success");
  if (type) {
    target.classList.add(type);
  }
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

function setupFieldIconsAndPasswordUI() {
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

  attachStrengthMeter(document.querySelector('#registerForm input[name="password"]'));
  attachStrengthMeter(document.querySelector('#resetPasswordForm input[name="newPassword"]'));
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function wireLiveValidation(form, messageNode, validator) {
  if (!form || !messageNode) return;
  const run = () => {
    let text = "";
    let type = "";
    let invalidFound = false;
    const fields = Array.from(form.querySelectorAll("input"));
    fields.forEach((field) => {
      field.classList.remove("is-invalid");
      field.setCustomValidity("");
      if (!invalidFound && !field.checkValidity()) {
        invalidFound = true;
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

    if (text) {
      type = "is-error";
    }
    setMessage(messageNode, text, type);
  };

  const runDebounced = debounce(run, 120);
  form.addEventListener("input", runDebounced);
  form.addEventListener("blur", run, true);
}

function switchTab(tab) {
  authTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tab);
  });

  const isLogin = tab === "login";
  loginForm.classList.toggle("is-hidden", !isLogin);
  registerForm.classList.toggle("is-hidden", isLogin);
}

function bindRegistration() {
  if (!registerForm) return;

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const name            = String(formData.get("name") || "").trim();
    const email           = String(formData.get("email") || "").trim().toLowerCase();
    const password        = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (!name || !email || !password) { setMessage(registerMessage, "Заполните все поля.", "is-error"); return; }
    if (password.length < 6) { setMessage(registerMessage, "Пароль должен быть от 6 символов.", "is-error"); return; }
    if (password !== confirmPassword) { setMessage(registerMessage, "Пароли не совпадают.", "is-error"); return; }

    setMessage(registerMessage, "Регистрация...", "");
    const { ok, data } = await apiAuth("register", { name, email, password });
    if (!ok) { setMessage(registerMessage, data.message || "Ошибка сервера.", "is-error"); return; }

    registerForm.reset();
    setMessage(registerMessage, "Регистрация успешна. Войдите!", "is-success");

    if (authTabs.length && loginForm && registerForm) { switchTab("login"); return; }
    setTimeout(() => { window.location.href = "login.html?registered=1"; }, 800);
  });
}

function bindLogin() {
  if (!loginForm) return;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const email    = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");

    setMessage(loginMessage, "Вход...", "");
    try {
      const { ok, data } = await apiAuth("login", { email, password });
      if (!ok) { setMessage(loginMessage, data.message || "Неверный email или пароль.", "is-error"); return; }
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ name: data.name, email: data.email }));
      setMessage(loginMessage, "Успешный вход. Перенаправление...", "is-success");
      setTimeout(() => { window.location.href = "index.html?logged=1"; }, 500);
    } catch(e) {
      setMessage(loginMessage, "Ошибка подключения к серверу. Попробуйте позже.", "is-error");
    }
  });
}

function bindPasswordReset() {
  if (!resetPasswordForm) return;

  function showReset(show) {
    if (loginForm) loginForm.classList.toggle("is-hidden", show);
    resetPasswordForm.classList.toggle("is-hidden", !show);
    if (loginMessage && !show) setMessage(loginMessage, "", "");
    if (resetPasswordMessage && show) setMessage(resetPasswordMessage, "", "");
  }

  if (showResetPassword) showResetPassword.addEventListener("click", (e) => { e.preventDefault(); showReset(true); });
  if (cancelResetPassword) cancelResetPassword.addEventListener("click", (e) => { e.preventDefault(); showReset(false); });

  resetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fd                = new FormData(resetPasswordForm);
    const email             = String(fd.get("email") || "").trim().toLowerCase();
    const newPassword       = String(fd.get("newPassword") || "");
    const confirmNewPassword = String(fd.get("confirmNewPassword") || "");

    if (!email || !newPassword) { setMessage(resetPasswordMessage, "Заполните все поля.", "is-error"); return; }
    if (newPassword.length < 6) { setMessage(resetPasswordMessage, "Пароль должен быть от 6 символов.", "is-error"); return; }
    if (newPassword !== confirmNewPassword) { setMessage(resetPasswordMessage, "Пароли не совпадают.", "is-error"); return; }

    setMessage(resetPasswordMessage, "Обновление...", "");
    const { ok, data } = await apiAuth("reset", { email, newPassword });
    if (!ok) { setMessage(resetPasswordMessage, data.message || "Ошибка.", "is-error"); return; }

    resetPasswordForm.reset();
    setMessage(resetPasswordMessage, "Пароль обновлён. Войдите.", "is-success");
    setTimeout(() => { loginForm?.reset?.(); showReset(false); }, 600);
  });
}

// Если на странице есть вкладки (как было раньше) — привяжем логику переключения.
if (authTabs.length && loginForm && registerForm) {
  authTabs.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

bindRegistration();
bindLogin();
bindPasswordReset();
setupFieldIconsAndPasswordUI();
wireLiveValidation(registerForm, registerMessage, () => {
  if (!registerForm) return null;
  const pass = registerForm.querySelector('input[name="password"]');
  const confirm = registerForm.querySelector('input[name="confirmPassword"]');
  if (pass && confirm && confirm.value && pass.value !== confirm.value) {
    return { field: confirm, message: "Пароли не совпадают." };
  }
  return null;
});
wireLiveValidation(loginForm, loginMessage);
wireLiveValidation(resetPasswordForm, resetPasswordMessage, () => {
  if (!resetPasswordForm) return null;
  const pass = resetPasswordForm.querySelector('input[name="newPassword"]');
  const confirm = resetPasswordForm.querySelector('input[name="confirmNewPassword"]');
  if (pass && confirm && confirm.value && pass.value !== confirm.value) {
    return { field: confirm, message: "Пароли не совпадают." };
  }
  return null;
});
renderUserIcon();

const query = new URLSearchParams(window.location.search);

if (query.get("registered") === "1" && loginMessage) {
  setMessage(loginMessage, "Вы зарегистрировались. Войдите, пожалуйста.", "is-success");
}

if (query.get("logged") === "1") {
  const session = getSessionUser();
  if (session) {
    alert("Добро пожаловать, " + session.name + "!");
  }
}
