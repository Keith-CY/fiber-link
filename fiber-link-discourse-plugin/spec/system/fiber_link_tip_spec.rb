# frozen_string_literal: true

RSpec.describe "Fiber Link Tip", type: :system do
  fab!(:user)
  fab!(:topic, :topic_with_op)

  it "shows invoice, pending, and settled states" do
    SiteSetting.fiber_link_enabled = true
    SiteSetting.fiber_link_service_url = "https://fiber-link.example"
    SiteSetting.fiber_link_app_id = "app1"
    SiteSetting.fiber_link_app_secret = "secret"

    sign_in(user)

    stub_request(:post, "https://fiber-link.example/rpc")
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "1",
          result: { invoice: "inv-tip-1" },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    stub_request(:post, "https://fiber-link.example/rpc")
      .with do |request|
        JSON.parse(request.body).fetch("method") == "tip.status"
      end
      .to_return(
        {
          status: 200,
          body: { jsonrpc: "2.0", id: "2", result: { state: "UNPAID" } }.to_json,
          headers: { "Content-Type" => "application/json" },
        },
        {
          status: 200,
          body: { jsonrpc: "2.0", id: "3", result: { state: "SETTLED" } }.to_json,
          headers: { "Content-Type" => "application/json" },
        },
      )

    visit "/t/#{topic.id}"
    click_button "Tip", match: :first
    expect(page).to have_content("Pay with Fiber")
    click_button "Generate Invoice"
    expect(page).to have_content("inv-tip-1")
    expect(page).to have_content("Awaiting payment")

    expect(WebMock).to have_requested(:post, "https://fiber-link.example/rpc").with { |request|
      body = JSON.parse(request.body)
      body.fetch("method") == "tip.create" &&
        body.dig("params", "postId") == topic.first_post.id.to_s &&
        body.dig("params", "fromUserId") == user.id.to_s &&
        body.dig("params", "toUserId") == topic.first_post.user_id.to_s
    }

    click_button "Check status"
    expect(page).to have_content("Awaiting payment")

    click_button "Check status"
    expect(page).to have_content("Paid")
  end

  it "shows friendly self-tip error without calling backend" do
    SiteSetting.fiber_link_enabled = true
    SiteSetting.fiber_link_service_url = "https://fiber-link.example"
    SiteSetting.fiber_link_app_id = "app1"
    SiteSetting.fiber_link_app_secret = "secret"

    self_topic = Fabricate(:topic, user: user)
    sign_in(user)

    visit "/t/#{self_topic.id}"
    click_button "Tip", match: :first
    expect(page).to have_content("Pay with Fiber")
    expect(page).to have_content("You can’t tip your own post.")
    click_button "Generate Invoice"
    expect(page).to have_content("You can’t tip your own post.")

    expect(WebMock).not_to have_requested(:post, "https://fiber-link.example/rpc")
  end
end
