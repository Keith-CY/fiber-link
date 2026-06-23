import { useRouter } from "next/router";
import Link from "next/link";
import { trpc } from "../../utils/trpc";
import { PageHeader, QueryBoundary, RoleGate } from "../../components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

export default function SettlementDetailPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : "";
  const session = trpc.session.me.useQuery();
  const isSuperAdmin = session.data?.role === "SUPER_ADMIN";

  return (
    <div>
      <PageHeader
        title={`Settlement ${id}`}
        description="Tip-intent timeline and recovery hint."
        actions={
          <Link className="text-sm text-primary hover:underline" href="/settlements">
            ← Settlements
          </Link>
        }
      />
      <QueryBoundary isLoading={session.isLoading} error={session.error}>
        <RoleGate allowed={isSuperAdmin}>
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle timeline</CardTitle>
              <CardDescription>
                Rendered from <code>tip_intent_events</code> in milestone 2.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No events to display yet.</p>
            </CardContent>
          </Card>
        </RoleGate>
      </QueryBoundary>
    </div>
  );
}
