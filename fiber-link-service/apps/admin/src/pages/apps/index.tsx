import Link from "next/link";
import { trpc } from "../../utils/trpc";
import { PageHeader, QueryBoundary } from "../../components/page";
import { Card, CardContent } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { formatDateTime } from "../../lib/format";

export default function AppsPage() {
  const session = trpc.session.me.useQuery();
  const role = session.data?.role ?? null;
  const apps = trpc.apps.list.useQuery(undefined, { enabled: Boolean(role) });

  return (
    <div>
      <PageHeader
        title="Apps"
        description="App inventory in the current operator scope. Open an app for its policy, channels, and funds."
      />
      <QueryBoundary
        isLoading={session.isLoading || apps.isLoading}
        error={session.error ?? apps.error}
        isEmpty={apps.data?.length === 0}
        emptyMessage="No apps are visible to this operator."
      >
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App ID</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(apps.data ?? []).map((app) => (
                  <TableRow key={app.appId} data-testid={`app-row-${app.appId}`}>
                    <TableCell className="font-medium">{app.appId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(app.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link className="text-sm text-primary hover:underline" href={`/apps/${app.appId}`}>
                        Open
                      </Link>
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
