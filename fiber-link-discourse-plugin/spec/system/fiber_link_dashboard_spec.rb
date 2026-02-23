# frozen_string_literal: true

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

  it "shows balance and tip feed values from dashboard.summary" do
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
                amount: "1",
                asset: "CKB",
                state: "SETTLED",
                direction: "IN",
                counterpartyUserId: "42",
                createdAt: "2026-02-16T00:00:00.000Z",
              },
            ],
            generatedAt: "2026-02-16T00:00:00.000Z",
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("Fiber Link Dashboard")
    expect(page).to have_content("12.5 CKB")
    expect(page).to have_content("inv-live-1")
    expect(page).to have_content("SETTLED")
    expect(page).to have_content("Incoming")
  end

  it "shows tip feed empty state when dashboard.summary has no records" do
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
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("Fiber Link Dashboard")
    expect(page).to have_content("0 CKB")
    expect(page).to have_content("No tips available for this account yet.")
    expect(page).to have_content("Admin inspection view is available to admins only.")
  end

  it "shows admin inspection tables for admins" do
    admin = Fabricate(:admin)
    sign_in(admin)

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-admin",
          result: {
            balance: "1",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
            admin: {
              filtersApplied: { withdrawalState: "ALL", settlementState: "ALL" },
              apps: [{ appId: "app1", createdAt: "2026-02-16T00:00:00.000Z" }],
              withdrawals: [{ id: "w1", userId: "u1", asset: "CKB", amount: "1", state: "PENDING", retryCount: 0, createdAt: "2026-02-16T00:00:00.000Z", updatedAt: "2026-02-16T00:00:00.000Z", txHash: nil, nextRetryAt: nil, lastError: nil }],
              settlements: [{ id: "s1", invoice: "inv-1", fromUserId: "1", toUserId: "2", state: "UNPAID", retryCount: 0, createdAt: "2026-02-16T00:00:00.000Z", settledAt: nil, nextRetryAt: nil, lastCheckedAt: nil, lastError: nil, failureReason: nil }],
            },
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("Admin Inspection (Operational)")
    expect(page).to have_content("app1")
    expect(page).to have_content("inv-1")
    expect(page).to have_content("PENDING")
  end

  it "renders lifecycle board with stage filters, csv export, and timeline placeholders" do
    admin = Fabricate(:admin)
    sign_in(admin)

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-admin-board",
          result: {
            balance: "5",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
            admin: {
              filtersApplied: { withdrawalState: "ALL", settlementState: "ALL" },
              apps: [],
              withdrawals: [],
              settlements: [],
              pipelineBoard: {
                stageCounts: [
                  { stage: "UNPAID", count: 1 },
                  { stage: "SETTLED", count: 0 },
                  { stage: "FAILED", count: 1 },
                ],
                invoiceRows: [
                  {
                    invoice: "inv-board-1",
                    state: "UNPAID",
                    amount: "1.5",
                    asset: "CKB",
                    fromUserId: "10",
                    toUserId: "20",
                    createdAt: "2026-02-16T00:00:00.000Z",
                    timelineHref: "/fiber-link/timeline/inv-board-1",
                  },
                  {
                    invoice: "inv-board-2",
                    state: "FAILED",
                    amount: "2.0",
                    asset: "USDI",
                    fromUserId: "11",
                    toUserId: "22",
                    createdAt: "2026-02-16T00:00:00.000Z",
                    timelineHref: "/fiber-link/timeline/inv-board-2",
                  },
                ],
              },
            },
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link"

    expect(page).to have_content("Lifecycle Pipeline Board")
    expect(page).to have_content("UNPAID: 1")
    expect(page).to have_content("FAILED: 1")
    expect(page).to have_content("inv-board-1")
    expect(page).to have_content("inv-board-2")
    expect(page).to have_link("Export CSV", href: %r{^data:text/csv})
    expect(page).to have_css("a[href='/fiber-link/timeline/inv-board-1']", text: "Timeline")

    select "FAILED", from: "Lifecycle stage"

    expect(page).to have_content("inv-board-2")
    expect(page).to have_no_content("inv-board-1")
  end

  it "renders contextual empty-state guidance and avoids absolute admin filter form action" do
    admin = Fabricate(:admin)
    sign_in(admin)

    stub_request(:post, "https://fiber-link.example/rpc")
      .with { |request| JSON.parse(request.body).fetch("method") == "dashboard.summary" }
      .to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-admin-empty",
          result: {
            balance: "0",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
            admin: {
              filtersApplied: { withdrawalState: "PENDING", settlementState: "FAILED" },
              apps: [],
              withdrawals: [],
              settlements: [],
            },
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

    visit "/fiber-link?withdrawalState=PENDING&settlementState=FAILED"

    expect(page).to have_content("No app records from admin payload. Verify plugin app credentials and refresh.")
    expect(page).to have_content("No withdrawals for current filter.")
    expect(page).to have_content("No settlement rows for current filter.")
    expect(page).to have_link("Reset to ALL", href: /withdrawalState=ALL/)
    expect(page).to have_link("Show all withdrawal states")
    expect(page).to have_link("Show all settlement states")
    expect(page).to have_no_css("form[action='/fiber-link']")
  end
end
