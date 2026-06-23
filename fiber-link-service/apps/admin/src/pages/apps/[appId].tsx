import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { toast } from "sonner";
import type { Asset } from "@fiber-link/db";
import { trpc } from "../../utils/trpc";
import { PageHeader, QueryBoundary } from "../../components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { formatDateTime } from "../../lib/format";

const ASSETS: Asset[] = ["CKB", "USDI"];

type PolicyForm = {
  allowedAssets: Asset[];
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: string;
};

const EMPTY_FORM: PolicyForm = {
  allowedAssets: [],
  maxPerRequest: "",
  perUserDailyMax: "",
  perAppDailyMax: "",
  cooldownSeconds: "0",
};

export default function AppDetailPage() {
  const router = useRouter();
  const appId = typeof router.query.appId === "string" ? router.query.appId : "";

  const session = trpc.session.me.useQuery();
  const role = session.data?.role ?? null;
  const utils = trpc.useUtils();

  const policies = trpc.withdrawalPolicy.list.useQuery(undefined, { enabled: Boolean(role && appId) });
  const policy = policies.data?.find((p) => p.appId === appId);

  const [form, setForm] = useState<PolicyForm>(EMPTY_FORM);

  useEffect(() => {
    if (policy) {
      setForm({
        allowedAssets: policy.allowedAssets,
        maxPerRequest: policy.maxPerRequest,
        perUserDailyMax: policy.perUserDailyMax,
        perAppDailyMax: policy.perAppDailyMax,
        cooldownSeconds: String(policy.cooldownSeconds),
      });
    } else {
      // Reset when switching to an app with no configured policy so values
      // from a previously viewed app do not leak across navigations.
      setForm(EMPTY_FORM);
    }
  }, [policy, appId]);

  const upsert = trpc.withdrawalPolicy.upsert.useMutation({
    onSuccess: async () => {
      toast.success(`Policy saved for ${appId}`);
      await utils.withdrawalPolicy.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  function toggleAsset(asset: Asset, checked: boolean) {
    setForm((prev) => ({
      ...prev,
      allowedAssets: checked
        ? Array.from(new Set([...prev.allowedAssets, asset]))
        : prev.allowedAssets.filter((value) => value !== asset),
    }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    upsert.mutate({
      appId,
      allowedAssets: form.allowedAssets,
      maxPerRequest: form.maxPerRequest,
      perUserDailyMax: form.perUserDailyMax,
      perAppDailyMax: form.perAppDailyMax,
      cooldownSeconds: Number(form.cooldownSeconds),
    });
  }

  return (
    <div>
      <PageHeader
        title={appId || "App"}
        description="App detail: withdrawal policy now; HMAC secret, webhook channels, admins, and funds land in later milestones."
        actions={
          <Link className="text-sm text-primary hover:underline" href="/apps">
            ← All apps
          </Link>
        }
      />

      <QueryBoundary isLoading={session.isLoading || policies.isLoading} error={session.error ?? policies.error}>
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Withdrawal policy</CardTitle>
            <CardDescription>
              {policy
                ? `Updated by ${policy.updatedBy ?? "—"} at ${formatDateTime(policy.updatedAt)}`
                : "No policy configured yet for this app."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit} data-testid={`policy-form-${appId}`}>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Allowed assets</legend>
                <div className="flex gap-4">
                  {ASSETS.map((asset) => (
                    <label key={asset} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="allowedAssets"
                        value={asset}
                        checked={form.allowedAssets.includes(asset)}
                        onChange={(event) => toggleAsset(asset, event.target.checked)}
                      />
                      {asset}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Max per request" htmlFor="maxPerRequest">
                  <Input
                    id="maxPerRequest"
                    name="maxPerRequest"
                    value={form.maxPerRequest}
                    onChange={(event) => setForm((prev) => ({ ...prev, maxPerRequest: event.target.value }))}
                  />
                </Field>
                <Field label="Per-user daily max" htmlFor="perUserDailyMax">
                  <Input
                    id="perUserDailyMax"
                    name="perUserDailyMax"
                    value={form.perUserDailyMax}
                    onChange={(event) => setForm((prev) => ({ ...prev, perUserDailyMax: event.target.value }))}
                  />
                </Field>
                <Field label="Per-app daily max" htmlFor="perAppDailyMax">
                  <Input
                    id="perAppDailyMax"
                    name="perAppDailyMax"
                    value={form.perAppDailyMax}
                    onChange={(event) => setForm((prev) => ({ ...prev, perAppDailyMax: event.target.value }))}
                  />
                </Field>
                <Field label="Cooldown seconds" htmlFor="cooldownSeconds">
                  <Input
                    id="cooldownSeconds"
                    name="cooldownSeconds"
                    type="number"
                    min={0}
                    step={1}
                    value={form.cooldownSeconds}
                    onChange={(event) => setForm((prev) => ({ ...prev, cooldownSeconds: event.target.value }))}
                  />
                </Field>
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={upsert.isPending}>
                  {upsert.isPending ? "Saving…" : "Save policy"}
                </Button>
                {upsert.isSuccess ? (
                  <span className="text-sm text-success" data-testid="policy-saved">
                    Policy saved for {appId}
                  </span>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
