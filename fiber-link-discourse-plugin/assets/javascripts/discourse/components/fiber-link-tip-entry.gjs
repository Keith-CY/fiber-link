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
    return this.siteSettings.fiber_link_enabled && !!this.currentUser && !!this.postId;
  }

  get post() {
    return this.args?.post ?? null;
  }

  get postId() {
    const rawPostId = this.post?.id;
    const parsed = Number(rawPostId);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get targetUserId() {
    const rawUserId = this.post?.user_id ?? this.post?.userId;
    const parsed = Number(rawUserId);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get targetUsername() {
    const username = this.post?.username ?? this.post?.user?.username;
    if (typeof username === "string" && username.trim()) {
      return username.trim();
    }
    return "post author";
  }

  get isSelfTip() {
    const currentUserId = Number(this.currentUser?.id);
    const targetUserId = Number(this.targetUserId);
    if (!Number.isFinite(currentUserId) || !Number.isFinite(targetUserId)) {
      return false;
    }
    return currentUserId === targetUserId;
  }

  @action
  openTipModal() {
    if (!this.postId) {
      return;
    }

    this.modal.show(FiberLinkTipModal, {
      model: {
        postId: this.postId,
        targetUserId: this.targetUserId,
        targetUsername: this.targetUsername,
        isSelfTip: this.isSelfTip,
      },
    });
  }

  <template>
    {{#if this.shouldShow}}
      <div class="fiber-link-tip-entry">
        <DButton
          @translatedLabel="Tip"
          @action={{this.openTipModal}}
          class="fiber-link-tip-entry__button"
        />
      </div>
    {{/if}}
  </template>
}
