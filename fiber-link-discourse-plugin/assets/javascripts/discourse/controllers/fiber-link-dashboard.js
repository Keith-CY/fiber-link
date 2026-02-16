import Controller from "@ember/controller";

export default class FiberLinkDashboardController extends Controller {
  queryParams = ["withdrawalState", "settlementState"];

  withdrawalState = "ALL";
  settlementState = "ALL";
}
