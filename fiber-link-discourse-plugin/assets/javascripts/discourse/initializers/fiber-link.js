import getURL from "discourse-common/lib/get-url";
import { withPluginApi } from "discourse/lib/plugin-api";
import FiberLinkTipPostMenuButton from "../components/post-menu/fiber-link-tip-post-menu-button";
import { configureFiberLinkApi } from "../services/fiber-link-api";

export const FIBER_LINK_BOOT_EVENT = "fiber-link:bootstrapped";
export const FIBER_LINK_RUNTIME_KEY = "__fiberLinkRuntime";
const FIBER_LINK_RPC_PATH = "/fiber-link/rpc";

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

export default {
  name: "fiber-link",

  initialize() {
    const runtime = configureFiberLinkApi(buildRuntimeConfig());
    publishRuntime(runtime);

    withPluginApi((api) => {
      if (!api.registerValueTransformer) {
        return;
      }

      api.registerValueTransformer(
        "post-menu-buttons",
        ({ value: dag, context: { firstButtonKey, lastHiddenButtonKey } }) => {
          dag.add("fiber-link-tip", FiberLinkTipPostMenuButton, {
            before: [firstButtonKey, lastHiddenButtonKey],
          });
        },
      );
    });
  },
};
