# name: fiber-link
# version: 0.1
# authors: Fiber Link

require_relative "lib/fiber_link/engine"

enabled_site_setting :fiber_link_enabled
register_asset "stylesheets/common/fiber-link.scss"

after_initialize do
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
