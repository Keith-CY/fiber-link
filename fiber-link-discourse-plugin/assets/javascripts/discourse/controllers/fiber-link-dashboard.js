import Controller from "@ember/controller";
import { action } from "@ember/object";

export default class FiberLinkDashboardController extends Controller {
  queryParams = ["withdrawalState", "settlementState"];

  withdrawalState = "ALL";
  settlementState = "ALL";

  @action
  retryDashboardSummary() {
    this.model?.retryDashboardSummary?.();
  }
}
