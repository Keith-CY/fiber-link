from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TIP_MODAL = ROOT / "fiber-link-discourse-plugin/assets/javascripts/discourse/components/modal/fiber-link-tip-modal.gjs"
DASHBOARD = ROOT / "fiber-link-discourse-plugin/assets/javascripts/discourse/routes/fiber-link-dashboard.js"


def test_tip_modal_has_bounded_exponential_backoff_polling():
    source = TIP_MODAL.read_text()

    assert "TIP_STATUS_AUTO_POLL_MAX_FAILURES" in source
    assert "TIP_STATUS_AUTO_POLL_MAX_ELAPSED_MS" in source
    assert "TIP_STATUS_AUTO_POLL_MAX_BACKOFF_MS" in source
    assert "TIP_STATUS_HIDDEN_POLL_INTERVAL_MS" in source
    assert "_getStatusPollDelay" in source
    assert "Math.pow(2" in source
    assert "document?.hidden" in source
    assert "Status polling paused after repeated failures" in source


def test_dashboard_has_bounded_exponential_backoff_refresh():
    source = DASHBOARD.read_text()

    assert "DASHBOARD_POLL_MAX_FAILURES" in source
    assert "DASHBOARD_POLL_MAX_FAILURE_WINDOW_MS" in source
    assert "DASHBOARD_POLL_MAX_BACKOFF_MS" in source
    assert "DASHBOARD_HIDDEN_POLL_INTERVAL_MS" in source
    assert "_getDashboardPollDelay" in source
    assert "Math.pow(2" in source
    assert "document?.hidden" in source
    assert "Auto-refresh paused after repeated failures" in source
