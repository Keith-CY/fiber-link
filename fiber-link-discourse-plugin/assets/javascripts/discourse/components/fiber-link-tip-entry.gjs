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
    return (
      this.siteSettings.fiber_link_enabled &&
      !!this.currentUser &&
      !!this.postId &&
      !this.isSelfTip
    );
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
    const rawUserId = this.post?.user_id ?? this.post?.userId ?? this.post?.user?.id;
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

  get currentUsername() {
    const username = this.currentUser?.username;
    if (typeof username === "string" && username.trim()) {
      return username.trim().toLowerCase();
    }

    return null;
  }

  get isSelfTip() {
    const currentUserId = Number(this.currentUserId);
    const targetUserId = Number(this.targetUserId);

    if (Number.isFinite(currentUserId) && Number.isFinite(targetUserId)) {
      return currentUserId === targetUserId;
    }

    const targetUsername = this.targetUsername?.toLowerCase?.() ?? null;
    return !!this.currentUsername && !!targetUsername && this.currentUsername === targetUsername;
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
      <div class="fiber-link-tip-entry">
        <DButton
          @translatedTitle="Tip"
          @translatedAriaLabel="Tip"
          @icon="gift"
          @action={{this.openTipModal}}
          @class="fiber-link-tip-entry__button fiber-link-tip-button--icon-only"
          data-fiber-link-tip-button="inline"
        />
      </div>
    {{/if}}
  </template>
}
