import Component from "@glimmer/component";
import { action } from "@ember/object";
import { service } from "@ember/service";
import DButton from "discourse/components/d-button";

import FiberLinkTipModal from "./modal/fiber-link-tip-modal";

export default class FiberLinkTipEntry extends Component {
  @service modal;
  @service siteSettings;
  @service currentUser;

  get shouldShow() {
    return this.siteSettings.fiber_link_enabled && !!this.currentUser;
  }

  @action
  async openTipModal() {
    const topic = this.args?.topic;
    const firstPost = topic ? await topic.firstPost() : null;
    const postId = firstPost?.id;
    this.modal.show(FiberLinkTipModal, { model: { postId } });
  }

  <template>
    {{#if this.shouldShow}}
      <div class="fiber-link-tip-entry">
        <DButton @translatedLabel="Tip" @action={{this.openTipModal}} />
      </div>
    {{/if}}
  </template>
}
