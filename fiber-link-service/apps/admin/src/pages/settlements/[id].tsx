import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { PageHeader, QueryBoundary, RoleGate } from "../../components/page";
import { SettlementStateBadge } from "../../components/settlement-state-badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { formatDateTime, shorten } from "../../lib/format";
import { trpc } from "../../utils/trpc";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default function SettlementDetailPage() {
  const router = useRouter();
  const invoice = typeof router.query.id === "string" ? router.query.id : "";
  const session = trpc.session.me.useQuery();
  const isSuperAdmin = session.data?.role === "SUPER_ADMIN";
  const utils = trpc.useUtils();
  const [note, setNote] = useState("");

  const timeline = trpc.settlements.timeline.useQuery(
    { invoice },
    { enabled: isSuperAdmin && router.isReady && Boolean(invoice) },
  );

  const retryNow = trpc.settlements.retryNow.useMutation({
    onSuccess: async () => {
      toast.success("Retry state cleared; the worker re-checks this invoice on its next poll");
      await utils.settlements.timeline.invalidate({ invoice });
    },
    onError: (error) => toast.error(error.message),
  });

  const addOpsNote = trpc.settlements.addOpsNote.useMutation({
    onSuccess: async () => {
      toast.success("Ops note recorded");
      setNote("");
      await utils.settlements.timeline.invalidate({ invoice });
    },
    onError: (error) => toast.error(error.message),
  });

  const intent = timeline.data?.intent;
  const events = timeline.data?.events ?? [];
  const adminActions = timeline.data?.adminActions ?? [];

  return (
    <div>
      <PageHeader
        title={`Settlement ${shorten(invoice, 12, 8)}`}
        description="Tip-intent lifecycle timeline and recovery actions."
        actions={
          <Link className="text-sm text-primary hover:underline" href="/settlements">
            ← Settlements
          </Link>
        }
      />
      <QueryBoundary isLoading={session.isLoading} error={session.error}>
        <RoleGate allowed={isSuperAdmin}>
          <QueryBoundary isLoading={timeline.isLoading} error={timeline.error}>
            {intent ? (
              <div className="space-y-6">
                <Card data-testid="settlement-intent-summary">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <span className="font-mono text-sm" title={intent.invoice}>
                        {shorten(intent.invoice, 16, 10)}
                      </span>
                      <SettlementStateBadge state={intent.invoiceState} />
                    </CardTitle>
                    <CardDescription>
                      {intent.amount} {intent.asset} tipped on post {intent.postId} in{" "}
                      <Link className="text-primary hover:underline" href={`/apps/${intent.appId}`}>
                        {intent.appId}
                      </Link>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <Field label="From user">
                        <span className="font-mono text-xs">{intent.fromUserId || "—"}</span>
                      </Field>
                      <Field label="To user">
                        <span className="font-mono text-xs">{intent.toUserId || "—"}</span>
                      </Field>
                      <Field label="Created">{formatDateTime(intent.createdAt)}</Field>
                      <Field label="Settled">{formatDateTime(intent.settledAt)}</Field>
                      <Field label="Retry count">{intent.settlementRetryCount}</Field>
                      <Field label="Next retry">{formatDateTime(intent.settlementNextRetryAt)}</Field>
                      <Field label="Last checked">{formatDateTime(intent.settlementLastCheckedAt)}</Field>
                      <Field label="Failure reason">
                        {intent.settlementFailureReason ? (
                          <span className="font-medium text-destructive">{intent.settlementFailureReason}</span>
                        ) : (
                          "—"
                        )}
                      </Field>
                    </dl>
                    {intent.settlementLastError ? (
                      <p className="mt-4 rounded-md bg-destructive/10 p-3 font-mono text-xs text-destructive">
                        {intent.settlementLastError}
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-end gap-4">
                      <Button
                        data-testid="settlement-retry-now"
                        disabled={intent.invoiceState !== "UNPAID" || retryNow.isPending}
                        onClick={() => retryNow.mutate({ invoice })}
                      >
                        Retry now
                      </Button>
                      {intent.invoiceState !== "UNPAID" ? (
                        <p className="text-xs text-muted-foreground">
                          Retry is only available while the invoice is UNPAID; {intent.invoiceState} is terminal.
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="settlement-timeline">
                  <CardHeader>
                    <CardTitle>Lifecycle timeline</CardTitle>
                    <CardDescription>
                      Creation, status checks, retries, failures, settlement, and credit application from{" "}
                      <code>tip_intent_events</code>.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {events.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No lifecycle events recorded for this invoice.</p>
                    ) : (
                      <ol className="space-y-3">
                        {events.map((event) => (
                          <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                            <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                              {formatDateTime(event.createdAt)}
                            </span>
                            <span className="font-medium">{event.type}</span>
                            <span className="text-xs text-muted-foreground">{event.source}</span>
                            {event.previousInvoiceState || event.nextInvoiceState ? (
                              <span className="text-xs text-muted-foreground">
                                {event.previousInvoiceState ?? "?"} → {event.nextInvoiceState ?? "?"}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardContent>
                </Card>

                <Card data-testid="settlement-admin-actions">
                  <CardHeader>
                    <CardTitle>Investigation log</CardTitle>
                    <CardDescription>Audited admin actions (retries and ops notes) for this invoice.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="mb-4 flex flex-wrap items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (note.trim()) {
                          addOpsNote.mutate({ invoice, note: note.trim() });
                        }
                      }}
                    >
                      <div className="min-w-64 flex-1">
                        <Label htmlFor="ops-note" className="mb-1 block text-xs text-muted-foreground">
                          Ops note
                        </Label>
                        <Input
                          id="ops-note"
                          data-testid="settlement-ops-note-input"
                          value={note}
                          maxLength={2000}
                          placeholder="e.g. Confirmed with the payer; awaiting channel rebalance."
                          onChange={(event) => setNote(event.target.value)}
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="outline"
                        data-testid="settlement-ops-note-submit"
                        disabled={!note.trim() || addOpsNote.isPending}
                      >
                        Add note
                      </Button>
                    </form>
                    {adminActions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>
                    ) : (
                      <ol className="space-y-3">
                        {adminActions.map((action, index) => (
                          <li
                            key={`${action.createdAt}-${index}`}
                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                          >
                            <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                              {formatDateTime(action.createdAt)}
                            </span>
                            <span className="font-medium">{action.action}</span>
                            <span className="text-xs text-muted-foreground">
                              {action.actorId} ({action.actorRole})
                            </span>
                            {action.reason ? <span className="basis-full text-sm">{action.reason}</span> : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </QueryBoundary>
        </RoleGate>
      </QueryBoundary>
    </div>
  );
}
