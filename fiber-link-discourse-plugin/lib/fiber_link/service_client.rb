# frozen_string_literal: true

require "json"
require "openssl"
require "securerandom"

module ::FiberLink
  class ServiceClient
    class Error < StandardError; end

    def initialize(service_url: SiteSetting.fiber_link_service_url, app_id: SiteSetting.fiber_link_app_id, app_secret: SiteSetting.fiber_link_app_secret)
      @service_url = service_url
      @app_id = app_id
      @app_secret = app_secret

      raise Discourse::InvalidParameters.new(:fiber_link_service_url) if @service_url.blank?
      raise Discourse::InvalidParameters.new(:fiber_link_app_id) if @app_id.blank?
      raise Discourse::InvalidParameters.new(:fiber_link_app_secret) if @app_secret.blank?
    end

    def post(method:, params:, request_id: SecureRandom.uuid)
      payload = build_payload(method: method, params: params, request_id: request_id)
      Excon.post(
        "#{@service_url}/rpc",
        body: payload,
        headers: signed_headers(payload),
      )
    end

    def call(method:, params:, request_id: SecureRandom.uuid)
      response = post(method: method, params: params, request_id: request_id)
      payload = JSON.parse(response.body)
      if payload["error"]
        raise Error, payload.dig("error", "message") || "Fiber Link RPC error"
      end
      payload
    rescue JSON::ParserError => error
      raise Error, "Fiber Link RPC JSON parse failed: #{error.message}"
    end

    private

    def build_payload(method:, params:, request_id:)
      {
        jsonrpc: "2.0",
        id: request_id,
        method: method,
        params: params,
      }.to_json
    end

    def signed_headers(payload)
      ts = Time.now.to_i.to_s
      nonce = SecureRandom.hex(8)
      signature = OpenSSL::HMAC.hexdigest("sha256", @app_secret, "#{ts}.#{nonce}.#{payload}")

      {
        "Content-Type" => "application/json",
        "x-app-id" => @app_id,
        "x-ts" => ts,
        "x-nonce" => nonce,
        "x-signature" => signature,
      }
    end
  end
end
