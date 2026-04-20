(() => {
  let deferredInstallPrompt = null;

  function handleInstallClick(event) {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
      });
      return;
    }
    showInstallHelp();
  }

  function showInstallHelp() {
    let message = "Чтобы установить приложение, откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».";
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      message = "В Safari нажмите Поделиться и выберите «На экран «Домой»» для установки приложения.";
    } else if (/Android/i.test(navigator.userAgent)) {
      message = "В Chrome или другом браузере откройте меню и выберите «Установить приложение».";
    }
    alert(message);
  }

  function initInstallButtons() {
    const buttons = Array.from(document.querySelectorAll(".install-app-trigger, #installAppBtn"));
    buttons.forEach((btn) => {
      btn.addEventListener("click", handleInstallClick);
      btn.style.display = "inline-flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener("load", () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/nova/sw.js").catch(() => {});
    }
    initInstallButtons();
  });
})();
