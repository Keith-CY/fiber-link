# name: fiber-link
# version: 0.1
# authors: Fiber Link

after_initialize do
  require_dependency File.expand_path("app/controllers/fiber_link/rpc_controller.rb", __dir__)

  Discourse::Application.routes.prepend do
    get "/fiber-link" => "list#latest"
    post "/fiber-link/rpc" => "fiber_link/rpc#proxy"
  end
end
