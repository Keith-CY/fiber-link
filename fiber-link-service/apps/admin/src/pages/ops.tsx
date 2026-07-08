import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { trpc } from "../utils/trpc";
import { PageHeader, QueryBoundary, RoleGate } from "../components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { formatDateTime } from "../lib/format";

export default function OpsPage() {
  const session = trpc.session.me.useQuery();
  const isSuperAdmin = session.data?.role === "SUPER_ADMIN";

  return (
    <div>
      <PageHeader title="Ops" description="Runtime rate limiting, backups, and the raw monitoring summary." />
      <QueryBoundary isLoading={session.isLoading} error={session.error}>
        <RoleGate allowed={isSuperAdmin}>
          <div className="space-y-6">
            {/* Cards mount only when RoleGate admits SUPER_ADMIN, so their queries can run unconditionally. */}
            <RateLimitCard />
            <BackupsCard />
            <MonitoringCard />
          </div>
        </RoleGate>
      </QueryBoundary>
    </div>
  );
}

function RateLimitCard() {
  const config = trpc.ops.rateLimitConfig.useQuery();
  const [form, setForm] = useState({ enabled: true, windowMs: "60000", maxRequests: "300" });

  useEffect(() => {
    if (config.data) {
      setForm({ enabled: config.data.enabled, windowMs: config.data.windowMs, maxRequests: config.data.maxRequests });
    }
  }, [config.data]);

  const changeSet = trpc.ops.createRateLimitChangeSet.useMutation({
    onError: (error) => toast.error(error.message),
    onSuccess: () => toast.success("Rate-limit change set generated"),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    changeSet.mutate(form);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global rate limiting</CardTitle>
        <CardDescription>
          Generate a change set for runtime rate-limit controls without hot-editing deployment env files.
          {config.data ? ` Current source: ${config.data.sourceLabel}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-4" onSubmit={onSubmit}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
            />
            Enabled
          </label>
          <div className="w-40 space-y-1">
            <Label htmlFor="windowMs">Window (ms)</Label>
            <Input
              id="windowMs"
              value={form.windowMs}
              onChange={(event) => setForm((prev) => ({ ...prev, windowMs: event.target.value }))}
            />
          </div>
          <div className="w-40 space-y-1">
            <Label htmlFor="maxRequests">Max requests</Label>
            <Input
              id="maxRequests"
              value={form.maxRequests}
              onChange={(event) => setForm((prev) => ({ ...prev, maxRequests: event.target.value }))}
            />
          </div>
          <Button type="submit" disabled={changeSet.isPending}>
            Generate change set
          </Button>
        </form>

        {changeSet.data ? (
          <div className="mt-4 space-y-3" data-testid="rate-limit-change-set">
            <p className="text-sm text-muted-foreground">
              Changed keys:{" "}
              {changeSet.data.changedKeys.length > 0 ? changeSet.data.changedKeys.join(", ") : "No effective changes"}
            </p>
            <CodeBlock label="Change set" content={changeSet.data.envSnippet} />
            <CodeBlock label="Rollback snapshot" content={changeSet.data.rollbackSnippet} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BackupsCard() {
  const utils = trpc.useUtils();
  const bundles = trpc.ops.listBackups.useQuery();
  const [restorePlan, setRestorePlan] = useState<{ backupId: string; command: string; warnings: string[] } | null>(null);

  const capture = trpc.ops.captureBackup.useMutation({
    onSuccess: async (result) => {
      toast.success(`Backup captured: ${result.backupId}`);
      await utils.ops.listBackups.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const plan = trpc.ops.restorePlan.useMutation({
    onSuccess: (result) => setRestorePlan(result),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backups</CardTitle>
        <CardDescription>Capture backup bundles and prepare a (non-destructive) restore plan.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" onClick={() => capture.mutate()} disabled={capture.isPending} data-testid="capture-backup">
          {capture.isPending ? "Capturing…" : "Capture backup"}
        </Button>
        {capture.data ? (
          <p className="text-sm text-success" data-testid="backup-captured">
            Backup captured: {capture.data.backupId}
          </p>
        ) : null}

        <QueryBoundary
          isLoading={bundles.isLoading}
          error={bundles.error}
          isEmpty={bundles.data?.length === 0}
          emptyMessage="No backup bundles found."
        >
          <ul className="space-y-2">
            {(bundles.data ?? []).map((bundle) => (
              <li key={bundle.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{bundle.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(bundle.generatedAt)} · retention {bundle.retentionDays}d
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={bundle.overallStatus === "PASS" ? "success" : "warning"}>{bundle.overallStatus}</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => plan.mutate({ backupId: bundle.id })}
                    disabled={plan.isPending}
                  >
                    Restore plan
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </QueryBoundary>

        {restorePlan ? (
          <div className="space-y-2" data-testid="restore-plan">
            <CodeBlock label={`Restore plan: ${restorePlan.backupId}`} content={restorePlan.command} />
            {restorePlan.warnings.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-warning">
                {restorePlan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MonitoringCard() {
  const monitoring = trpc.ops.monitoring.useQuery();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitoring summary</CardTitle>
        <CardDescription>Database-derived health and settlement/withdrawal posture.</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryBoundary isLoading={monitoring.isLoading} error={monitoring.error}>
          {monitoring.data ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="Status" value={monitoring.data.status} />
                <Metric label="Readiness" value={monitoring.data.readinessStatus} />
                <Metric label="Unpaid backlog" value={monitoring.data.unpaidBacklog} />
                <Metric label="Retry pending" value={monitoring.data.retryPendingCount} />
                <Metric label="Parity issues" value={monitoring.data.withdrawalParityIssueCount} />
                <Metric label="Alerts" value={monitoring.data.alertCount} />
                <Metric label="Generated" value={formatDateTime(monitoring.data.generatedAt)} />
              </div>
              {monitoring.data.rawJson ? <CodeBlock label="Raw ops summary" content={monitoring.data.rawJson} /> : null}
            </>
          ) : null}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function CodeBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs">{content}</pre>
    </div>
  );
}
