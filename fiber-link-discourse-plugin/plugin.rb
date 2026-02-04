# name: fiber-link
# version: 0.1
# authors: Fiber Link

enabled_site_setting :fiber_link_enabled

register_asset "javascripts/discourse/initializers/fiber-link.js"

after_initialize do
  module ::FiberLink
    class Engine < ::Rails::Engine
      engine_name "fiber_link"
      isolate_namespace FiberLink
    end
  end

  FiberLink::Engine.routes.draw do
    post "/rpc" => "rpc#proxy"
  end

  Discourse::Application.routes.append do
    mount ::FiberLink::Engine, at: "/fiber-link"
  end
end
