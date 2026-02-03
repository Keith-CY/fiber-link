import Route from "@ember/routing/route";

export default class FiberLinkDashboardRoute extends Route {
  model() {
    return { balance: "0" };
  }
}
