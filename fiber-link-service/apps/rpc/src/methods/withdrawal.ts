export async function requestWithdrawal(input: {
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  toAddress: string;
}) {
  return { id: "w1", state: "PENDING" as const };
}
