import getURL from "discourse-common/lib/get-url";
import { withPluginApi } from "discourse/lib/plugin-api";
import { i18n } from "discourse-i18n";
import FiberLinkTipPostMenuButton from "../components/post-menu/fiber-link-tip-post-menu-button";
import { configureFiberLinkApi } from "../services/fiber-link-api";

export const FIBER_LINK_BOOT_EVENT = "fiber-link:bootstrapped";
export const FIBER_LINK_RUNTIME_KEY = "__fiberLinkRuntime";
const FIBER_LINK_DASHBOARD_PATH = "/fiber-link";
const FIBER_LINK_RPC_PATH = "/fiber-link/rpc";
const DASHBOARD_BOOT_TIMEOUT_MS = 15000;
const TOPIC_BOOT_TIMEOUT_MS = 15000;
const INTERSECTION_OBSERVER_GUARD_KEY = "__fiberLinkIntersectionObserverGuard";

function buildRuntimeConfig() {
  return {
    rpcPath: getURL(FIBER_LINK_RPC_PATH),
  };
}

function publishRuntime(runtime) {
  if (typeof window === "undefined") {
    return;
  }

  window[FIBER_LINK_RUNTIME_KEY] = runtime;
  window.dispatchEvent(
    new CustomEvent(FIBER_LINK_BOOT_EVENT, {
      detail: runtime,
    }),
  );
}

function isDashboardPath() {
  if (typeof window === "undefined") {
    return false;
  }

  const path = window.location?.pathname || "";
  return (
    path === FIBER_LINK_DASHBOARD_PATH ||
    path.startsWith(`${FIBER_LINK_DASHBOARD_PATH}/`)
  );
}

function isTopicPath() {
  if (typeof window === "undefined") {
    return false;
  }

  return (window.location?.pathname || "").indexOf("/t/") === 0;
}

function topicTipHasHydrated() {
  return Boolean(
    document.querySelector(
      '[data-fiber-link-tip-button="post-menu"].fiber-link-client-ready-button',
    ),
  );
}

function injectTopicBootFallback() {
  if (!isTopicPath() || topicTipHasHydrated()) {
    return;
  }

  const existing = document.querySelector(
    '[data-fiber-link-topic-state="boot-timeout"]',
  );
  if (existing) {
    return;
  }

  const fallback = document.createElement("aside");
  fallback.className = "fiber-link-topic-boot-timeout";
  fallback.setAttribute("data-fiber-link-topic-state", "boot-timeout");
  fallback.innerHTML = `
    <p class="fiber-link-topic-boot-timeout__message">
      Fiber Link tip actions are still loading. Reload the topic or retry when traffic settles.
    </p>
    <button class="btn btn-primary" type="button" data-fiber-link-topic-retry>
      Reload topic
    </button>
  `;

  fallback
    .querySelector("[data-fiber-link-topic-retry]")
    ?.addEventListener("click", () => window.location.reload());

  const outlet = document.querySelector("#main-outlet, main, body");
  outlet?.prepend(fallback);
}

function scheduleTopicBootFallback() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  window.setTimeout(injectTopicBootFallback, TOPIC_BOOT_TIMEOUT_MS);
}

function dashboardHasRendered() {
  return Boolean(
    document.querySelector(
      '.fiber-link-dashboard, [data-fiber-link-dashboard-state="error"], [data-fiber-link-withdrawal-input="amount"]',
    ),
  );
}

function injectDashboardBootFallback() {
  if (!isDashboardPath() || dashboardHasRendered()) {
    return;
  }

  const existing = document.querySelector(
    '[data-fiber-link-dashboard-state="boot-timeout"]',
  );
  if (existing) {
    return;
  }

  const fallback = document.createElement("main");
  fallback.className =
    "fiber-link-dashboard fiber-link-dashboard__boot-timeout";
  fallback.setAttribute("data-fiber-link-dashboard-state", "boot-timeout");
  fallback.innerHTML = `
    <section class="fiber-link-dashboard__boot-timeout-card">
      <p class="fiber-link-dashboard__alert is-error">
        Fiber Link dashboard is still loading. The service may be busy; retry when traffic settles.
      </p>
      <button class="btn btn-primary" type="button" data-fiber-link-dashboard-retry>
        Retry dashboard
      </button>
    </section>
  `;

  fallback
    .querySelector("[data-fiber-link-dashboard-retry]")
    ?.addEventListener("click", () => window.location.reload());

  document.body?.appendChild(fallback);
}

