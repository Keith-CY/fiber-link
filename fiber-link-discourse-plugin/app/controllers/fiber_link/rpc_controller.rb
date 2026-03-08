# frozen_string_literal: true

require "base64"
require "json"
require "rqrcode"
require "rqrcode/export/svg"

module ::FiberLink
  class RpcController < ::ApplicationController
    requires_plugin "fiber-link"
    before_action :ensure_logged_in

    ALLOWED_WITHDRAWAL_STATES = ["ALL", "LIQUIDITY_PENDING", "PENDING", "PROCESSING", "RETRY_PENDING", "COMPLETED", "FAILED"].freeze
    ALLOWED_SETTLEMENT_STATES = ["ALL", "UNPAID", "SETTLED", "FAILED"].freeze

    def proxy
      request_json = parse_request_json
      return unless request_json

      request_id = request_json["id"]
      method = request_json["method"]
      params = request_json["params"] || {}

      sanitized_params = sanitize_params(method, params, request_id)
      return unless sanitized_params

      response = service_client.post(method:, params: sanitized_params, request_id:)
      render body: enrich_response_body(method, response.body), status: response.status, content_type: "application/json"
    rescue Excon::Error => error
      Rails.logger.error("Fiber Link RPC proxy error: #{error.message}")
      render json: {
               jsonrpc: "2.0",
               id: request_id,
               error: { code: -32000, message: "Service unavailable" },
             },
             status: :service_unavailable
    rescue Discourse::InvalidParameters => error
      render json: {
               jsonrpc: "2.0",
               id: request_id,
               error: { code: -32602, message: error.param.to_s.humanize },
             },
             status: :bad_request
    end

    private

    def service_client
      @service_client ||= ::FiberLink::ServiceClient.new
    end

    def parse_request_json
      JSON.parse(request.raw_post)
    rescue JSON::ParserError
      render json: {
               jsonrpc: "2.0",
               id: nil,
               error: { code: -32700, message: "Parse error" },
             },
             status: :bad_request
      nil
    end

    def sanitize_params(method, params, request_id)
      case method
      when "tip.create"
        sanitize_tip_create_params(params, request_id)
      when "tip.status"
        { invoice: params["invoice"] }
      when "dashboard.summary"
        sanitize_dashboard_summary_params(params, request_id)
      when "withdrawal.quote"
        sanitize_withdrawal_params(params, request_id)
      when "withdrawal.request"
        sanitize_withdrawal_params(params, request_id)
      else
        render_error(request_id, :bad_request, -32601, "Method not allowed")
        nil
      end
    end

    def sanitize_tip_create_params(params, request_id)
      post_id = begin
        Integer(params["postId"])
      rescue ArgumentError, TypeError
        nil
      end
      post = post_id && Post.find_by(id: post_id)
      unless post
        render_error(request_id, :bad_request, -32602, "Invalid params")
        return nil
      end

      if post.user_id == current_user.id
        render_error(request_id, :unprocessable_entity, -32002, "Cannot tip your own post")
        return nil
      end

      {
        amount: params["amount"],
        asset: params["asset"],
        postId: post_id.to_s,
        fromUserId: current_user.id.to_s,
        toUserId: post.user_id.to_s,
        message: params["message"].to_s.strip.presence,
      }.compact
    end

    def sanitize_dashboard_summary_params(params, request_id)
      requested_limit = begin
        Integer(params["limit"])
      rescue ArgumentError, TypeError
        nil
      end
      normalized_limit = if requested_limit.nil?
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
        render_error(request_id, :forbidden, -32001, "Unauthorized")
        return nil
      end

      withdrawal_state = params.dig("filters", "withdrawalState")
      withdrawal_state = "ALL" unless ALLOWED_WITHDRAWAL_STATES.include?(withdrawal_state)

      settlement_state = params.dig("filters", "settlementState")
      settlement_state = "ALL" unless ALLOWED_SETTLEMENT_STATES.include?(settlement_state)

      {
        userId: current_user.id.to_s,
        limit: normalized_limit,
        includeAdmin: include_admin,
        filters: {
          withdrawalState: withdrawal_state,
          settlementState: settlement_state,
        },
      }
    end

    def sanitize_withdrawal_params(params, request_id)
      amount = params["amount"].to_s.strip
      asset = params["asset"].to_s.strip.presence || "CKB"
      destination = normalize_withdrawal_destination(params)

      if amount.blank? || destination.blank?
        render_error(request_id, :bad_request, -32602, "Invalid params")
        return nil
      end

      {
        userId: current_user.id.to_s,
        amount: amount,
        asset: asset,
        destination: destination,
      }
    end

    def normalize_withdrawal_destination(params)
      kind = params.dig("destination", "kind").to_s.strip.presence
      if kind == "CKB_ADDRESS"
        address = params.dig("destination", "address").to_s.strip
        return nil if address.blank?

        return {
          kind: "CKB_ADDRESS",
          address: address,
        }
      end

      if kind == "PAYMENT_REQUEST"
        payment_request = params.dig("destination", "paymentRequest").to_s.strip
        return nil if payment_request.blank?

        return {
          kind: "PAYMENT_REQUEST",
          paymentRequest: payment_request,
        }
      end

      legacy_to_address = params["toAddress"].to_s.strip
      return nil if legacy_to_address.blank?

      {
        kind: legacy_to_address.start_with?("ckt1", "ckb1") ? "CKB_ADDRESS" : "PAYMENT_REQUEST",
        address: legacy_to_address,
      }.tap do |payload|
        if payload[:kind] == "PAYMENT_REQUEST"
          payload.delete(:address)
          payload[:paymentRequest] = legacy_to_address
        end
      end
    end

    def enrich_response_body(method, raw_body)
      payload = JSON.parse(raw_body)

      case method
      when "tip.create"
        enrich_tip_create_result(payload)
      when "dashboard.summary"
        enrich_dashboard_summary_result(payload)
      else
        payload.to_json
      end
    rescue JSON::ParserError => error
      Rails.logger.warn("Fiber Link RPC proxy response JSON parse failed: #{error.message}")
      raw_body
    end

    def enrich_tip_create_result(payload)
      invoice = payload.dig("result", "invoice")
      return payload.to_json if invoice.blank?

      qr_data_url = build_invoice_qr_data_url(invoice)
      payload["result"]["invoiceQrDataUrl"] = qr_data_url if qr_data_url.present?
      payload.to_json
    end

    def enrich_dashboard_summary_result(payload)
      tips = Array(payload.dig("result", "tips"))
      return payload.to_json if tips.empty?

      user_ids = tips.filter_map { |tip| tip["counterpartyUserId"].presence }.uniq
      usernames = User.where(id: user_ids).pluck(:id, :username).to_h.transform_keys(&:to_s)
      tips.each do |tip|
        username = usernames[tip["counterpartyUserId"].to_s]
        tip["counterpartyUsername"] = username if username.present?
      end
      payload.to_json
    end

    def build_invoice_qr_data_url(invoice)
      svg = RQRCode::QRCode.new(invoice).as_svg(
        offset: 0,
        color: "000",
        shape_rendering: "crispEdges",
        module_size: 6,
        standalone: true,
        use_path: true,
      )
      "data:image/svg+xml;base64,#{Base64.strict_encode64(svg)}"
    rescue StandardError => error
      Rails.logger.warn("Fiber Link invoice QR generation failed: #{error.message}")
      nil
    end

    def render_error(request_id, status, code, message)
      render json: {
               jsonrpc: "2.0",
               id: request_id,
               error: { code: code, message: message },
             },
             status: status
    end
  end
end
