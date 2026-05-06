require "rails_helper"

# frozen_string_literal: true

RSpec.describe "Fiber Link Tip", type: :system do
  fab!(:user)
  fab!(:author) { Fabricate(:user) }
  fab!(:topic) { Fabricate(:topic_with_op, user: author) }
  fab!(:reply) do
    Fabricate(
      :post,
      topic: topic,
      user: author,
      raw: "Reply tip context should appear in the payment dialog.",
    )
  end

  before do
    SiteSetting.fiber_link_enabled = true
    SiteSetting.fiber_link_service_url = "https://fiber-link.example"
    SiteSetting.fiber_link_app_id = "app1"
    SiteSetting.fiber_link_app_secret = "secret"

    sign_in(user)
  end

  it "shows a compact two-step payment flow that advances from amount to pay to confirmed" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "tip.create" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "1",
          result: { invoice: "inv-tip-1", invoiceQrDataUrl: "data:image/png;base64,ZmliZXItbGluaw==" },
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
          body: { jsonrpc: "2.0", id: "3", result: { state: "UNPAID" } }.to_json,
          headers: { "Content-Type" => "application/json" },
        },
        {
          status: 200,
          body: { jsonrpc: "2.0", id: "4", result: { state: "UNPAID" } }.to_json,
          headers: { "Content-Type" => "application/json" },
        },
        {
          status: 200,
          body: { jsonrpc: "2.0", id: "5", result: { state: "UNPAID" } }.to_json,
          headers: { "Content-Type" => "application/json" },
        },
        {
          status: 200,
          body: { jsonrpc: "2.0", id: "6", result: { state: "SETTLED" } }.to_json,
          headers: { "Content-Type" => "application/json" },
        },
      )

    visit topic.relative_url
    expect(page).to have_css(".post-action-menu__fiber-link-tip[data-fiber-link-tip-button='post-menu']")
    expect(page).to have_no_css(".topic-above-post-stream-outlet [data-fiber-link-tip-button]")
    click_button "Tip", match: :first

    expect(page).to have_content("SEND A TIP")
    expect(page).to have_content("1 CKB")
    expect(page).to have_content("Tipping")
    expect(page).to have_content("@#{topic.first_post.user.username}")
    within("[data-fiber-link-tip-modal='recipient']") do
      expect(page).to have_css("img[data-fiber-link-tip-modal='recipient-avatar']")
      expect(page).to have_content("@#{topic.first_post.user.username}")
      expect(page).to have_content("RECIPIENT · VERIFIED 2D AGO")
      expect(page).to have_content("Receives")
      expect(page).to have_content("1CKB")
    end
    expect(page).to have_css("img[data-fiber-link-tip-modal='brand-logo']")
    expect(page).to have_link("Fiber Link", href: "https://www.fiberlink.me")
    expect(page).to have_css(
      "a[data-fiber-link-tip-modal='brand-link'][href='https://www.fiberlink.me'][target='_blank']",
    )
    expect(page).to have_css("[data-fiber-link-tip-modal='summary']")
    within("[data-fiber-link-tip-modal='summary']") do
      expect(page).to have_content("TOPIC")
      expect(page).to have_content(topic.title)
      expect(page).to have_content("NETWORK")
      expect(page).to have_content("Fiber Link · Mainnet")
    end
    expect(page).to have_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='confirmed']")
    expect(page).to have_content("STEP 01")
    expect(page).to have_content("OF 02 · AMOUNT")
    expect(page).to have_css("[data-fiber-link-tip-modal='stepper'] span", count: 2)
    expect(page).to have_css("[data-fiber-link-tip-modal='stepper'] span.is-active", count: 1)
    expect(page).to have_no_content("Amount & message")
    expect(page).to have_no_content("Choose an amount and optionally add a short note.")
    expect(page).to have_content("AMOUNT")
    expect(page).to have_no_content("Amount (CKB)")
    expect(page).to have_css("textarea[placeholder='Leave a short note']")
    expect(page).to have_no_content("Add reaction")
    expect(page).to have_no_content("Markdown supported")
    expect(page).to have_button("1 CKB")
    expect(page).to have_button("5 CKB")
    expect(page).to have_button("10 CKB")

    fill_in "Amount", with: "31"
    expect(page).to have_css(".fiber-link-tip-chip.is-selected", text: "Custom")
    expect(page).to have_css("button[aria-pressed='true']", text: "Custom")
    expect(page).to have_css("button[aria-pressed='false']", text: "1 CKB")
    find("textarea[placeholder='Leave a short note']").set("Great post")
    click_button "Review & Pay"

    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='confirmed']")
    expect(page).to have_content("STEP 02")
    expect(page).to have_content("OF 02 · PAY WITH WALLET")
    expect(page).to have_css("[data-fiber-link-tip-modal='stepper'] span", count: 2)
    expect(page).to have_css("[data-fiber-link-tip-modal='stepper'] span.is-active", count: 2)
    expect(page).to have_content("31 CKB")
    expect(page).to have_content("Awaiting payment")
    expect(page).to have_no_content("Status updates automatically")
    expect(page).to have_css("img[data-fiber-link-tip-modal=invoice-qr]")
    expect(page).to have_css("[data-fiber-link-tip-modal='status-spinner']")
    expect(page).to have_no_css(".fiber-link-tip-progress-dots")
    expect(page).to have_css("[data-fiber-link-tip-modal='copy-invoice'][title='Copy invoice']")
    expect(page).to have_css("[data-fiber-link-tip-modal='copy-invoice'] .d-icon-copy")
    expect(page).to have_no_button("Copy ↗")
    expect(page).to have_button("Open Fiber Wallet →", disabled: true)
    expect(page).to have_no_link("Open Fiber Wallet")
    expect(page).to have_content("INVOICE")
    expect(page).to have_content("inv-tip-1")
    expect(page).to have_no_content("Expires in")
    expect(page).to have_no_button("More options")
    expect(page).to have_no_content("Payment details")
    expect(page).to have_no_button("Check status", disabled: :all)

    expect(WebMock).to have_requested(:post, "https://fiber-link.example/rpc").with { |request|
      body = JSON.parse(request.body)
      body.fetch("method") == "tip.create" &&
        body.dig("params", "postId") == topic.first_post.id.to_s &&
        body.dig("params", "fromUserId") == user.id.to_s &&
        body.dig("params", "toUserId") == topic.first_post.user_id.to_s &&
        body.dig("params", "message") == "Great post"
    }

    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='confirmed']", wait: 8)
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_content("Payment complete")
    expect(page).to have_button("Done")
  end

  it "keeps pending payments focused on passive status polling" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "tip.create" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "1",
          result: { invoice: "inv-tip-2", invoiceQrDataUrl: "data:image/png;base64,ZmliZXItbGluaw==" },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "tip.status" }
      .to_return(
        status: 200,
        body: { jsonrpc: "2.0", id: "2", result: { state: "UNPAID" } }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit topic.relative_url
    expect(page).to have_css(".post-action-menu__fiber-link-tip[data-fiber-link-tip-button='post-menu']")
    expect(page).to have_no_css(".topic-above-post-stream-outlet [data-fiber-link-tip-button]")
    click_button "Tip", match: :first
    expect(page).to have_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='pay']")
    click_button "Review & Pay"
    expect(page).to have_no_css("[data-fiber-link-tip-modal-step='generate']")
    expect(page).to have_css("[data-fiber-link-tip-modal-step='pay']")

    expect(page).to have_css("[data-fiber-link-tip-modal-step='pay']")
    expect(page).to have_content("Awaiting payment")
    expect(page).to have_css("[data-fiber-link-tip-modal='status-spinner']")
    expect(page).to have_no_button("More options")
    expect(page).to have_no_content("Payment details")
    expect(page).to have_no_button("Check status", disabled: :all)
    expect(page).to have_button("Open Fiber Wallet", disabled: true)
    expect(page).to have_no_link("Open Fiber Wallet")
    expect(page).to have_no_content("Expires in")
    expect(page).to have_css("[data-fiber-link-tip-modal='invoice-value'][data-fiber-link-invoice='inv-tip-2']")

    page.execute_script(<<~JS)
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      });
    JS

    find("[data-fiber-link-tip-modal='copy-invoice']").click
    expect(page).to have_css("[data-fiber-link-tip-modal='copy-invoice'][title='Copied']")
    expect(page).to have_css("[data-fiber-link-tip-modal='copy-invoice'] .d-icon-check")
    expect(page).to have_no_content("Copied invoice")
    expect(page).to have_css("[data-fiber-link-tip-modal='copy-invoice'][title='Copy invoice']", wait: 4)
    expect(page).to have_css("[data-fiber-link-tip-modal='copy-invoice'] .d-icon-copy")
  end

  it "labels the context as a reply when opened from a reply tip button" do
    visit topic.relative_url
    expect(page).to have_css(
      ".post-action-menu__fiber-link-tip[data-fiber-link-tip-button='post-menu']",
      minimum: 2,
    )

    all(".post-action-menu__fiber-link-tip[data-fiber-link-tip-button='post-menu']").last.click

    within("[data-fiber-link-tip-modal='summary']") do
      expect(page).to have_content("REPLY CONTEXT")
      expect(page).to have_content("Reply tip context should appear in the payment dialog.")
      expect(page).to have_content("NETWORK")
      expect(page).to have_content("Fiber Link · Mainnet")
      expect(page).to have_no_content("TOPIC")
    end
  end
end
