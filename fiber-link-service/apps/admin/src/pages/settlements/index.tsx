import type { InvoiceState } from "@fiber-link/db";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { PageHeader, QueryBoundary, RoleGate, StatCard } from "../../components/page";
import { SettlementStateBadge } from "../../components/settlement-state-badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { formatDateTime, shorten } from "../../lib/format";
import { trpc } from "../../utils/trpc";

const INVOICE_STATES: InvoiceState[] = ["UNPAID", "SETTLED", "FAILED"];

function queryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export default function SettlementsPage() {
  const router = useRouter();
  const session = trpc.session.me.useQuery();
  const isSuperAdmin = session.data?.role === "SUPER_ADMIN";
  const monitoring = trpc.ops.monitoring.useQuery(undefined, { enabled: isSuperAdmin });

  const rawState = queryValue(router.query.state);
  const stateFilter = INVOICE_STATES.includes(rawState as InvoiceState) ? (rawState as InvoiceState) : undefined;
  const invoiceFilter = queryValue(router.query.invoice);
  const userFilter = queryValue(router.query.user);
  const [searchDraft, setSearchDraft] = useState({ invoice: "", user: "" });
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const settlements = trpc.settlements.list.useQuery(
    {
      ...(stateFilter ? { state: stateFilter } : {}),
      ...(invoiceFilter ? { invoice: invoiceFilter } : {}),
      ...(userFilter ? { userId: userFilter } : {}),
      ...(cursor ? { cursor } : {}),
    },
    { enabled: isSuperAdmin && router.isReady },
  );
  const rows = settlements.data?.items ?? [];

  function replaceQuery(mutate: (next: Record<string, string | string[] | undefined>) => void) {
    setCursor(undefined);
    const next = { ...router.query };
    mutate(next);
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  }

  function setStateFilter(value: string) {
    replaceQuery((next) => {
      if (value) {
        next.state = value;
      } else {
        delete next.state;
      }
    });
  }

  return (
    <div>
      <PageHeader
        title="Settlements"
        description="Settlement pipeline health, backlog, and per-invoice investigation timelines."
      />
      <QueryBoundary isLoading={session.isLoading} error={session.error}>
        <RoleGate allowed={isSuperAdmin}>
          <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatCard
              label="Unpaid backlog"
              value={monitoring.data?.unpaidBacklog ?? "—"}
              tone={(monitoring.data?.unpaidBacklog ?? 0) > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Retry pending"
              value={monitoring.data?.retryPendingCount ?? "—"}
              tone={(monitoring.data?.retryPendingCount ?? 0) > 0 ? "warning" : "default"}
            />
            <StatCard label="Pipeline status" value={monitoring.data?.status ?? "—"} />
          </section>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Label htmlFor="settlement-state-filter" className="mb-1 block text-xs text-muted-foreground">
                State
              </Label>
              <Select
                id="settlement-state-filter"
                data-testid="settlement-state-filter"
                value={stateFilter ?? ""}
                onChange={(event) => setStateFilter(event.target.value)}
              >
                <option value="">All states</option>
                {INVOICE_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
            </div>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                replaceQuery((next) => {
                  const invoice = searchDraft.invoice.trim();
                  const user = searchDraft.user.trim();
                  if (invoice) {
                    next.invoice = invoice;
                  } else {
                    delete next.invoice;
                  }
                  if (user) {
                    next.user = user;
                  } else {
                    delete next.user;
                  }
                });
              }}
            >
              <div className="w-64">
                <Label htmlFor="settlement-search-invoice" className="mb-1 block text-xs text-muted-foreground">
                  Invoice (exact)
                </Label>
                <Input
                  id="settlement-search-invoice"
                  data-testid="settlement-search-invoice"
                  value={searchDraft.invoice}
                  onChange={(event) => setSearchDraft((draft) => ({ ...draft, invoice: event.target.value }))}
                />
              </div>
              <div className="w-40">
                <Label htmlFor="settlement-search-user" className="mb-1 block text-xs text-muted-foreground">
                  User (exact)
                </Label>
                <Input
                  id="settlement-search-user"
                  data-testid="settlement-search-user"
                  value={searchDraft.user}
                  onChange={(event) => setSearchDraft((draft) => ({ ...draft, user: event.target.value }))}
                />
              </div>
              <Button type="submit" variant="outline" data-testid="settlement-search-submit">
                Search
              </Button>
              {invoiceFilter || userFilter ? (
                <button
                  type="button"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  onClick={() => {
                    setSearchDraft({ invoice: "", user: "" });
                    replaceQuery((next) => {
                      delete next.invoice;
                      delete next.user;
                    });
                  }}
                >
                  Clear search
                </button>
              ) : null}
            </form>
          </div>

          <QueryBoundary
            isLoading={settlements.isLoading}
            error={settlements.error}
            isEmpty={rows.length === 0}
            emptyMessage="No settlement intents match the current filters."
          >
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>App</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Failure reason</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id} data-testid={`settlement-row-${row.id}`}>
                        <TableCell className="font-mono text-xs" title={row.invoice}>
                          <Link
                            className="text-primary hover:underline"
                            href={`/settlements/${encodeURIComponent(row.invoice)}`}
                          >
                            {shorten(row.invoice, 12, 8)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link className="text-primary hover:underline" href={`/apps/${row.appId}`}>
                            {row.appId}
                          </Link>
                        </TableCell>
                        <TableCell>{row.asset}</TableCell>
                        <TableCell className="font-mono">{row.amount}</TableCell>
                        <TableCell>
                          <SettlementStateBadge state={row.invoiceState} />
                        </TableCell>
                        <TableCell>{row.settlementRetryCount}</TableCell>
                        <TableCell className="text-xs text-destructive">{row.settlementFailureReason ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            {settlements.data?.nextCursor ? (
              <Button
                className="mt-3"
                variant="outline"
                data-testid="settlement-next-page"
                onClick={() => setCursor(settlements.data?.nextCursor ?? undefined)}
              >
                Next page
              </Button>
            ) : null}
          </QueryBoundary>
        </RoleGate>
      </QueryBoundary>
    </div>
  );
}
