import Component from "@glimmer/component";
import { action } from "@ember/object";

export default class FiberLinkTipButton extends Component {
  @action openTip() {
    this.args.openTipModal();
  }
}