function scheduleDashboardBootFallback() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  window.setTimeout(injectDashboardBootFallback, DASHBOARD_BOOT_TIMEOUT_MS);
}

function monitorBootFallbacks() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  let observedPath = window.location?.pathname || "";
  let observedAt = Date.now();

  window.setInterval(() => {
    const currentPath = window.location?.pathname || "";
    if (currentPath !== observedPath) {
      observedPath = currentPath;
      observedAt = Date.now();
    }

    const elapsed = Date.now() - observedAt;
    if (isDashboardPath() && elapsed >= DASHBOARD_BOOT_TIMEOUT_MS) {
      injectDashboardBootFallback();
    }

    if (isTopicPath() && elapsed >= TOPIC_BOOT_TIMEOUT_MS) {
      injectTopicBootFallback();
    }
  }, 1000);
}

function normalizeIntersectionObserverRootMargin(rootMargin) {
  if (typeof rootMargin !== "string") {
    return rootMargin;
  }

  const trimmed = rootMargin.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const valid =
    tokens.length >= 1 &&
    tokens.length <= 4 &&
    tokens.every((token) => /^-?(?:\d+|\d*\.\d+)(?:px|%)$/.test(token));

  return valid ? trimmed : "0px 0px 0px 0px";
}

function installIntersectionObserverRootMarginGuard() {
  if (
    typeof window === "undefined" ||
    window[INTERSECTION_OBSERVER_GUARD_KEY]
  ) {
    return;
  }

  const NativeIntersectionObserver = window.IntersectionObserver;
  if (typeof NativeIntersectionObserver !== "function") {
    return;
  }

  function GuardedIntersectionObserver(callback, options = {}) {
    const guardedOptions = {
      ...options,
      rootMargin: normalizeIntersectionObserverRootMargin(options.rootMargin),
    };

    try {
      return new NativeIntersectionObserver(callback, guardedOptions);
    } catch (error) {
      if (/rootMargin/i.test(String(error?.message || error))) {
        return new NativeIntersectionObserver(callback, {
          ...guardedOptions,
          rootMargin: "0px 0px 0px 0px",
        });
      }
      throw error;
    }
  }

  GuardedIntersectionObserver.prototype = NativeIntersectionObserver.prototype;
  window.IntersectionObserver = GuardedIntersectionObserver;
  window[INTERSECTION_OBSERVER_GUARD_KEY] = true;
}

export default {
  name: "fiber-link",

  initialize() {
    installIntersectionObserverRootMarginGuard();

    const runtime = configureFiberLinkApi(buildRuntimeConfig());
    runtime.tipButtonPlacement = "post-menu";

    withPluginApi((api) => {
      api.addQuickAccessProfileItem({
        className: "fiber-link-user-menu-dashboard",
        icon: "gift",
        href: getURL(FIBER_LINK_DASHBOARD_PATH),
        content: i18n("fiber_link.dashboard.user_menu_link"),
      });

      api.registerValueTransformer(
        "post-menu-buttons",
        ({ value: dag, context: { firstButtonKey, lastHiddenButtonKey } }) => {
          dag.add("fiber-link-tip", FiberLinkTipPostMenuButton, {
            before: [firstButtonKey, lastHiddenButtonKey],
          });
        },
      );
    });

    publishRuntime(runtime);
    scheduleDashboardBootFallback();
    scheduleTopicBootFallback();
    monitorBootFallbacks();
  },
};
