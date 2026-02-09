/* eslint-disable ember/no-classic-components */
import Component from "@ember/component";
import { tagName } from "@ember-decorators/component";
import FiberLinkTipEntry from "../../components/fiber-link-tip-entry";

@tagName("")
export default class FiberLinkTip extends Component {
  <template>
    <div class="topic-above-post-stream-outlet fiber-link-tip" ...attributes>
      <FiberLinkTipEntry />
    </div>
  </template>
}
