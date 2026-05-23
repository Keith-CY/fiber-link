# frozen_string_literal: true

require "base64"
require "json"
require "net/http"
require "rqrcode"
require "rqrcode/export/svg"

module ::FiberLink
  class RpcController < ::ApplicationController
    include ActionController::Live

    requires_plugin "fiber-link"
    before_action :ensure_logged_in

    ALLOWED_WITHDRAWAL_STATES = ["ALL", "LIQUIDITY_PENDING", "PENDING", "PROCESSING", "RETRY_PENDING", "COMPLETED", "FAILED"].freeze
    ALLOWED_SETTLEMENT_STATES = ["ALL", "UNPAID", "SETTLED", "FAILED"].freeze
    READ_METHOD_RATE_LIMIT = [60, 60].freeze
    MUTATING_METHOD_RATE_LIMIT = [10, 60].freeze
    MUTATING_METHODS = ["tip.create", "withdrawal.request"].freeze

    # Proxy the backend SSE stream to the browser so clients don't need direct
    # access to the Fastify service and authentication remains Discourse-session-gated.
    def stream
      invoice = params[:invoice].to_s.strip

      if invoice.blank?
        render status: :bad_request, json: { error: "Missing invoice" }
        return
      end

      response.headers["Content-Type"] = "text/event-stream"
      response.headers["Cache-Control"] = "no-cache"
      response.headers["X-Accel-Buffering"] = "no"

      service_url = SiteSetting.fiber_link_service_url
      if service_url.blank?
        response.stream.write("data: #{JSON.generate({ status: "SSE_ERROR", reason: "service_unavailable" })}\n\n")
        response.stream.close
        return
      end

      backend_url = URI("#{service_url}/rpc/stream?invoice=#{URI.encode_www_form_component(invoice)}")

      begin
        Net::HTTP.start(backend_url.host, backend_url.port, use_ssl: backend_url.scheme == "https", read_timeout: 65) do |http|
          http.request(Net::HTTP::Get.new(backend_url)) do |resp|
            resp.read_body do |chunk|
              break if response.stream.closed?
              response.stream.write(chunk)
            end
          end
        end
      rescue ActionController::Live::ClientDisconnected
        # Browser closed the connection — normal.
      rescue => error
        Rails.logger.error("Fiber Link SSE stream error: #{error.message}")
        response.stream.write("data: #{JSON.generate({ status: "SSE_ERROR" })}\n\n") rescue nil
      ensure
        response.stream.close rescue nil
      end
    end

    def proxy
      request_json = parse_request_json
      return unless request_json

      request_id = request_json["id"]
      method = request_json["method"]
      params = request_json.key?("params") ? request_json["params"] : {}

      unless params.is_a?(Hash)
        render_error(request_id, :bad_request, -32602, "Invalid params")
        return
      end

      sanitized_params = sanitize_params(method, params, request_id)
      return unless sanitized_params

      return unless validate_service_settings(request_id)

      return unless enforce_method_rate_limit(method, request_id)

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
      payload = JSON.parse(request.raw_post)
      return payload if payload.is_a?(Hash)

      render_error(nil, :bad_request, -32600, "Invalid request")
      nil
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

    def validate_service_settings(request_id)
      missing_setting = %i[fiber_link_service_url fiber_link_app_id fiber_link_app_secret].find do |setting|
        SiteSetting.public_send(setting).blank?
      end
      return true unless missing_setting

      render_error(request_id, :bad_request, -32603, missing_setting.to_s.humanize)
      false
    end

    def enforce_method_rate_limit(method, request_id)
      return true unless defined?(::RateLimiter)
      return true if current_user&.admin?

      max_requests, window_seconds = rate_limit_for_method(method)
      ::RateLimiter.new(current_user, "fiber_link_rpc_#{method.tr(".", "_")}", max_requests, window_seconds).performed!
      true
    rescue ::RateLimiter::LimitExceeded
      render_error(request_id, :too_many_requests, -32005, "Rate limit exceeded")
      false
    end

    def rate_limit_for_method(method)
      MUTATING_METHODS.include?(method) ? MUTATING_METHOD_RATE_LIMIT : READ_METHOD_RATE_LIMIT
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

      post_ids = tips.filter_map { |tip| Integer(tip["postId"], exception: false) }.uniq
      posts = Post.includes(:topic).where(id: post_ids).index_by { |post| post.id.to_s }

      tips.each do |tip|
        username = usernames[tip["counterpartyUserId"].to_s]
        tip["counterpartyUsername"] = username if username.present?

        post = posts[tip["postId"].to_s]
        next unless post

        tip["postUrl"] = post.url
        tip["postContextLabel"] = post.post_number.to_i > 1 ? "View the Reply" : "View the Post"
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
