import { FiberRpcError, createAdapter } from "@fiber-link/fiber-adapter";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const endpoint = process.env.FIBER_RPC_URL ?? "http://fnn:8227";
  const adapter = createAdapter({ endpoint });

  const created = await adapter.createInvoice({ amount: "1", asset: "CKB" });
  assert(created.invoice, "createInvoice returned empty invoice");

  const status = await adapter.getInvoiceStatus({ invoice: created.invoice });
  assert(status.state === "UNPAID", `expected invoice status UNPAID, received ${status.state}`);

  let withdrawalProbe: string;
  try {
    const withdrawal = await adapter.executeWithdrawal({
      amount: "1",
      asset: "CKB",
      destination: {
        kind: "PAYMENT_REQUEST",
        paymentRequest: created.invoice,
      },
      requestId: `e2e-${Date.now()}`,
    });
    withdrawalProbe = `ok:${withdrawal.txHash}`;
  } catch (error) {
    if (error instanceof FiberRpcError) {
      withdrawalProbe = `rpc-error:${error.code ?? "unknown"}:${error.message}`;
    } else {
      throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        invoice: created.invoice,
        status: status.state,
        withdrawalProbe,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error("fiber-adapter-e2e failed", error);
  process.exit(1);
});
