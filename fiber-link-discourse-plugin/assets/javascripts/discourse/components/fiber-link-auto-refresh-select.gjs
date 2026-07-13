import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { i18n } from "discourse-i18n";

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
      <span>{{i18n "fiber_link.auto_refresh.label"}}</span>
      <select
        aria-label={{i18n "fiber_link.auto_refresh.aria_label"}}
        {{on "change" this.updatePollInterval}}
      >
        <option value="10000" selected={{this.isTenSeconds}}>{{i18n "fiber_link.auto_refresh.option_seconds" seconds="10"}}</option>
        <option value="30000" selected={{this.isThirtySeconds}}>{{i18n "fiber_link.auto_refresh.option_seconds" seconds="30"}}</option>
        <option value="60000" selected={{this.isSixtySeconds}}>{{i18n "fiber_link.auto_refresh.option_seconds" seconds="60"}}</option>
      </select>
    </label>
  </template>
}
