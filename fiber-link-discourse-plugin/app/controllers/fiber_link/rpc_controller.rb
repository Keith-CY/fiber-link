# frozen_string_literal: true

module ::FiberLink
  class RpcController < ::ApplicationController
    requires_plugin "fiber-link"
    before_action :ensure_logged_in

    def proxy
      service_url = SiteSetting.fiber_link_service_url
      app_id = SiteSetting.fiber_link_app_id
      app_secret = SiteSetting.fiber_link_app_secret

      raise Discourse::InvalidParameters.new(:fiber_link_service_url) if service_url.blank?
      raise Discourse::InvalidParameters.new(:fiber_link_app_id) if app_id.blank?
      raise Discourse::InvalidParameters.new(:fiber_link_app_secret) if app_secret.blank?

      raw_payload = request.raw_post
      request_json = begin
        JSON.parse(raw_payload)
      rescue JSON::ParserError
        render json: {
                 jsonrpc: "2.0",
                 id: nil,
                 error: { code: -32700, message: "Parse error" },
               },
               status: :bad_request
        return
      end

      request_id = request_json["id"]
      method = request_json["method"]
      params = request_json["params"] || {}

      # This endpoint HMAC-signs payloads as the app. Never forward arbitrary browser payloads.
      sanitized_params =
        case method
        when "tip.create"
          post_id = begin
            Integer(params["postId"])
          rescue ArgumentError, TypeError
            nil
          end
          post = post_id && Post.find_by(id: post_id)
          if post.blank?
            render json: {
                     jsonrpc: "2.0",
                     id: request_id,
                     error: { code: -32602, message: "Invalid params" },
                   },
                   status: :bad_request
            return
          end

          {
            amount: params["amount"],
            asset: params["asset"],
            postId: post_id,
            fromUserId: current_user.id,
            toUserId: post.user_id,
          }
        when "tip.status"
          { invoice: params["invoice"] }
        when "dashboard.summary"
          requested_limit = begin
            Integer(params["limit"])
          rescue ArgumentError, TypeError
            nil
          end
          normalized_limit =
            if requested_limit.nil?
              20
            elsif requested_limit < 1
              1
            elsif requested_limit > 50
              50
            else
              requested_limit
            end

          include_admin = params["includeAdmin"] == true
          if include_admin && !current_user.admin?
            render json: {
                     jsonrpc: "2.0",
                     id: request_id,
                     error: { code: -32001, message: "Unauthorized" },
                   },
                   status: :forbidden
            return
          end

          allowed_withdrawal_states = ["ALL", "PENDING", "PROCESSING", "RETRY_PENDING", "COMPLETED", "FAILED"]
          allowed_settlement_states = ["ALL", "UNPAID", "SETTLED", "FAILED"]

          withdrawal_state = params.dig("filters", "withdrawalState")
          withdrawal_state = "ALL" unless allowed_withdrawal_states.include?(withdrawal_state)

          settlement_state = params.dig("filters", "settlementState")
          settlement_state = "ALL" unless allowed_settlement_states.include?(settlement_state)

          {
            userId: current_user.id.to_s,
            limit: normalized_limit,
            includeAdmin: include_admin,
            filters: {
              withdrawalState: withdrawal_state,
              settlementState: settlement_state,
            },
          }
        else
          render json: {
                   jsonrpc: "2.0",
                   id: request_id,
                   error: { code: -32601, message: "Method not allowed" },
                 },
                 status: :bad_request
          return
        end

      payload = {
        jsonrpc: "2.0",
        id: request_id,
        method: method,
        params: sanitized_params,
      }.to_json

      ts = Time.now.to_i.to_s
      nonce = SecureRandom.hex(8)
      signature = OpenSSL::HMAC.hexdigest("sha256", app_secret, "#{ts}.#{nonce}.#{payload}")

      headers = {
        "Content-Type" => "application/json",
        "x-app-id" => app_id,
        "x-ts" => ts,
        "x-nonce" => nonce,
        "x-signature" => signature,
      }

      begin
        response = Excon.post("#{service_url}/rpc", body: payload, headers: headers)
        render body: response.body, status: response.status, content_type: "application/json"
      rescue Excon::Error => error
        Rails.logger.error("Fiber Link RPC proxy error: #{error.message}")
        render json: {
                 jsonrpc: "2.0",
                 id: request_id,
                 error: { code: -32000, message: "Service unavailable" },
               },
               status: :service_unavailable
      end
    end
  end
end
