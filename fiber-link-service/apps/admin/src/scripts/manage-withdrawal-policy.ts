import { parseWithdrawalPolicyCommand, runWithdrawalPolicyCommand } from "../withdrawal-policy-ops";

async function main() {
  const command = parseWithdrawalPolicyCommand(process.argv.slice(2));
  const result = await runWithdrawalPolicyCommand(command);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error("manage-withdrawal-policy failed", error);
  process.exit(1);
});
