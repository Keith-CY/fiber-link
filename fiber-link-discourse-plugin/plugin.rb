# name: fiber-link
# version: 0.1
# authors: Fiber Link

require_relative "lib/fiber_link/engine"

enabled_site_setting :fiber_link_enabled
register_asset "stylesheets/common/fiber-link.scss"

FIBER_LINK_TOPIC_BOOT_FALLBACK_BODY = <<~JS
  (function() {
    if ((window.location.pathname || "").indexOf("/t/") !== 0) {
      return;
    }

    function prependFallback() {
      if (document.querySelector('[data-fiber-link-tip-button="post-menu"].fiber-link-client-ready-button')) {
        return true;
      }

      if (document.querySelector('[data-fiber-link-topic-state="boot-timeout"]')) {
        return true;
      }

      if (!document.body) {
        return false;
      }

      var fallback = document.createElement("aside");
      fallback.className = "fiber-link-topic-boot-timeout";
      fallback.setAttribute("data-fiber-link-topic-state", "boot-timeout");
      fallback.innerHTML = '<p class="fiber-link-topic-boot-timeout__message">Fiber Link tip actions are still loading. Reload the topic or retry when traffic settles.</p><button class="btn btn-primary" type="button" data-fiber-link-topic-retry>Reload topic</button>';
      fallback.querySelector("[data-fiber-link-topic-retry]")?.addEventListener("click", function() {
        window.location.reload();
      });

      (document.querySelector("#main-outlet, main, body") || document.body)?.prepend(fallback);
      return true;
    }

    window.setTimeout(function() {
      if (prependFallback()) {
        return;
      }

      var attempts = 0;
      var interval = window.setInterval(function() {
        attempts += 1;
        if (prependFallback() || attempts >= 20) {
          window.clearInterval(interval);
        }
      }, 250);
    }, 15000);
  })();
JS

FIBER_LINK_DASHBOARD_BOOT_FALLBACK_BODY = <<~JS
  (function() {
    if ((window.location.pathname || "") !== "/fiber-link") {
      return;
    }

    function dashboardHasRendered() {
      return Boolean(
        document.querySelector('.fiber-link-dashboard, [data-fiber-link-dashboard-state="error"], [data-fiber-link-withdrawal-input="amount"]')
      );
    }

    function appendFallback() {
      if (dashboardHasRendered()) {
        return true;
      }

      if (document.querySelector('[data-fiber-link-dashboard-state="boot-timeout"]')) {
        return true;
      }

      if (!document.body) {
        return false;
      }

      var fallback = document.createElement("main");
      fallback.className = "fiber-link-dashboard fiber-link-dashboard__boot-timeout";
      fallback.setAttribute("data-fiber-link-dashboard-state", "boot-timeout");
      fallback.innerHTML = '<section class="fiber-link-dashboard__boot-timeout-card"><p class="fiber-link-dashboard__alert is-error">Fiber Link dashboard is still loading. The service may be busy; retry when traffic settles.</p><button class="btn btn-primary" type="button" data-fiber-link-dashboard-retry>Retry dashboard</button></section>';
      fallback.querySelector("[data-fiber-link-dashboard-retry]")?.addEventListener("click", function() {
        window.location.reload();
      });

      (document.querySelector("#main-outlet, main, body") || document.body)?.appendChild(fallback);
      return true;
    }

    window.setTimeout(function() {
      if (appendFallback()) {
        return;
      }

      var attempts = 0;
      var interval = window.setInterval(function() {
        attempts += 1;
        if (appendFallback() || attempts >= 20) {
          window.clearInterval(interval);
        }
      }, 250);
    }, 15000);
  })();
JS

after_initialize do
  register_html_builder("server:before-head-close") do |controller|
    nonce = ContentSecurityPolicy.nonce_placeholder(controller.response.headers)
    <<~HTML
      <script nonce="#{nonce}" data-fiber-link-topic-head-boot-fallback>
        #{FIBER_LINK_TOPIC_BOOT_FALLBACK_BODY}
      </script>
      <script nonce="#{nonce}" data-fiber-link-dashboard-head-boot-fallback>
        #{FIBER_LINK_DASHBOARD_BOOT_FALLBACK_BODY}
      </script>
    HTML
  end

  register_html_builder("server:before-body-close") do |controller|
    nonce = ContentSecurityPolicy.nonce_placeholder(controller.response.headers)
    <<~HTML
      <script nonce="#{nonce}" data-fiber-link-topic-boot-fallback>
        #{FIBER_LINK_TOPIC_BOOT_FALLBACK_BODY}
      </script>
      <script nonce="#{nonce}" data-fiber-link-dashboard-boot-fallback>
        #{FIBER_LINK_DASHBOARD_BOOT_FALLBACK_BODY}
      </script>
    HTML
  end

  require_dependency File.expand_path("lib/fiber_link/service_client.rb", __dir__)
  require_dependency File.expand_path("lib/fiber_link/tip_notification_sync.rb", __dir__)
  require_dependency File.expand_path("app/controllers/fiber_link/rpc_controller.rb", __dir__)
  require_dependency File.expand_path("app/jobs/scheduled/fiber_link_tip_notification_sync.rb", __dir__)

  route_enabled = ->(_request) { SiteSetting.fiber_link_enabled }

  Discourse::Application.routes.prepend do
    get "/fiber-link" => "list#latest", constraints: route_enabled
    post "/fiber-link/rpc" => "fiber_link/rpc#proxy", constraints: route_enabled
  end
end
