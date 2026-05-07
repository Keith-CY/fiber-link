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
    expect(page).to have_content("Fiber Link Dashboard.")
  end

  it "links to the dashboard from the user menu profile panel" do
    visit "/"

    find(".d-header-icons .current-user button").click
    find("#user-menu-button-profile").click

    within("#quick-access-profile") do
      expect(page).to have_css(
        "li.fiber-link-user-menu-dashboard a[href$='/fiber-link']",
        text: "Fiber Link Dashboard",
      )
      expect(page).to have_css("li.fiber-link-user-menu-dashboard .d-icon-gift")
    end
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
              {
                id: "tip-live-2",
                invoice: "inv-live-2",
                postId: "p2",
                amount: "5",
                asset: "CKB",
                state: "SETTLED",
                direction: "OUT",
                counterpartyUserId: tipper.id.to_s,
                counterpartyUsername: tipper.username,
                message: "Nice reply",
                createdAt: "2026-02-16T00:10:00.000Z",
                settledAt: "2026-02-16T00:11:00.000Z",
              },
              {
                id: "wd-live-1",
                invoice: "withdrawal:wd-live-1",
                postId: "withdrawal",
                amount: "61",
                asset: "CKB",
                state: "COMPLETED",
                direction: "WITHDRAWAL",
                counterpartyUserId: user.id.to_s,
                counterpartyUsername: user.username,
                message: "On-chain withdrawal completed",
                createdAt: "2026-02-16T00:20:00.000Z",
                settledAt: "2026-02-16T00:21:00.000Z",
                activityType: "WITHDRAWAL",
                txHash: "0xabc123",
                explorerUrl: "https://pudge.explorer.nervos.org/transaction/0xabc123",
                destinationKind: "CKB_ADDRESS",
                destination: "ckt1withdrawal",
              },
            ],
            generatedAt: "2026-02-16T01:00:00.000Z",
          ),
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_css(".fiber-link-dashboard__metrics")
    expect(page).to have_content("Fiber Link Dashboard.")
    expect(page).to have_content(/Live · synced (now|\d+s ago)/)
    expect(page).to have_content("12.5 CKB")
    expect(page).to have_content("AVAILABLE BALANCE")
    expect(page).to have_content("Available to withdraw")
    within(".fiber-link-dashboard__metric.is-pending") do
      expect(page).to have_content("4")
      expect(page).to have_content("CKB")
    end
    expect(page).to have_content("Completed")
    expect(page).to have_content("1 invoice awaiting settlement")
    expect(page).to have_content("Successful payments · 30d")
    expect(page).to have_content("Requires attention")
    expect(page).to have_content("All transactions.")
    expect(page).to have_content("Auto-refresh")
    refresh_select = find(".fiber-link-dashboard__refresh-select select")
    expect(refresh_select.value).to eq("10000")
    refresh_select.find("option", text: "30s").select_option
    expect(find(".fiber-link-dashboard__refresh-select select").value).to eq("30000")
    expect(page).to have_content("@fiber_tipper")
    expect(page).to have_content("USER")
    expect(page).to have_no_css(".fiber-link-tip-feed-table th", text: "Details")
    expect(page).to have_button("All 2")
    expect(page).to have_button("Received 1")
    expect(page).to have_button("Withdrawals 1")
    expect(page).to have_no_button("Sent")
    expect(page).to have_no_css("input[placeholder='Search user...']")
    expect(page).to have_content("Completed")
    expect(page).to have_content("Completed")
    expect(page).to have_content("Great post")
    expect(page).to have_content("On-chain withdrawal completed")
    expect(page).to have_no_content("Nice reply")

    find("tr[data-tip-id='wd-live-1']").click
    expect(page).to have_content("Record ID")
    expect(page).to have_content("0xabc123")
    expect(page).to have_link("Open in CKB explorer ↗", href: "https://pudge.explorer.nervos.org/transaction/0xabc123")
    expect(page).to have_no_link("View full ledger")
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
    within(".fiber-link-dashboard__metric.is-pending") do
      expect(page).to have_content("31")
      expect(page).to have_content("CKB")
    end
    expect(page).to have_content("1 invoice awaiting settlement")

    Timeout.timeout(16) do
      loop do
        break if request_count_mutex.synchronize { request_count >= 2 }
        sleep 0.05
      end
    end

    expect(page).to have_no_content("Loading…", wait: 0)
    expect(page).to have_content("99 CKB")
    expect(page).to have_content("Completed")
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

    expect(page).to have_content("Move your settled CKB.")
    expect(page).to have_content("Minimum withdrawal is 61 CKB.")
    expect(page).to have_button("25%")
    expect(page).to have_button("50%")
    expect(page).to have_button("75%")
    expect(page).to have_button("Max · 124")
    expect(page).to have_no_content("Enter a valid CKB withdrawal address.")
    expect(page).to have_button("Request withdrawal", disabled: true)

    click_button "25%"
    expect(find("[data-fiber-link-withdrawal-input='amount']").value).to eq("61")
    click_button "75%"
    expect(find("[data-fiber-link-withdrawal-input='amount']").value).to eq("93")
    click_button "Max · 124"
    expect(find("[data-fiber-link-withdrawal-input='amount']").value).to eq("124")

    fill_in "Amount", with: "61"

    page.execute_script(<<~JS)
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { readText: () => Promise.reject(new Error("denied")) },
      });
    JS
    click_button "Paste"
    expect(page).to have_content("Clipboard access failed. Paste manually.")

    find("[data-fiber-link-withdrawal-input='address']").set(
      "ckt1qyqg5xa84dfwfy76tptw2sy0k9q98xaeka9q5tvdlm",
    )

    expect(page).to have_content("Available")
    expect(page).to have_content("124 CKB")
    expect(page).to have_content("LOCKED")
    expect(page).to have_content("61 CKB")
    expect(page).to have_content("NETWORK FEE")
    expect(page).to have_content("0.00001 CKB")
    expect(page).to have_content("PAYOUT AMOUNT")
    expect(page).to have_content("Address valid")
    expect(page).to have_button("Request withdrawal", disabled: false)

    click_button "Request withdrawal"

    expect(page).to have_css(".fk-d-toast", text: "Requested withdrawal wd-1")
    expect(page).to have_no_css("[data-fiber-link-withdrawal-result='success']")
    expect(page).to have_css("[data-fiber-link-withdrawal-result='id']", text: "wd-1")

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
    find("[data-fiber-link-withdrawal-input='address']").set(
      "ckt1qyqg5xa84dfwfy76tptw2sy0k9q98xaeka9q5tvdlm",
    )
    click_button "Request withdrawal"

    expect(page).to have_css(".fk-d-toast", text: "Withdrawal queued until liquidity is available.")
    expect(page).to have_no_css("[data-fiber-link-withdrawal-result='success']")
    expect(page).to have_css("[data-fiber-link-withdrawal-result='id']", text: "wd-liquidity")
  end
end
