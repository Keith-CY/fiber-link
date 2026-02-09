# frozen_string_literal: true

module ::FiberLink
  class Engine < ::Rails::Engine
    engine_name "fiber_link"
    isolate_namespace FiberLink
  end
end

