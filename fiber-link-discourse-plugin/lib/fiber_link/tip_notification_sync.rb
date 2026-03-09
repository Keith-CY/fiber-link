# frozen_string_literal: true

module ::FiberLink
  class TipNotificationSync
    STORE_NAMESPACE = "fiber-link"
    CURSOR_KEY = "tip_notifications:cursor"
    SEEN_KEY_PREFIX = "tip_notifications:seen".freeze

    class << self
      def sync(client: ServiceClient.new, limit: 50)
        return 0 unless SiteSetting.fiber_link_enabled

        created = 0
        cursor = load_cursor

        loop do
          payload = client.call(
            method: "tip.settled_feed",
            params: {
              limit: limit,
              after: cursor,
            }.compact,
          )
          result = payload.fetch("result", {})
          items = Array(result["items"])
          break if items.empty?

          items.each do |item|
            created += 1 if create_notification(item)
            cursor = build_cursor(item)
            persist_cursor(cursor)
          end

          next_cursor = result["nextCursor"]
          break if next_cursor.blank? || items.length < limit
        end

        created
      end

      private

      def create_notification(item)
        tip_intent_id = item["tipIntentId"].to_s
        return false if tip_intent_id.blank? || seen?(tip_intent_id)

        recipient = User.find_by(id: item["toUserId"])
        mark_seen(tip_intent_id) and return false if recipient.blank?

        post = Post.find_by(id: item["postId"])
        sender = User.find_by(id: item["fromUserId"])

        Notification.create!(
          notification_type: Notification.types[:custom],
          user_id: recipient.id,
          topic_id: post&.topic_id,
          post_number: post&.post_number,
          data: {
            message: "fiber_link.tip_received_notification",
            title: "fiber_link.notification.title",
            display_username: sender&.username || "someone",
            amount: item["amount"].to_s,
            asset: item["asset"].to_s.presence || "CKB",
            excerpt: item["message"].to_s.presence,
            topic_title: post&.topic&.title,
          }.compact.to_json,
        )

        mark_seen(tip_intent_id)
        true
      rescue ActiveRecord::RecordInvalid => error
        Rails.logger.error(
          "Failed to create tip notification for tip #{tip_intent_id}: #{error.class} #{error.message}"
        )
        mark_seen(tip_intent_id)
        false
      end

      def seen?(tip_intent_id)
        PluginStore.get(STORE_NAMESPACE, seen_key(tip_intent_id)).present?
      end

      def mark_seen(tip_intent_id)
        PluginStore.set(STORE_NAMESPACE, seen_key(tip_intent_id), true)
      end

      def seen_key(tip_intent_id)
        "#{SEEN_KEY_PREFIX}:#{tip_intent_id}"
      end

      def load_cursor
        value = PluginStore.get(STORE_NAMESPACE, CURSOR_KEY)
        return nil unless value.is_a?(Hash)
        return nil if value["settledAt"].blank? || value["id"].blank?

        {
          settledAt: value["settledAt"],
          id: value["id"],
        }
      end

      def persist_cursor(cursor)
        return if cursor.blank?

        PluginStore.set(STORE_NAMESPACE, CURSOR_KEY, cursor.stringify_keys)
      end

      def build_cursor(item)
        settled_at = item["settledAt"].to_s
        id = item["tipIntentId"].to_s
        return nil if settled_at.blank? || id.blank?

        {
          settledAt: settled_at,
          id: id,
        }
      end
    end
  end
end
