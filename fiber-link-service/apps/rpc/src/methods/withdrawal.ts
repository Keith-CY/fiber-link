export type RequestWithdrawalInput = {
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  toAddress: string;
};

export async function requestWithdrawal(input: RequestWithdrawalInput) {
  return { id: "w1", state: "PENDING" as const };
}
