import Component from "@glimmer/component";
import { action } from "@ember/object";
import { service } from "@ember/service";
import DButton from "discourse/components/d-button";

import FiberLinkTipModal from "../modal/fiber-link-tip-modal";

export default class FiberLinkTipPostMenuButton extends Component {
  @service modal;
  @service siteSettings;
  @service currentUser;

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

  get currentUserId() {
    const parsed = Number(this.currentUser?.id);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  get isSelfTip() {
    const currentUserId = Number(this.currentUserId);
    const targetUserId = Number(this.targetUserId);
    if (!Number.isFinite(currentUserId) || !Number.isFinite(targetUserId)) {
      return false;
    }
    return currentUserId === targetUserId;
  }

  get shouldShow() {
    return (
      this.siteSettings.fiber_link_enabled &&
      !!this.currentUser &&
      !!this.postId &&
      !this.isSelfTip
    );
  }

  @action
  openTipModal() {
    if (!this.postId) {
      return;
    }

    this.modal.show(FiberLinkTipModal, {
      model: {
        postId: this.postId,
        fromUserId: this.currentUserId,
        targetUserId: this.targetUserId,
        targetUsername: this.targetUsername,
        isSelfTip: this.isSelfTip,
      },
    });
  }

  <template>
    {{#if this.shouldShow}}
      <DButton
        class="post-action-menu__fiber-link-tip"
        @translatedLabel="Tip"
        @icon="hand-holding-dollar"
        @action={{this.openTipModal}}
        ...attributes
      />
    {{/if}}
  </template>
}
