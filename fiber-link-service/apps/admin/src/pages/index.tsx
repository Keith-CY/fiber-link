import Link from "next/link";
import { trpc } from "../utils/trpc";
import { PageHeader, QueryBoundary, StatCard } from "../components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { buildOpsTriageCards, type DashboardOpsTriageCard } from "../dashboard/dashboard-page-model";

const TRIAGE_ROUTE: Record<string, string> = {
  "settlement-backlog": "/settlements",
  "withdrawal-backlog": "/withdrawals",
  "liquidity-pending": "/withdrawals?state=LIQUIDITY_PENDING",
  "failed-withdrawals": "/withdrawals?state=FAILED",
  "ops-alerts": "/ops",
};

const TONE: Record<DashboardOpsTriageCard["severity"], "default" | "warning" | "danger"> = {
  ok: "default",
  watch: "warning",
  alert: "danger",
};

export default function OverviewPage() {
  const session = trpc.session.me.useQuery();
  const role = session.data?.role ?? null;
  const isSuperAdmin = role === "SUPER_ADMIN";

  const apps = trpc.apps.list.useQuery(undefined, { enabled: Boolean(role) });
  // Server-side GROUP BY over the whole scope — the capped list query would
  // undercount and would ship every row just to derive these numbers.
  const stateSummary = trpc.withdrawals.stateSummary.useQuery(undefined, { enabled: Boolean(role) });
  const monitoring = trpc.ops.monitoring.useQuery(undefined, { enabled: isSuperAdmin });

  const summaries = stateSummary.data ?? [];
  const openWithdrawals = stateSummary.data
    ? summaries.filter((s) => s.state !== "COMPLETED" && s.state !== "FAILED").reduce((sum, s) => sum + s.count, 0)
    : null;
  const triageCards =
    isSuperAdmin && stateSummary.data
      ? buildOpsTriageCards({
          statusSummaries: summaries,
          operations: monitoring.data
            ? {
                monitoring: { status: "ready", summary: monitoring.data },
                rateLimit: { status: "error", message: "n/a" },
                backups: { status: "error", message: "n/a" },
              }
            : undefined,
        })
      : [];

  return (
    <div>
      <PageHeader
        title="Operations overview"
        description={session.data?.visibility?.scopeDescription ?? "Fiber Link service operations console"}
        actions={role ? <Badge variant={isSuperAdmin ? "default" : "secondary"}>{role}</Badge> : null}
      />

      <QueryBoundary
        isLoading={session.isLoading}
        error={session.error}
        isEmpty={!role}
        emptyMessage="No admin role was supplied for this request."
      >
        <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Visible apps" value={apps.data?.length ?? "—"} />
          <StatCard label="Open withdrawals" value={openWithdrawals ?? "—"} />
          {isSuperAdmin ? (
            <>
              <StatCard
                label="Unpaid settlements"
                value={monitoring.data?.unpaidBacklog ?? "—"}
                tone={(monitoring.data?.unpaidBacklog ?? 0) > 0 ? "warning" : "default"}
              />
              <StatCard
                label="Ops alerts"
                value={monitoring.data?.alertCount ?? "—"}
                tone={(monitoring.data?.alertCount ?? 0) > 0 ? "danger" : "success"}
                hint={monitoring.data ? `status: ${monitoring.data.status}` : undefined}
              />
            </>
          ) : null}
        </section>

        {triageCards.length > 0 ? (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Triage</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {triageCards.map((card) => (
                <Link key={card.id} href={TRIAGE_ROUTE[card.id] ?? "/"} data-testid={`triage-${card.id}`}>
                  <Card className="h-full transition-colors hover:border-primary">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center justify-between text-sm">
                        {card.label}
                        <StatBadge tone={TONE[card.severity]} />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">{card.value}</div>
                      <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <Card>
            <CardHeader>
              <CardTitle>Withdrawal pipeline</CardTitle>
              <CardDescription>Current withdrawal counts for the apps visible to this operator.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {summaries.map((summary) => (
                  <div key={summary.state} className="rounded-lg border px-4 py-2">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{summary.state}</div>
                    <div className="text-lg font-semibold">{summary.count}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </QueryBoundary>
    </div>
  );
}

function StatBadge({ tone }: { tone: "default" | "warning" | "danger" }) {
  const variant = tone === "danger" ? "destructive" : tone === "warning" ? "warning" : "secondary";
  const label = tone === "danger" ? "alert" : tone === "warning" ? "watch" : "ok";
  return <Badge variant={variant}>{label}</Badge>;
}
