import { PageHeader, QueryBoundary, RoleGate, StatCard } from "../../components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { trpc } from "../../utils/trpc";

export default function SettlementsPage() {
  const session = trpc.session.me.useQuery();
  const isSuperAdmin = session.data?.role === "SUPER_ADMIN";
  const monitoring = trpc.ops.monitoring.useQuery(undefined, { enabled: isSuperAdmin });

  return (
    <div>
      <PageHeader title="Settlements" description="Settlement pipeline health and backlog." />
      <QueryBoundary isLoading={session.isLoading} error={session.error}>
        <RoleGate allowed={isSuperAdmin}>
          <QueryBoundary isLoading={monitoring.isLoading} error={monitoring.error}>
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
            <Card>
              <CardHeader>
                <CardTitle>Settlement intents</CardTitle>
                <CardDescription>
                  The detailed intent list and the per-intent <code>tip_intent_events</code> timeline are added in
                  milestone 2 (read-only operational surfaces).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Backlog counts above are derived from the monitoring summary.
                </p>
              </CardContent>
            </Card>
          </QueryBoundary>
        </RoleGate>
      </QueryBoundary>
    </div>
  );
}
