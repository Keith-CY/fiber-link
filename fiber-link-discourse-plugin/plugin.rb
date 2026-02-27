# name: fiber-link
# version: 0.1
# authors: Fiber Link

enabled_site_setting :fiber_link_enabled

after_initialize do
  require_dependency File.expand_path("app/controllers/fiber_link/rpc_controller.rb", __dir__)
  route_enabled = ->(_request) { SiteSetting.fiber_link_enabled }

  Discourse::Application.routes.prepend do
    get "/fiber-link" => "list#latest", constraints: route_enabled
    post "/fiber-link/rpc" => "fiber_link/rpc#proxy", constraints: route_enabled
  end
end
