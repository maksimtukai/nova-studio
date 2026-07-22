(() => {
  const API_ROOT = location.protocol === "file:" ? "http://localhost:43219" : "";
  const ENDPOINT = `${API_ROOT}/api/analytics`;
  const VISITOR_KEY = "nova_visitor_id";
  const SESSION_KEY = "nova_analytics_session";
  const SESSION_STARTED_KEY = "nova_analytics_started";
  const pageStart = Date.now();

  function randomId(prefix) {
    const chunk = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${chunk}`;
  }

  function getVisitorId() {
    try {
      let value = localStorage.getItem(VISITOR_KEY);
      if (!value) {
        value = randomId("visitor");
        localStorage.setItem(VISITOR_KEY, value);
      }
      return value;
    } catch {
      return randomId("visitor");
    }
  }

  function getSessionId() {
    try {
      let value = sessionStorage.getItem(SESSION_KEY);
      if (!value) {
        value = randomId("session");
        sessionStorage.setItem(SESSION_KEY, value);
      }
      return value;
    } catch {
      return randomId("session");
    }
  }

  function getTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }

  function getContext(extra = {}) {
    return Object.assign({
      sessionId: getSessionId(),
      visitorId: getVisitorId(),
      path: location.pathname || "/",
      url: location.href,
      title: document.title,
      ref: document.referrer || "",
      language: navigator.language || "",
      timezone: getTimezone(),
      screen: {
        width: window.screen && window.screen.width ? window.screen.width : 0,
        height: window.screen && window.screen.height ? window.screen.height : 0
      }
    }, extra);
  }

  function sendPayload(payload, preferBeacon = false) {
    const body = JSON.stringify(payload);
    if (preferBeacon && navigator.sendBeacon) {
      try {
        return navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      } catch {
        return false;
      }
    }

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: preferBeacon
    }).catch(() => {});
    return true;
  }

  function track(event, meta = {}, options = {}) {
    const payload = getContext(Object.assign({ event }, meta));
    return sendPayload(payload, Boolean(options.beacon));
  }

  function trackPageview(meta = {}) {
    return track("pageview", meta);
  }

  function trackClick(target) {
    if (!target) return;
    const text = (target.dataset.analyticsLabel || target.getAttribute("aria-label") || target.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const href = target.getAttribute("href") || "";
    track("click", {
      meta: {
        tag: target.tagName.toLowerCase(),
        label: text,
        href,
        id: target.id || "",
        className: target.className || ""
      }
    });
  }

  try {
    if (sessionStorage.getItem(SESSION_STARTED_KEY) !== getSessionId()) {
      sessionStorage.setItem(SESSION_STARTED_KEY, getSessionId());
      track("session_start");
    }
  } catch {
    track("session_start");
  }

  const trackInitialPageview = () => trackPageview();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackInitialPageview, { once: true });
  } else {
    trackInitialPageview();
  }

  document.addEventListener("click", (event) => {
    const target = event.target && event.target.closest
      ? event.target.closest("a, button, [role='button'], [data-analytics-label]")
      : null;
    if (!target) return;
    if (target.hasAttribute("data-analytics-ignore")) return;
    trackClick(target);
  }, true);

  const heartbeat = setInterval(() => {
    track("heartbeat");
  }, 30000);

  window.addEventListener("pagehide", () => {
    clearInterval(heartbeat);
    track("session_end", {
      duration: Math.round((Date.now() - pageStart) / 1000)
    }, { beacon: true });
  });

  window.NovaAnalytics = {
    track,
    trackPageview
  };
})();
