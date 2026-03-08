require "rails_helper"

# frozen_string_literal: true

require "timeout"

RSpec.describe "Fiber Link Dashboard", type: :system do
  fab!(:user)
  fab!(:tipper) { Fabricate(:user, username: "fiber_tipper") }

  before do
    SiteSetting.fiber_link_enabled = true
    SiteSetting.fiber_link_service_url = "https://fiber-link.example"
    SiteSetting.fiber_link_app_id = "app1"
    SiteSetting.fiber_link_app_secret = "secret"

    sign_in(user)
  end

  def summary_result(overrides = {})
    {
      balance: "0",
      balances: {
        available: "0",
        pending: "0",
        locked: "0",
        asset: "CKB",
      },
      stats: {
        pendingCount: 0,
        completedCount: 0,
        failedCount: 0,
      },
      tips: [],
      generatedAt: "2026-02-16T00:00:00.000Z",
    }.deep_merge(overrides)
  end

  it "bootstraps runtime without manual client initialization" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-init",
          result: summary_result,
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    runtime = page.evaluate_script("window.__fiberLinkRuntime")
    expect(runtime).to include("initialized" => true, "rpcPath" => "/fiber-link/rpc")
    expect(page).to have_content("Fiber Link Dashboard")
  end

  it "shows finance summary cards and payments activity" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-1",
          result: summary_result(
            balance: "12.5",
            balances: {
              available: "12.5",
              pending: "4",
              locked: "1",
              asset: "CKB",
            },
            stats: {
              pendingCount: 1,
              completedCount: 2,
              failedCount: 1,
            },
            tips: [
              {
                id: "tip-live-1",
                invoice: "inv-live-1",
                postId: "p1",
                amount: "31",
                asset: "CKB",
                state: "SETTLED",
                direction: "IN",
                counterpartyUserId: tipper.id.to_s,
                counterpartyUsername: tipper.username,
                message: "Great post",
                createdAt: "2026-02-16T00:00:00.000Z",
                settledAt: "2026-02-16T00:05:00.000Z",
              },
            ],
            generatedAt: "2026-02-16T01:00:00.000Z",
          ),
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("Balance")
    expect(page).to have_content("Pending")
    expect(page).to have_content("Completed")
    expect(page).to have_content("Failed")
    expect(page).to have_content("12.5 CKB")
    expect(page).to have_content("4 CKB")
    expect(page).to have_content("Payments")
    expect(page).to have_content("Auto-refresh every 10s")
    expect(page).to have_content("@fiber_tipper")
    expect(page).to have_content("Incoming")
    expect(page).to have_content("1 hour ago")
    expect(page).to have_content("Great post")
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
              result: summary_result(
                balance: "12.5",
                balances: {
                  available: "12.5",
                  pending: "31",
                  locked: "0",
                  asset: "CKB",
                },
                stats: {
                  pendingCount: 1,
                  completedCount: 0,
                  failedCount: 0,
                },
                tips: [
                  {
                    id: "tip-refresh-1",
                    invoice: "inv-refresh-1",
                    postId: "p1",
                    amount: "31",
                    asset: "CKB",
                    state: "UNPAID",
                    direction: "IN",
                    counterpartyUserId: tipper.id.to_s,
                    counterpartyUsername: tipper.username,
                    message: nil,
                    createdAt: "2026-02-16T00:00:00.000Z",
                    settledAt: nil,
                  },
                ],
                generatedAt: "2026-02-16T00:00:00.000Z",
              ),
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
              result: summary_result(
                balance: "99",
                balances: {
                  available: "99",
                  pending: "0",
                  locked: "0",
                  asset: "CKB",
                },
                stats: {
                  pendingCount: 0,
                  completedCount: 1,
                  failedCount: 0,
                },
                tips: [
                  {
                    id: "tip-refresh-1",
                    invoice: "inv-refresh-1",
                    postId: "p1",
                    amount: "31",
                    asset: "CKB",
                    state: "SETTLED",
                    direction: "IN",
                    counterpartyUserId: tipper.id.to_s,
                    counterpartyUsername: tipper.username,
                    message: nil,
                    createdAt: "2026-02-16T00:00:00.000Z",
                    settledAt: "2026-02-16T00:05:00.000Z",
                  },
                ],
                generatedAt: "2026-02-16T00:00:05.000Z",
              ),
            }.to_json,
            headers: { "Content-Type" => "application/json" },
          }
        end
      end

    visit "/fiber-link"

    expect(page).to have_content("12.5 CKB")
    expect(page).to have_content("Pending")

    Timeout.timeout(16) do
      loop do
        break if request_count_mutex.synchronize { request_count >= 2 }
        sleep 0.05
      end
    end

    expect(page).to have_no_content("Loading…", wait: 0)
    expect(page).to have_content("99 CKB")
    expect(page).to have_content("Payment received")
  end

  it "shows a friendly empty state with no admin section" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-2",
          result: summary_result(
            admin: {
              apps: [{ appId: "app1" }],
              withdrawals: [{ id: "w1" }],
            },
          ),
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("You don’t have payments yet.")
    expect(page).to have_no_content("Admin Inspection (Operational)")
    expect(page).to have_no_content("Lifecycle Pipeline Board")
  end

  it "quotes and submits a withdrawal from the dashboard" do
    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-3",
          result: summary_result(
            balance: "124",
            balances: {
              available: "124",
              pending: "0",
              locked: "61",
              asset: "CKB",
            },
          ),
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "withdrawal.quote" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "quote-1",
          result: {
            asset: "CKB",
            amount: "61",
            minimumAmount: "61",
            availableBalance: "124",
            lockedBalance: "61",
            networkFee: "0.00001",
            receiveAmount: "60.99999",
            destinationValid: true,
            validationMessage: nil,
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

    expect(page).to have_content("Withdraw")
    fill_in "Amount", with: "61"
    fill_in "Destination Address", with: "ckt1qyqg5xa84dfwfy76tptw2sy0k9q98xaeka9q5tvdlm"

    expect(page).to have_content("Available")
    expect(page).to have_content("124 CKB")
    expect(page).to have_content("Locked")
    expect(page).to have_content("61 CKB")
    expect(page).to have_content("Network fee")
    expect(page).to have_content("You receive")
    expect(page).to have_content("Address valid")

    click_button "Request Withdrawal"

    expect(page).to have_content("Requested withdrawal wd-1")
    expect(page).to have_content("PENDING")

    expect(WebMock).to have_requested(:post, "https://fiber-link.example/rpc").with { |request|
      body = JSON.parse(request.body)
      body.fetch("method") == "withdrawal.request" &&
        body.dig("params", "userId") == user.id.to_s &&
        body.dig("params", "amount") == "61" &&
        body.dig("params", "destination", "kind") == "CKB_ADDRESS"
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
          result: summary_result(
            balance: "124",
            balances: {
              available: "124",
              pending: "0",
              locked: "61",
              asset: "CKB",
            },
          ),
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "withdrawal.quote" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "quote-2",
          result: {
            asset: "CKB",
            amount: "61",
            minimumAmount: "61",
            availableBalance: "124",
            lockedBalance: "61",
            networkFee: "0.00001",
            receiveAmount: "60.99999",
            destinationValid: true,
            validationMessage: nil,
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

    fill_in "Amount", with: "61"
    fill_in "Destination Address", with: "ckt1qyqg5xa84dfwfy76tptw2sy0k9q98xaeka9q5tvdlm"
    click_button "Request Withdrawal"

    expect(page).to have_content("Withdrawal queued until liquidity is available.")
    expect(page).to have_content("Liquidity Pending")
    expect(page).to have_content("Requested withdrawal wd-liquidity")
  end
end
