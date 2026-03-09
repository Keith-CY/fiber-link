require "rails_helper"

# frozen_string_literal: true

RSpec.describe "Fiber Link Tip", type: :system do
  fab!(:user)
  fab!(:author) { Fabricate(:user) }
  fab!(:topic) { Fabricate(:topic_with_op, user: author) }

  before do
    SiteSetting.fiber_link_enabled = true
    SiteSetting.fiber_link_service_url = "https://fiber-link.example"
    SiteSetting.fiber_link_app_id = "app1"
    SiteSetting.fiber_link_app_secret = "secret"

    sign_in(user)
  end

  it "shows a single-step payment flow that advances from generate to pay to confirmed" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "tip.create" }
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
      .with { |request| JSON.parse(request.body).fetch("method") == "tip.status" }
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

    visit topic.relative_url
    expect(page).to have_css("[data-fiber-link-tip-button]")
    click_button "Tip", match: :first

    expect(page).to have_content("Pay with Fiber")
    expect(page).to have_content("@#{topic.first_post.user.username}")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='confirmed']")

    fill_in "Amount", with: "31"
    fill_in "Tip message (optional)", with: "Great post"
    click_button "Generate Invoice"

    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='confirmed']")
    expect(page).to have_content("31 CKB")
    expect(page).to have_content("Scan with Fiber Wallet")
    expect(page).to have_content("Status updates automatically")
    expect(page).to have_css("img[data-fiber-link-tip-modal=invoice-qr]")
    expect(page).to have_button("Copy Invoice")
    expect(page).to have_link("Open Fiber Wallet", href: "fiber://invoice/inv-tip-1")
    expect(page).to have_no_text("inv-tip-1")

    click_button "Advanced"
    expect(page).to have_text("inv-tip-1")
    expect(page).to have_button("Check status")

    expect(WebMock).to have_requested(:post, "https://fiber-link.example/rpc").with { |request|
      body = JSON.parse(request.body)
      body.fetch("method") == "tip.create" &&
        body.dig("params", "postId") == topic.first_post.id.to_s &&
        body.dig("params", "fromUserId") == user.id.to_s &&
        body.dig("params", "toUserId") == topic.first_post.user_id.to_s &&
        body.dig("params", "message") == "Great post"
    }

    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='confirmed']")
    expect(page).to have_content("Payment received")
  end

  it "keeps manual status checks available inside advanced details" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "tip.create" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "1",
          result: { invoice: "inv-tip-2" },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "tip.status" }
      .to_return(
        status: 200,
        body: { jsonrpc: "2.0", id: "2", result: { state: "SETTLED" } }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit topic.relative_url
    expect(page).to have_css("[data-fiber-link-tip-button]")
    click_button "Tip", match: :first
    expect(page).to have_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='pay']")
    click_button "Generate Invoice"
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='pay']")
    click_button "Advanced"
    click_button "Check status"

    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='confirmed']")
    expect(page).to have_content("Payment received")
  end
end
