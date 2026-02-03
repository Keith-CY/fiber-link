export async function markSettled(_: { invoice: string }) {
  return { credited: true };
}
