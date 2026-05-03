// ══════════════════════════════════════════════════════
//  sentry-init.js — Sentry Browser SDK loader & config
//  Include this script in all HTML pages BEFORE other scripts.
//  Usage: <script src="/sentry-init.js"></script>
// ══════════════════════════════════════════════════════
(function () {
  "use strict";

  var SENTRY_DSN = "https://1af517a6f172fe6b386630dc285498fb@o4511133449519104.ingest.us.sentry.io/4511133473767424";

  // Detect environment from hostname
  function detectEnv() {
    var h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return "development";
    if (h.includes("preview") || h.includes("vercel.app")) return "staging";
    return "production";
  }

  // Sensitive field names to scrub from event data
  var SENSITIVE_KEYS = /password|senha|token|secret|authorization|cookie|cpf|cnpj|credit.?card|cartao/i;

  function scrubObject(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var cleaned = Array.isArray(obj) ? [] : {};
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (SENSITIVE_KEYS.test(key)) {
        cleaned[key] = "[REDACTED]";
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        cleaned[key] = scrubObject(obj[key]);
      } else {
        cleaned[key] = obj[key];
      }
    }
    return cleaned;
  }

  function initSentry() {
    if (typeof Sentry === "undefined") {
      console.warn("[sentry-init] Sentry SDK not loaded — skipping init.");
      return;
    }

    var env = detectEnv();

    Sentry.init({
      dsn: SENTRY_DSN,
      environment: env,
      release: window.__SENTRY_RELEASE__ || "maple-bear-rs@" + (document.querySelector('meta[name="version"]')?.content || "unknown"),

      // Performance monitoring (reduced to save IO budget)
      tracesSampleRate: env === "production" ? 0.05 : 1.0,

      // Session Replay (disabled to prevent 429 flood)
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,

      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
        Sentry.breadcrumbsIntegration({
          console: true,
          dom: true,
          fetch: true,
          history: true,
          xhr: true,
        }),
      ],

      // Scrub sensitive data before sending
      beforeSend: function (event) {
        // Drop events in development unless explicitly enabled
        if (env === "development" && !window.__SENTRY_DEV_ENABLED__) {
          return null;
        }

        // Scrub request data
        if (event.request && event.request.data) {
          event.request.data = scrubObject(event.request.data);
        }

        // Scrub breadcrumb data
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map(function (bc) {
            if (bc.data) bc.data = scrubObject(bc.data);
            return bc;
          });
        }

        // Scrub extra context
        if (event.extra) {
          event.extra = scrubObject(event.extra);
        }

        return event;
      },

      // Ignore common non-actionable errors
      ignoreErrors: [
        "ResizeObserver loop",
        "Non-Error promise rejection captured",
        "Network request failed",
        "Load failed",
        "Failed to fetch",
        "AbortError",
      ],
    });

    // Add navigation breadcrumbs for SPA-like page changes
    window.addEventListener("hashchange", function () {
      Sentry.addBreadcrumb({
        category: "navigation",
        message: "Hash changed to " + window.location.hash,
        level: "info",
      });
    });

    console.info("[sentry-init] Sentry initialized — env=" + env);
  }

  // ── Public helper: set user context after login ──
  window.SentrySetUser = function (email, id, role) {
    if (typeof Sentry === "undefined") return;
    Sentry.setUser({
      email: email || undefined,
      id: id || undefined,
      role: role || undefined,
    });
    Sentry.setTag("user.role", role || "unknown");
  };

  // ── Public helper: clear user context on logout ──
  window.SentryClearUser = function () {
    if (typeof Sentry === "undefined") return;
    Sentry.setUser(null);
  };

  // ── Public helper: capture a message manually ──
  window.SentryCaptureMessage = function (msg, level) {
    if (typeof Sentry === "undefined") return;
    Sentry.captureMessage(msg, level || "info");
  };

  // ── Public helper: capture an exception manually ──
  window.SentryCaptureException = function (err, context) {
    if (typeof Sentry === "undefined") return;
    Sentry.captureException(err, context ? { extra: context } : undefined);
  };

  // Load Sentry SDK from CDN then initialize
  var script = document.createElement("script");
  script.src = "https://browser.sentry-cdn.com/9.25.0/bundle.tracing.replay.min.js";
  script.crossOrigin = "anonymous";
  script.onload = initSentry;
  script.onerror = function () {
    console.warn("[sentry-init] Failed to load Sentry SDK from CDN.");
  };
  document.head.appendChild(script);
})();
