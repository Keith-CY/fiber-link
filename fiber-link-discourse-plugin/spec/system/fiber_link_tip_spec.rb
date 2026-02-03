require "system_helper"

RSpec.describe "Fiber Link Tip", type: :system do
  it "shows tip modal" do
    visit "/t/1"
    click_button "Tip"
    expect(page).to have_content("Pay with Fiber")
  end
end
