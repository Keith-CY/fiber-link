import { useState } from "react";
import { PageHeader, QueryBoundary, RoleGate, StatCard } from "../components/page";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { formatDateTime, shorten } from "../lib/format";
import { trpc } from "../utils/trpc";

type Account = { appId: string; userId: string; asset: "CKB" | "USDI" };

export default function LedgerPage() {
  const session = trpc.session.me.useQuery();
  const isSuperAdmin = session.data?.role === "SUPER_ADMIN";

  const [appId, setAppId] = useState("");
  const [userId, setUserId] = useState("");
  const [asset, setAsset] = useState<"CKB" | "USDI">("CKB");
  const [account, setAccount] = useState<Account | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [reconcileAppId, setReconcileAppId] = useState("");
  const [reconcileArgs, setReconcileArgs] = useState<{ appId?: string } | null>(null);

  const breakdown = trpc.ledger.balanceBreakdown.useQuery(account ?? { appId: "", userId: "", asset: "CKB" }, {
    enabled: isSuperAdmin && account !== null,
  });
  const entries = trpc.ledger.entries.useQuery(
    account ? { appId: account.appId, userId: account.userId, asset: account.asset, cursor } : { appId: "" },
    { enabled: isSuperAdmin && account !== null },
  );
  const reconcile = trpc.ledger.reconcile.useQuery(reconcileArgs ?? {}, {
    enabled: isSuperAdmin && reconcileArgs !== null,
  });

  const anomalyCount = reconcile.data?.anomalies.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Ledger"
        description="Explain account balances from source credits/debits and reconcile the ledger against tips and withdrawals."
      />
      <QueryBoundary isLoading={session.isLoading} error={session.error}>
        <RoleGate allowed={isSuperAdmin}>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Account statement</CardTitle>
                <CardDescription>
                  Balance breakdown and paginated entries for one app/user/asset account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="mb-4 flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (appId.trim() && userId.trim()) {
                      setCursor(undefined);
                      setAccount({ appId: appId.trim(), userId: userId.trim(), asset });
                    }
                  }}
                >
                  <div className="w-44">
                    <Label htmlFor="ledger-app" className="mb-1 block text-xs text-muted-foreground">
                      App
                    </Label>
                    <Input id="ledger-app" value={appId} onChange={(event) => setAppId(event.target.value)} />
                  </div>
                  <div className="w-44">
                    <Label htmlFor="ledger-user" className="mb-1 block text-xs text-muted-foreground">
                      User
                    </Label>
                    <Input id="ledger-user" value={userId} onChange={(event) => setUserId(event.target.value)} />
                  </div>
                  <div className="w-28">
                    <Label htmlFor="ledger-asset" className="mb-1 block text-xs text-muted-foreground">
                      Asset
                    </Label>
                    <Select
                      id="ledger-asset"
                      value={asset}
                      onChange={(event) => setAsset(event.target.value as "CKB" | "USDI")}
                    >
                      <option value="CKB">CKB</option>
                      <option value="USDI">USDI</option>
                    </Select>
                  </div>
                  <Button type="submit" data-testid="ledger-load-account" disabled={!appId.trim() || !userId.trim()}>
                    Load account
                  </Button>
                </form>

                {account ? (
                  <QueryBoundary
                    isLoading={breakdown.isLoading || entries.isLoading}
                    error={breakdown.error ?? entries.error}
                  >
                    <section className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                      <StatCard label="Balance" value={breakdown.data?.balance ?? "—"} />
                      <StatCard
                        label="Credits"
                        value={breakdown.data ? `${breakdown.data.creditTotal} (${breakdown.data.creditCount})` : "—"}
                        tone="success"
                      />
                      <StatCard
                        label="Debits"
                        value={breakdown.data ? `${breakdown.data.debitTotal} (${breakdown.data.debitCount})` : "—"}
                      />
                      <StatCard label="Last entry" value={formatDateTime(breakdown.data?.lastEntryAt)} />
                    </section>

                    {entries.data && entries.data.entries.length > 0 ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>When</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Ref</TableHead>
                              <TableHead>Idempotency key</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {entries.data.entries.map((row) => (
                              <TableRow key={row.id} data-testid={`ledger-entry-${row.id}`}>
                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                  {formatDateTime(row.createdAt)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={row.type === "credit" ? "success" : "secondary"}>{row.type}</Badge>
                                </TableCell>
                                <TableCell className="font-mono">{row.amount}</TableCell>
                                <TableCell className="font-mono text-xs" title={row.refId}>
                                  {shorten(row.refId)}
                                </TableCell>
                                <TableCell className="font-mono text-xs" title={row.idempotencyKey}>
                                  {shorten(row.idempotencyKey, 18, 8)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {entries.data.nextCursor ? (
                          <Button
                            className="mt-3"
                            variant="outline"
                            data-testid="ledger-next-page"
                            onClick={() => setCursor(entries.data?.nextCursor ?? undefined)}
                          >
                            Next page
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No ledger entries for this account.</p>
                    )}
                  </QueryBoundary>
                ) : (
                  <p className="text-sm text-muted-foreground">Enter an app id and user id to load a statement.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reconciliation</CardTitle>
                <CardDescription>
                  Cross-checks settled tips against credits, completed withdrawals against debits, negative balances,
                  and duplicate references over the last 30 days.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="mb-4 flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setReconcileArgs(reconcileAppId.trim() ? { appId: reconcileAppId.trim() } : {});
                  }}
                >
                  <div className="w-44">
                    <Label htmlFor="reconcile-app" className="mb-1 block text-xs text-muted-foreground">
                      App (optional)
                    </Label>
                    <Input
                      id="reconcile-app"
                      value={reconcileAppId}
                      onChange={(event) => setReconcileAppId(event.target.value)}
                    />
                  </div>
                  <Button type="submit" data-testid="ledger-run-reconcile">
                    Run reconciliation
                  </Button>
                </form>

                {reconcileArgs !== null ? (
                  <QueryBoundary isLoading={reconcile.isLoading} error={reconcile.error}>
                    {reconcile.data ? (
                      <div className="space-y-4" data-testid="ledger-reconcile-report">
                        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
                          <StatCard
                            label="Anomalies"
                            value={anomalyCount}
                            tone={anomalyCount > 0 ? "danger" : "success"}
                          />
                          <StatCard label="Tips checked" value={reconcile.data.checked.tipIntents} />
                          <StatCard label="Withdrawals checked" value={reconcile.data.checked.withdrawals} />
                          <StatCard label="Entries checked" value={reconcile.data.checked.entries} />
                        </section>
                        <p className="text-xs text-muted-foreground">
                          Window {formatDateTime(reconcile.data.window.from)} →{" "}
                          {formatDateTime(reconcile.data.window.to)}
                          {reconcile.data.truncated ? " — row cap reached, narrow the window for a complete pass." : ""}
                        </p>
                        {anomalyCount > 0 ? (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Kind</TableHead>
                                <TableHead>Detail</TableHead>
                                <TableHead>Example entries</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {reconcile.data.anomalies.map((anomaly, index) => (
                                <TableRow key={`${anomaly.kind}-${anomaly.refId ?? index}`}>
                                  <TableCell>
                                    <Badge variant="destructive">{anomaly.kind}</Badge>
                                  </TableCell>
                                  <TableCell className="text-xs">{anomaly.detail}</TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {(anomaly.entryIds ?? [])
                                      .slice(0, 3)
                                      .map((id) => shorten(id))
                                      .join(", ") || "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <p className="text-sm text-muted-foreground">No anomalies detected in the window.</p>
                        )}
                      </div>
                    ) : null}
                  </QueryBoundary>
                ) : (
                  <p className="text-sm text-muted-foreground">Run a reconciliation pass to see the report.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </RoleGate>
      </QueryBoundary>
    </div>
  );
}
