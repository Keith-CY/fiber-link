# frozen_string_literal: true

require "timeout"

RSpec.describe "Fiber Link Dashboard", type: :system do
  fab!(:user)

  before do
    SiteSetting.fiber_link_enabled = true
    SiteSetting.fiber_link_service_url = "https://fiber-link.example"
    SiteSetting.fiber_link_app_id = "app1"
    SiteSetting.fiber_link_app_secret = "secret"

    sign_in(user)
  end

  it "bootstraps runtime without manual client initialization" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-init",
          result: {
            balance: "0",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    runtime = page.evaluate_script("window.__fiberLinkRuntime")
    expect(runtime).to include("initialized" => true, "rpcPath" => "/fiber-link/rpc")
    expect(page).to have_content("Fiber Link Dashboard")
  end

  it "shows author metrics and recent tips from dashboard.summary" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-1",
          result: {
            balance: "12.5",
            tips: [
              {
                id: "tip-live-1",
                invoice: "inv-live-1",
                postId: "p1",
                amount: "31",
                asset: "CKB",
                state: "SETTLED",
                direction: "IN",
                counterpartyUserId: "fiber_tipper",
                createdAt: "2026-02-16T00:00:00.000Z",
              },
              {
                id: "tip-live-2",
                invoice: "inv-live-2",
                postId: "p2",
                amount: "15",
                asset: "CKB",
                state: "UNPAID",
                direction: "IN",
                counterpartyUserId: "tipper_two",
                createdAt: "2026-02-16T01:00:00.000Z",
              },
            ],
            generatedAt: "2026-02-16T01:00:00.000Z",
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("Available Balance")
    expect(page).to have_content("12.5 CKB")
    expect(page).to have_content("Awaiting Payment")
    expect(page).to have_content("Paid")
    expect(page).to have_content("Recent Tips")
    expect(page).to have_content("fiber_tipper")
    expect(page).to have_content("Awaiting payment")
    expect(page).to have_content("Paid")
  end

  it "keeps visible data stable while background polling refreshes" do
    request_count = 0
    request_count_mutex = Mutex.new

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return do
        current_request = request_count_mutex.synchronize do
          request_count += 1
        end

        if current_request == 1
          {
            status: 200,
            body: {
              jsonrpc: "2.0",
              id: "dash-refresh-1",
              result: {
                balance: "12.5",
                tips: [
                  {
                    id: "tip-refresh-1",
                    invoice: "inv-refresh-1",
                    postId: "p1",
                    amount: "31",
                    asset: "CKB",
                    state: "UNPAID",
                    direction: "IN",
                    counterpartyUserId: "fiber_tipper",
                    createdAt: "2026-02-16T00:00:00.000Z",
                  },
                ],
                generatedAt: "2026-02-16T00:00:00.000Z",
              },
            }.to_json,
            headers: { "Content-Type" => "application/json" },
          }
        else
          sleep 3
          {
            status: 200,
            body: {
              jsonrpc: "2.0",
              id: "dash-refresh-2",
              result: {
                balance: "99",
                tips: [
                  {
                    id: "tip-refresh-1",
                    invoice: "inv-refresh-1",
                    postId: "p1",
                    amount: "31",
                    asset: "CKB",
                    state: "SETTLED",
                    direction: "IN",
                    counterpartyUserId: "fiber_tipper",
                    createdAt: "2026-02-16T00:00:00.000Z",
                  },
                ],
                generatedAt: "2026-02-16T00:00:05.000Z",
              },
            }.to_json,
            headers: { "Content-Type" => "application/json" },
          }
        end
      end

    visit "/fiber-link"

    expect(page).to have_content("12.5 CKB")
    expect(page).to have_content("Awaiting payment")

    Timeout.timeout(8) do
      loop do
        break if request_count_mutex.synchronize { request_count >= 2 }
        sleep 0.05
      end
    end

    expect(page).to have_no_content("Loading…", wait: 0)
    expect(page).to have_content("99 CKB")
    expect(page).to have_content("Paid")
  end

  it "shows a friendly empty state with no admin section" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-2",
          result: {
            balance: "0",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
            admin: {
              apps: [{ appId: "app1" }],
              withdrawals: [{ id: "w1" }],
            },
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("You don’t have tip records yet.")
    expect(page).to have_no_content("Admin Inspection (Operational)")
    expect(page).to have_no_content("Lifecycle Pipeline Board")
    expect(page).to have_no_content("Uses the service endpoint path")
  end

  it "lets the author request a withdrawal from the dashboard" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-3",
          result: {
            balance: "124",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "withdrawal.request" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "withdraw-1",
          result: { id: "wd-1", state: "PENDING" },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("Withdraw Balance")
    fill_in "Amount (CKB)", with: "61"
    fill_in "Destination Address", with: "ckt1qyqg5xa84dfwfy76tptw2sy0k9q98xaeka9q5tvdlm"
    click_button "Request Withdrawal"

    expect(page).to have_content("Requested withdrawal wd-1")
    expect(page).to have_content("PENDING")

    expect(WebMock).to have_requested(:post, "https://fiber-link.example/rpc").with { |request|
      body = JSON.parse(request.body)
      body.fetch("method") == "withdrawal.request" &&
        body.dig("params", "userId") == user.id.to_s &&
        body.dig("params", "amount") == "61"
    }
  end

  it "shows distinct liquidity pending feedback when liquidity is not yet available" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-4",
          result: {
            balance: "124",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "withdrawal.request" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "withdraw-2",
          result: { id: "wd-liquidity", state: "LIQUIDITY_PENDING" },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    fill_in "Amount (CKB)", with: "61"
    fill_in "Destination Address", with: "ckt1qyqg5xa84dfwfy76tptw2sy0k9q98xaeka9q5tvdlm"
    click_button "Request Withdrawal"

    expect(page).to have_content("Withdrawal queued until liquidity is available.")
    expect(page).to have_content("Liquidity Pending")
    expect(page).to have_content("Requested withdrawal wd-liquidity")
  end
end
