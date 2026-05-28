import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";

const joinEvents = (events) => (Array.isArray(events) ? events : []).join(", ");
const isInSet = (set, value) => set instanceof Set && set.has(value);
const yesNo = (v) => (v ? "Yes" : "No");

const SUPPORTED_EVENTS = [
  { value: "TIP_SETTLED", label: "Tip settled" },
  { value: "WITHDRAWAL_COMPLETED", label: "Withdrawal completed" },
  { value: "WITHDRAWAL_FAILED", label: "Withdrawal failed" },
  { value: "WITHDRAWAL_RETRY_PENDING", label: "Withdrawal retry pending" },
];

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

  get supportedEvents() {
    return SUPPORTED_EVENTS;
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
      this.errorMessage = e?.message || "Failed to load webhook channels.";
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
      this.errorMessage = e?.message || "Failed to create webhook channel.";
    } finally {
      this.isCreating = false;
    }
  }

  <template>
    <section class="fiber-link-notifications" data-fiber-link-notifications>
      <div class="fiber-link-notifications__header">
        <h3 class="fiber-link-notifications__title">Webhook Channels</h3>
        <button
          class="btn btn-small"
          type="button"
          {{on "click" this.loadChannels}}
          disabled={{this.isLoading}}
        >
          Refresh
        </button>
      </div>

      {{#if this.errorMessage}}
        <p class="fiber-link-tip-alert is-error">{{this.errorMessage}}</p>
      {{/if}}

      <form class="fiber-link-notifications__form" {{on "submit" this.createChannel}}>
        <h4>Add webhook channel</h4>
        <div class="fiber-link-notifications__field">
          <label>Name</label>
          <input
            type="text"
            class="input-small"
            placeholder="My webhook"
            value={{this.newName}}
            {{on "input" this.setNewName}}
          />
        </div>
        <div class="fiber-link-notifications__field">
          <label>URL</label>
          <input
            type="url"
            class="input-small"
            placeholder="https://example.com/webhook"
            value={{this.newTarget}}
            {{on "input" this.setNewTarget}}
          />
        </div>
        <div class="fiber-link-notifications__field">
          <label>Secret (optional, for HMAC signature)</label>
          <input
            type="password"
            class="input-small"
            placeholder="at least 8 characters"
            value={{this.newSecret}}
            {{on "input" this.setNewSecret}}
          />
        </div>
        <div class="fiber-link-notifications__field">
          <label>Events</label>
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
          {{#if this.isCreating}}Creating…{{else}}Add Channel{{/if}}
        </button>
      </form>

      {{#if this.isLoading}}
        <p class="fiber-link-analytics__loading">Loading channels…</p>
      {{else if this.channels.length}}
        <table class="fiber-link-notifications__table fiber-link-analytics__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Events</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {{#each this.channels as |ch|}}
              <tr>
                <td>{{ch.name}}</td>
                <td class="fiber-link-notifications__target">{{ch.target}}</td>
                <td>{{joinEvents ch.events}}</td>
                <td>{{yesNo ch.enabled}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      {{else}}
        <p class="fiber-link-analytics__empty">No webhook channels configured yet.</p>
      {{/if}}
    </section>
  </template>
}
