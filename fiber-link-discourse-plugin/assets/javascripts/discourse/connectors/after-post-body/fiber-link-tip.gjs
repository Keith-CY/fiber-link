/* eslint-disable ember/no-classic-components */
import Component from "@ember/component";
import { tagName } from "@ember-decorators/component";
import FiberLinkTipEntry from "../../components/fiber-link-tip-entry";

@tagName("")
export default class FiberLinkTip extends Component {
  <template>
    <div class="fiber-link-tip-post-entry" ...attributes>
      <FiberLinkTipEntry @post={{@outletArgs.post}} />
    </div>
  </template>
}
