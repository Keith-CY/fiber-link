import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";
import { i18n } from "discourse-i18n";

const joinEvents = (events) => (Array.isArray(events) ? events : []).join(", ");
const isInSet = (set, value) => set instanceof Set && set.has(value);
const yesNo = (v) => (v ? i18n("fiber_link.notifications.enabled_yes") : i18n("fiber_link.notifications.enabled_no"));
const lookup = (map, key) => (map ? map[key] : undefined);
const eqStr = (a, b) => a === b;


async function rpcCall(method, params = {}) {
  const { ajax } = await import("discourse/lib/ajax");
  const data = await ajax("/fiber-link/rpc", {
    type: "POST",
    contentType: "application/json",
    dataType: "json",
    data: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  if (data?.error) throw data.error;
  return data?.result;
}

export default class FiberLinkNotifications extends Component {
  @tracked channels = [];
  @tracked isLoading = false;
  @tracked errorMessage = null;
  @tracked isCreating = false;

  @tracked newName = "";
  @tracked newTarget = "";
  @tracked newSecret = "";
  @tracked newEvents = new Set(["TIP_SETTLED"]);
  @tracked busyChannelId = null;
  @tracked testResults = {};

  get supportedEvents() {
    return [
      { value: "TIP_SETTLED", label: i18n("fiber_link.notifications.event_tip_settled") },
      { value: "WITHDRAWAL_COMPLETED", label: i18n("fiber_link.notifications.event_withdrawal_completed") },
      { value: "WITHDRAWAL_FAILED", label: i18n("fiber_link.notifications.event_withdrawal_failed") },
      { value: "WITHDRAWAL_RETRY_PENDING", label: i18n("fiber_link.notifications.event_withdrawal_retry_pending") },
    ];
  }

  constructor(owner, args) {
    super(owner, args);
    this.loadChannels();
  }

  @action setNewName(e) { this.newName = e.target.value; }
  @action setNewTarget(e) { this.newTarget = e.target.value; }
  @action setNewSecret(e) { this.newSecret = e.target.value; }

  @action
  async loadChannels() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.errorMessage = null;
    try {
      const result = await rpcCall("notification.channel.list");
      this.channels = result?.channels ?? [];
    } catch (e) {
      this.errorMessage = e?.message || i18n("fiber_link.notifications.load_failed");
    } finally {
      this.isLoading = false;
    }
  }

  @action
  toggleEvent(event) {
    const next = new Set(this.newEvents);
    if (next.has(event)) {
      next.delete(event);
    } else {
      next.add(event);
    }
    this.newEvents = next;
  }

  @action
  async createChannel(e) {
    e.preventDefault();
    if (!this.newName.trim() || !this.newTarget.trim() || this.newEvents.size === 0) return;
    this.isCreating = true;
    this.errorMessage = null;
    try {
      await rpcCall("notification.channel.create", {
        name: this.newName.trim(),
        kind: "WEBHOOK",
        target: this.newTarget.trim(),
        secret: this.newSecret.trim() || null,
        events: Array.from(this.newEvents),
      });
      this.newName = "";
      this.newTarget = "";
      this.newSecret = "";
      this.newEvents = new Set(["TIP_SETTLED"]);
      await this.loadChannels();
    } catch (e) {
      this.errorMessage = e?.message || i18n("fiber_link.notifications.create_failed");
    } finally {
      this.isCreating = false;
    }
  }

  @action
  async deleteChannel(channel) {
    if (this.busyChannelId) return;
    this.busyChannelId = channel.id;
    this.errorMessage = null;
    try {
      await rpcCall("notification.channel.delete", { channelId: channel.id });
      await this.loadChannels();
    } catch (e) {
      this.errorMessage = e?.message || i18n("fiber_link.notifications.delete_failed");
    } finally {
      this.busyChannelId = null;
    }
  }

  @action
  async testChannel(channel) {
    if (this.busyChannelId) return;
    this.busyChannelId = channel.id;
    this.errorMessage = null;
    try {
      const result = await rpcCall("notification.channel.test", { channelId: channel.id });
      this.testResults = {
        ...this.testResults,
        [channel.id]: result?.delivered
          ? i18n("fiber_link.notifications.test_ok")
          : i18n("fiber_link.notifications.test_failed", { error: result?.error || "" }),
      };
    } catch (e) {
      this.testResults = {
        ...this.testResults,
        [channel.id]: i18n("fiber_link.notifications.test_failed", { error: e?.message || "" }),
      };
    } finally {
      this.busyChannelId = null;
    }
  }

  <template>
    <section class="fiber-link-notifications" data-fiber-link-notifications>
      <div class="fiber-link-notifications__header">
        <h3 class="fiber-link-notifications__title">{{i18n "fiber_link.notifications.title"}}</h3>
        <button
          class="btn btn-small"
          type="button"
          {{on "click" this.loadChannels}}
          disabled={{this.isLoading}}
        >
          {{i18n "fiber_link.notifications.refresh"}}
        </button>
      </div>

      {{#if this.errorMessage}}
        <p class="fiber-link-tip-alert is-error">{{this.errorMessage}}</p>
      {{/if}}

      <form class="fiber-link-notifications__form" {{on "submit" this.createChannel}}>
        <h4>{{i18n "fiber_link.notifications.add_channel_heading"}}</h4>
        <div class="fiber-link-notifications__field">
          <label>{{i18n "fiber_link.notifications.field_name"}}</label>
          <input
            type="text"
            class="input-small"
            placeholder={{i18n "fiber_link.notifications.name_placeholder"}}
            value={{this.newName}}
            {{on "input" this.setNewName}}
          />
        </div>
        <div class="fiber-link-notifications__field">
          <label>{{i18n "fiber_link.notifications.field_url"}}</label>
          <input
            type="url"
            class="input-small"
            placeholder="https://example.com/webhook"
            value={{this.newTarget}}
            {{on "input" this.setNewTarget}}
          />
        </div>
        <div class="fiber-link-notifications__field">
          <label>{{i18n "fiber_link.notifications.field_secret"}}</label>
          <input
            type="password"
            class="input-small"
            placeholder={{i18n "fiber_link.notifications.secret_placeholder"}}
            value={{this.newSecret}}
            {{on "input" this.setNewSecret}}
          />
        </div>
        <div class="fiber-link-notifications__field">
          <label>{{i18n "fiber_link.notifications.field_events"}}</label>
          <div class="fiber-link-notifications__events">
            {{#each this.supportedEvents as |ev|}}
              <label class="fiber-link-notifications__event-label">
                <input
                  type="checkbox"
                  checked={{isInSet this.newEvents ev.value}}
                  {{on "change" (fn this.toggleEvent ev.value)}}
                />
                {{ev.label}}
              </label>
            {{/each}}
          </div>
        </div>
        <button
          class="btn btn-primary btn-small"
          type="submit"
          disabled={{this.isCreating}}
        >
          {{#if this.isCreating}}{{i18n "fiber_link.notifications.creating"}}{{else}}{{i18n "fiber_link.notifications.add_channel_button"}}{{/if}}
        </button>
      </form>

      {{#if this.isLoading}}
        <p class="fiber-link-analytics__loading">{{i18n "fiber_link.notifications.loading"}}</p>
      {{else if this.channels.length}}
        <table class="fiber-link-notifications__table fiber-link-analytics__table">
          <thead>
            <tr>
              <th>{{i18n "fiber_link.notifications.field_name"}}</th>
              <th>{{i18n "fiber_link.notifications.field_url"}}</th>
              <th>{{i18n "fiber_link.notifications.field_events"}}</th>
              <th>{{i18n "fiber_link.notifications.table_enabled"}}</th>
              <th>{{i18n "fiber_link.notifications.table_actions"}}</th>
            </tr>
          </thead>
          <tbody>
            {{#each this.channels as |ch|}}
              <tr>
                <td>{{ch.name}}</td>
                <td class="fiber-link-notifications__target">{{ch.target}}</td>
                <td>{{joinEvents ch.events}}</td>
                <td>{{yesNo ch.enabled}}</td>
                <td class="fiber-link-notifications__actions">
                  {{#if ch.enabled}}
                    <button
                      class="btn btn-small"
                      type="button"
                      disabled={{eqStr this.busyChannelId ch.id}}
                      {{on "click" (fn this.testChannel ch)}}
                    >
                      {{i18n "fiber_link.notifications.action_test"}}
                    </button>
                    <button
                      class="btn btn-danger btn-small"
                      type="button"
                      disabled={{eqStr this.busyChannelId ch.id}}
                      {{on "click" (fn this.deleteChannel ch)}}
                    >
                      {{i18n "fiber_link.notifications.action_delete"}}
                    </button>
                  {{/if}}
                  {{#if (lookup this.testResults ch.id)}}
                    <span class="fiber-link-notifications__test-result">{{lookup this.testResults ch.id}}</span>
                  {{/if}}
                </td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      {{else}}
        <p class="fiber-link-analytics__empty">{{i18n "fiber_link.notifications.empty"}}</p>
      {{/if}}
    </section>
  </template>
}
