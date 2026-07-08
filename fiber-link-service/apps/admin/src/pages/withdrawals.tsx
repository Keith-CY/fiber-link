import { useRouter } from "next/router";
import Link from "next/link";
import type { WithdrawalState } from "@fiber-link/db";
import { trpc } from "../utils/trpc";
import { PageHeader, QueryBoundary } from "../components/page";
import { Card, CardContent } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select } from "../components/ui/select";
import { Label } from "../components/ui/label";
import { WithdrawalStateBadge } from "../components/withdrawal-state-badge";
import { formatDateTime, shorten } from "../lib/format";

const WITHDRAWAL_STATES: WithdrawalState[] = [
  "LIQUIDITY_PENDING",
  "PENDING",
  "PROCESSING",
  "BROADCASTED",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
];

function queryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export default function WithdrawalsPage() {
  const router = useRouter();
  const session = trpc.session.me.useQuery();
  const role = session.data?.role ?? null;
  const showUserId = role === "SUPER_ADMIN";

  const rawState = queryValue(router.query.state);
  const stateFilter = WITHDRAWAL_STATES.includes(rawState as WithdrawalState)
    ? (rawState as WithdrawalState)
    : undefined;
  const appFilter = queryValue(router.query.app);

  const filters = {
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(appFilter ? { appId: appFilter } : {}),
  };

  // router.query is empty until hydration completes; waiting for isReady avoids
  // an initial unfiltered fetch that is immediately refetched with URL filters.
  const withdrawals = trpc.withdrawals.list.useQuery(filters, { enabled: Boolean(role) && router.isReady });

  function setFilter(key: string, value: string) {
    const next = { ...router.query };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  }

  return (
    <div>
      <PageHeader title="Withdrawals" description="Payout queue with state-machine filters. Filtered views are shareable via the URL." />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-48">
          <Label htmlFor="state-filter" className="mb-1 block text-xs text-muted-foreground">
            State
          </Label>
          <Select
            id="state-filter"
            data-testid="withdrawal-state-filter"
            value={stateFilter ?? ""}
            onChange={(event) => setFilter("state", event.target.value)}
          >
            <option value="">All states</option>
            {WITHDRAWAL_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
        </div>
        {appFilter ? (
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => setFilter("app", "")}
          >
            Clear app filter: {appFilter}
          </button>
        ) : null}
      </div>

      <QueryBoundary
        isLoading={session.isLoading || withdrawals.isLoading}
        error={session.error ?? withdrawals.error}
        isEmpty={withdrawals.data?.length === 0}
        emptyMessage="No withdrawals match the current filters."
      >
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>App</TableHead>
                  {showUserId ? <TableHead>User</TableHead> : null}
                  <TableHead>Asset</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(withdrawals.data ?? []).map((row) => (
                  <TableRow key={row.id} data-testid={`withdrawal-row-${row.id}`}>
                    <TableCell className="font-mono text-xs" title={row.id}>
                      {shorten(row.id)}
                    </TableCell>
                    <TableCell>
                      <Link className="text-primary hover:underline" href={`/apps/${row.appId}`}>
                        {row.appId}
                      </Link>
                    </TableCell>
                    {showUserId ? <TableCell className="font-mono text-xs">{shorten(row.userId)}</TableCell> : null}
                    <TableCell>{row.asset}</TableCell>
                    <TableCell className="font-mono">{row.amount}</TableCell>
                    <TableCell>
                      <WithdrawalStateBadge state={row.state} />
                    </TableCell>
                    <TableCell>{row.retryCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs" title={row.txHash ?? undefined}>
                      {shorten(row.txHash)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
