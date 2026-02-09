# name: fiber-link
# version: 0.1
# authors: Fiber Link

enabled_site_setting :fiber_link_enabled

after_initialize do
  require_relative "lib/fiber_link/engine"
  require_dependency File.expand_path("app/controllers/fiber_link/rpc_controller.rb", __dir__)

  FiberLink::Engine.routes.draw do
    post "/rpc" => "rpc#proxy"
  end

  Discourse::Application.routes.append do
    mount ::FiberLink::Engine, at: "/fiber-link"
  end
end
