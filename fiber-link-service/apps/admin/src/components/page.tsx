import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { cn } from "../lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-semibold", toneClass)}>{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Consistent loading / error / empty handling for a tRPC query result so each
 * page does not re-implement the three states.
 */
export function QueryBoundary({
  isLoading,
  error,
  isEmpty,
  emptyMessage = "Nothing to show yet.",
  children,
}: {
  isLoading: boolean;
  error?: { message: string } | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2" role="status" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive" role="alert">
            {error.message}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (isEmpty) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}

export function RoleGate({
  allowed,
  children,
}: {
  allowed: boolean;
  children: React.ReactNode;
}) {
  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            This surface is restricted to SUPER_ADMIN operators.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
