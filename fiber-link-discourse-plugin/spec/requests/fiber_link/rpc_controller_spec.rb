require "rails_helper"

RSpec.describe ::FiberLink::RpcController, type: :request do
  fab!(:user)
  fab!(:topic, :topic_with_op)

  before do
    SiteSetting.fiber_link_enabled = true
    SiteSetting.fiber_link_service_url = "https://fiber-link.example"
    SiteSetting.fiber_link_app_id = "app1"
    SiteSetting.fiber_link_app_secret = "secret"
  end

  describe "POST /fiber-link/rpc" do
    it "server-enforces sensitive tip.create params" do
      sign_in(user)

      post_id = topic.first_post.id
      to_user_id = topic.first_post.user_id

      stub_request(:post, "https://fiber-link.example/rpc").to_return(
        status: 200,
        body: { jsonrpc: "2.0", id: "req1", result: { invoice: "inv-1" } }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

      # Attempt to spoof user identities from the client side; server should ignore these.
      post "/fiber-link/rpc",
           params: {
             jsonrpc: "2.0",
             id: "req1",
             method: "tip.create",
             params: {
               amount: "1",
               asset: "CKB",
               postId: post_id,
               fromUserId: -1,
               toUserId: -1,
             },
           },
           as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("result", "invoice")).to eq("inv-1")

      expect(WebMock).to have_requested(:post, "https://fiber-link.example/rpc").with { |request|
        body = JSON.parse(request.body)
        body.fetch("method") == "tip.create" &&
          body.dig("params", "postId") == post_id &&
          body.dig("params", "fromUserId") == user.id &&
          body.dig("params", "toUserId") == to_user_id
      }
    end

    it "server-enforces dashboard.summary params" do
      sign_in(user)

      stub_request(:post, "https://fiber-link.example/rpc").to_return(
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "dash-req",
          result: {
            balance: "12.5",
            tips: [],
            generatedAt: "2026-02-16T00:00:00.000Z",
          },
        }.to_json,
        headers: { "Content-Type" => "application/json" },
      )

      post "/fiber-link/rpc",
           params: {
             jsonrpc: "2.0",
             id: "dash-req",
             method: "dashboard.summary",
             params: {
               userId: "spoofed-user-id",
               limit: 999,
             },
           },
           as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("result", "balance")).to eq("12.5")

      expect(WebMock).to have_requested(:post, "https://fiber-link.example/rpc").with { |request|
        body = JSON.parse(request.body)
        body.fetch("method") == "dashboard.summary" &&
          body.dig("params", "userId") == user.id.to_s &&
          body.dig("params", "limit") == 50
      }
    end

    it "rejects unknown methods without forwarding" do
      sign_in(user)

      stub_request(:post, "https://fiber-link.example/rpc").to_return(status: 200, body: "{}")

      post "/fiber-link/rpc",
           params: { jsonrpc: "2.0", id: "x", method: "admin.shutdown", params: {} },
           as: :json

      expect(response).to have_http_status(:bad_request)
      body = JSON.parse(response.body)
      expect(body.fetch("jsonrpc")).to eq("2.0")
      expect(body.fetch("id")).to eq("x")
      expect(body.dig("error", "code")).to eq(-32601)

      expect(WebMock).not_to have_requested(:post, "https://fiber-link.example/rpc")
    end

    it "returns a JSON-RPC error envelope for invalid postId" do
      sign_in(user)

      stub_request(:post, "https://fiber-link.example/rpc").to_return(status: 200, body: "{}")

      post "/fiber-link/rpc",
           params: {
             jsonrpc: "2.0",
             id: "bad-post",
             method: "tip.create",
             params: {
               amount: "1",
               asset: "CKB",
               postId: 999_999_999,
             },
           },
           as: :json

      expect(response).to have_http_status(:bad_request)
      body = JSON.parse(response.body)
      expect(body.fetch("jsonrpc")).to eq("2.0")
      expect(body.fetch("id")).to eq("bad-post")
      expect(body.dig("error", "code")).to eq(-32602)

      expect(WebMock).not_to have_requested(:post, "https://fiber-link.example/rpc")
    end
  end
end
