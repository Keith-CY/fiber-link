require "system_helper"

RSpec.describe "Fiber Link Tip Feed", type: :system do
  it "shows tip list" do
    visit "/t/1"
    expect(page).to have_content("Tips")
  end
end
