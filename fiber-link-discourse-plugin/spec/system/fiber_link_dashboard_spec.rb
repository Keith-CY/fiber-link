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
  end
end
