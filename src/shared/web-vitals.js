/**
 * Lumied Web Vitals — inline LCP, FID, CLS tracking
 * No npm dependency. Sends to GA4 + Sentry.
 */

function sendToGA(name, value, delta) {
  try {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', 'web_vitals', {
      metric_name: name,
      value: Math.round(name === 'CLS' ? delta * 1000 : delta),
      metric_id: name,
      non_interaction: true,
    });
  } catch (_) {}
}

function sendToSentry(name, value) {
  try {
    const Sentry = window.Sentry;
    if (!Sentry?.getCurrentHub) return;
    const hub = Sentry.getCurrentHub();
    hub.getScope()?.setTag('web_vitals.' + name.toLowerCase(), String(Math.round(value)));
  } catch (_) {}
}

function report(name, value, delta) {
  sendToGA(name, value, delta);
  sendToSentry(name, value);
}

function observeLCP() {
  if (!('PerformanceObserver' in window)) return;
  try {
    let lastEntry = null;
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        lastEntry = entry;
      }
    });
    po.observe({ type: 'largest-contentful-paint', buffered: true });

    // Report on page hide / visibility change
    const flush = () => {
      if (!lastEntry) return;
      const value = lastEntry.startTime;
      report('LCP', value, value);
      lastEntry = null;
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); }, { once: true });
    window.addEventListener('pagehide', flush, { once: true });
  } catch (_) {}
}

function observeFID() {
  if (!('PerformanceObserver' in window)) return;
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const delta = entry.processingStart - entry.startTime;
        report('FID', delta, delta);
      }
    });
    po.observe({ type: 'first-input', buffered: true });
  } catch (_) {}
}

function observeCLS() {
  if (!('PerformanceObserver' in window)) return;
  try {
    let clsValue = 0;
    let sessionValue = 0;
    let sessionEntries = [];

    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const firstEntry = sessionEntries[0];
        const lastEntry = sessionEntries[sessionEntries.length - 1];

        if (sessionValue &&
            entry.startTime - lastEntry.startTime < 1000 &&
            entry.startTime - firstEntry.startTime < 5000) {
          sessionValue += entry.value;
          sessionEntries.push(entry);
        } else {
          sessionValue = entry.value;
          sessionEntries = [entry];
        }

        if (sessionValue > clsValue) {
          clsValue = sessionValue;
        }
      }
    });
    po.observe({ type: 'layout-shift', buffered: true });

    const flush = () => {
      report('CLS', clsValue, clsValue);
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); }, { once: true });
    window.addEventListener('pagehide', flush, { once: true });
  } catch (_) {}
}

export function initWebVitals() {
  // Defer until after page load to avoid affecting performance
  if (document.readyState === 'complete') {
    observeLCP();
    observeFID();
    observeCLS();
  } else {
    window.addEventListener('load', () => {
      observeLCP();
      observeFID();
      observeCLS();
    });
  }
}
