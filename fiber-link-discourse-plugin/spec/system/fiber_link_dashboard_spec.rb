require "system_helper"

RSpec.describe "Fiber Link Dashboard", type: :system do
  it "shows balance" do
    visit "/fiber-link"
    expect(page).to have_content("Balance")
  end
end
