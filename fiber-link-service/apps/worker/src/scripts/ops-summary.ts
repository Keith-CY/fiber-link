import { collectWorkerOpsSummary } from "../ops-summary";

async function main() {
  const summary = await collectWorkerOpsSummary();

  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== "ok") {
    process.exit(2);
  }
}

void main().catch((error) => {
  console.error("ops-summary failed", error);
  process.exit(1);
});
