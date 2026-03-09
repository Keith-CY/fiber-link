# frozen_string_literal: true

module Jobs
  class FiberLinkTipNotificationSync < ::Jobs::Scheduled
    every 1.minute

    def execute(_args = nil)
      ::FiberLink::TipNotificationSync.sync
    end
  end
end
