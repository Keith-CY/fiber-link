import type { WithdrawalState } from "@fiber-link/db";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { PageHeader, QueryBoundary } from "../components/page";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { WithdrawalStateBadge } from "../components/withdrawal-state-badge";
import { formatDateTime, shorten } from "../lib/format";
import { trpc } from "../utils/trpc";

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
  const idFilter = queryValue(router.query.id);
  const userFilter = queryValue(router.query.user);
  const txFilter = queryValue(router.query.tx);
  const [searchDraft, setSearchDraft] = useState({ id: "", user: "", tx: "" });
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const filters = {
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(appFilter ? { appId: appFilter } : {}),
    ...(idFilter ? { id: idFilter } : {}),
    ...(userFilter ? { userId: userFilter } : {}),
    ...(txFilter ? { txHash: txFilter } : {}),
    ...(cursor ? { cursor } : {}),
  };

  // router.query is empty until hydration completes; waiting for isReady avoids
  // an initial unfiltered fetch that is immediately refetched with URL filters.
  const withdrawals = trpc.withdrawals.list.useQuery(filters, { enabled: Boolean(role) && router.isReady });
  const rows = withdrawals.data?.items ?? [];

  function setFilter(key: string, value: string) {
    setCursor(undefined);
    const next = { ...router.query };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setCursor(undefined);
    const next = { ...router.query };
    for (const [key, value] of [
      ["id", searchDraft.id.trim()],
      ["user", searchDraft.user.trim()],
      ["tx", searchDraft.tx.trim()],
    ] as const) {
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
    }
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  }

  return (
    <div>
      <PageHeader
        title="Withdrawals"
        description="Payout queue with state-machine filters. Filtered views are shareable via the URL."
      />

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

        <form className="flex flex-wrap items-end gap-2" onSubmit={applySearch}>
          <div className="w-48">
            <Label htmlFor="search-id" className="mb-1 block text-xs text-muted-foreground">
              Withdrawal ID (exact)
            </Label>
            <Input
              id="search-id"
              data-testid="withdrawal-search-id"
              value={searchDraft.id}
              onChange={(event) => setSearchDraft((draft) => ({ ...draft, id: event.target.value }))}
            />
          </div>
          <div className="w-40">
            <Label htmlFor="search-user" className="mb-1 block text-xs text-muted-foreground">
              User (exact)
            </Label>
            <Input
              id="search-user"
              data-testid="withdrawal-search-user"
              value={searchDraft.user}
              onChange={(event) => setSearchDraft((draft) => ({ ...draft, user: event.target.value }))}
            />
          </div>
          <div className="w-48">
            <Label htmlFor="search-tx" className="mb-1 block text-xs text-muted-foreground">
              Tx hash (exact)
            </Label>
            <Input
              id="search-tx"
              data-testid="withdrawal-search-tx"
              value={searchDraft.tx}
              onChange={(event) => setSearchDraft((draft) => ({ ...draft, tx: event.target.value }))}
            />
          </div>
          <Button type="submit" variant="outline" data-testid="withdrawal-search-submit">
            Search
          </Button>
          {idFilter || userFilter || txFilter ? (
            <button
              type="button"
              className="text-sm text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setSearchDraft({ id: "", user: "", tx: "" });
                setCursor(undefined);
                const next = { ...router.query };
                for (const key of ["id", "user", "tx"]) {
                  delete next[key];
                }
                router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
              }}
            >
              Clear search
            </button>
          ) : null}
        </form>
      </div>

      <QueryBoundary
        isLoading={session.isLoading || withdrawals.isLoading}
        error={session.error ?? withdrawals.error}
        isEmpty={rows.length === 0}
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
                {rows.map((row) => (
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
        {withdrawals.data?.nextCursor ? (
          <Button
            className="mt-3"
            variant="outline"
            data-testid="withdrawal-next-page"
            onClick={() => setCursor(withdrawals.data?.nextCursor ?? undefined)}
          >
            Next page
          </Button>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
