require "rails_helper"

RSpec.describe ::FiberLink::TipNotificationSync do
  fab!(:recipient) { Fabricate(:user) }
  fab!(:sender) { Fabricate(:user, username: "fiber_tipper") }
  fab!(:post) { Fabricate(:post, user: recipient) }

  before do
    SiteSetting.fiber_link_enabled = true
    PluginStoreRow.where(plugin_name: described_class::STORE_NAMESPACE).delete_all
  end

  it "creates a custom notification for each newly settled incoming tip and advances the cursor" do
    client = instance_double(::FiberLink::ServiceClient)
    allow(client).to receive(:call).and_return(
      {
        "result" => {
          "items" => [
            {
              "tipIntentId" => "tip-1",
              "postId" => post.id.to_s,
              "fromUserId" => sender.id.to_s,
              "toUserId" => recipient.id.to_s,
              "amount" => "31",
              "asset" => "CKB",
              "message" => "Great post",
              "settledAt" => "2026-03-08T04:30:57.081Z",
            },
          ],
          "nextCursor" => {
            "settledAt" => "2026-03-08T04:30:57.081Z",
            "id" => "tip-1",
          },
        },
      },
      { "result" => { "items" => [], "nextCursor" => nil } },
    )

    expect { described_class.sync(client: client, limit: 10) }.to change { Notification.count }.by(1)

    notification = Notification.last
    data = JSON.parse(notification.data)

    expect(notification.notification_type).to eq(Notification.types[:custom])
    expect(notification.user_id).to eq(recipient.id)
    expect(notification.topic_id).to eq(post.topic_id)
    expect(notification.post_number).to eq(post.post_number)
    expect(data).to include(
      "message" => "fiber_link.tip_received_notification",
      "title" => "fiber_link.notification.title",
      "display_username" => sender.username,
      "amount" => "31",
      "asset" => "CKB",
      "excerpt" => "Great post",
    )
    expect(PluginStore.get(described_class::STORE_NAMESPACE, described_class::CURSOR_KEY)).to eq(
      "settledAt" => "2026-03-08T04:30:57.081Z",
      "id" => "tip-1",
    )
    expect(
      PluginStore.get(described_class::STORE_NAMESPACE, "#{described_class::SEEN_KEY_PREFIX}:tip-1"),
    ).to eq(true)
  end

  it "deduplicates already-seen tips" do
    client = instance_double(::FiberLink::ServiceClient)
    allow(client).to receive(:call).and_return(
      {
        "result" => {
          "items" => [
            {
              "tipIntentId" => "tip-1",
              "postId" => post.id.to_s,
              "fromUserId" => sender.id.to_s,
              "toUserId" => recipient.id.to_s,
              "amount" => "31",
              "asset" => "CKB",
              "message" => nil,
              "settledAt" => "2026-03-08T04:30:57.081Z",
            },
          ],
          "nextCursor" => {
            "settledAt" => "2026-03-08T04:30:57.081Z",
            "id" => "tip-1",
          },
        },
      },
      { "result" => { "items" => [], "nextCursor" => nil } },
    )

    described_class.sync(client: client, limit: 10)

    expect { described_class.sync(client: client, limit: 10) }.not_to change { Notification.count }
  end
end
