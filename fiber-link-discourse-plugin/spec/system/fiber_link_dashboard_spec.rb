RSpec.describe "Fiber Link Dashboard", type: :system do
  it "shows lifecycle empty state and mapping table" do
    visit "/fiber-link"
    expect(page).to have_content("Fiber Link Lifecycle Demo")
    expect(page).to have_content("No invoice selected")
    expect(page).to have_content("State Mapping")
    expect(page).to have_content("created")
    expect(page).to have_content("UNPAID")
    expect(page).to have_content("settling")
  end
end
