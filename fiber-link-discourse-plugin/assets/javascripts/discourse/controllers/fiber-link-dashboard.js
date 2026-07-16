import Controller from "@ember/controller";
import { action } from "@ember/object";
import { service } from "@ember/service";

export default class FiberLinkDashboardController extends Controller {
  @service currentUser;

  queryParams = ["withdrawalState", "settlementState"];

  get showWebhookPanel() {
    return Boolean(this.currentUser?.staff);
  }

  withdrawalState = "ALL";
  settlementState = "ALL";

  @action
  retryDashboardSummary() {
    this.model?.retryDashboardSummary?.();
  }
}
