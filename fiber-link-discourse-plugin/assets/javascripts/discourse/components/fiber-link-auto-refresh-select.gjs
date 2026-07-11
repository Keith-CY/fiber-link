import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";

const POLL_INTERVAL_OPTIONS = [10000, 30000, 60000];

export default class FiberLinkAutoRefreshSelect extends Component {
  get selectedValue() {
    return Number(this.args.model?.pollIntervalMs || 10000);
  }

  get isTenSeconds() {
    return this.selectedValue === 10000;
  }

  get isThirtySeconds() {
    return this.selectedValue === 30000;
  }

  get isSixtySeconds() {
    return this.selectedValue === 60000;
  }

  @action
  updatePollInterval(event) {
    const nextValue = Number(event?.target?.value);
    if (!POLL_INTERVAL_OPTIONS.includes(nextValue)) {
      return;
    }

    this.args.model?.set("pollIntervalMs", nextValue);
  }

  <template>
    <label class="fiber-link-dashboard__refresh-select">
      <span>Auto-refresh</span>
      <select
        aria-label="Auto-refresh interval"
        name="fiber-link-auto-refresh-interval"
        {{on "change" this.updatePollInterval}}
      >
        <option value="10000" selected={{this.isTenSeconds}}>10s</option>
        <option value="30000" selected={{this.isThirtySeconds}}>30s</option>
        <option value="60000" selected={{this.isSixtySeconds}}>60s</option>
      </select>
    </label>
  </template>
}
