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

export default {
  name: "fiber-link",

  initialize() {
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
  },
};
