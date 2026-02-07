require "rails_helper"

RSpec.describe "FiberLink", type: :request do
  it "adds settings" do
    expect(SiteSetting.respond_to?(:fiber_link_enabled)).to be(true)
  end
end
