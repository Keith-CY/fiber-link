import { configureFiberLinkApi } from "../services/fiber-link-api";

const FIBER_LINK_BOOT_EVENT = "fiber-link:bootstrapped";
const FIBER_LINK_RUNTIME_KEY = "__fiberLinkRuntime";

export default {
  name: "fiber-link",

  initialize() {
    const runtime = configureFiberLinkApi({ rpcPath: "/fiber-link/rpc" });

    if (typeof window !== "undefined") {
      window[FIBER_LINK_RUNTIME_KEY] = runtime;
      window.dispatchEvent(
        new CustomEvent(FIBER_LINK_BOOT_EVENT, {
          detail: runtime,
        }),
      );
    }
  },
};
