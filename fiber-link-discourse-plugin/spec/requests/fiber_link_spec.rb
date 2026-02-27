require "rails_helper"

RSpec.describe "FiberLink", type: :request do
  it "adds settings" do
    expect(SiteSetting.respond_to?(:fiber_link_enabled)).to be(true)
  end

  it "hides plugin routes when disabled" do
    SiteSetting.fiber_link_enabled = false

    get "/fiber-link"
    expect(response).to have_http_status(:not_found)

    post "/fiber-link/rpc",
         params: { jsonrpc: "2.0", id: "x", method: "tip.status", params: { invoice: "inv-1" } },
         as: :json
    expect(response).to have_http_status(:not_found)
  end
end
