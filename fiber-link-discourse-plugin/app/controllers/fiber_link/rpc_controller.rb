# frozen_string_literal: true

module ::FiberLink
  class RpcController < ::ApplicationController
    requires_plugin ::FiberLink
    before_action :ensure_logged_in

    def proxy
      service_url = SiteSetting.fiber_link_service_url
      app_id = SiteSetting.fiber_link_app_id
      app_secret = SiteSetting.fiber_link_app_secret

      raise Discourse::InvalidParameters.new(:fiber_link_service_url) if service_url.blank?
      raise Discourse::InvalidParameters.new(:fiber_link_app_id) if app_id.blank?
      raise Discourse::InvalidParameters.new(:fiber_link_app_secret) if app_secret.blank?

      payload = request.raw_post
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

      response = Excon.post("#{service_url}/rpc", body: payload, headers: headers)
      render body: response.body, status: response.status, content_type: "application/json"
    end
  end
end
