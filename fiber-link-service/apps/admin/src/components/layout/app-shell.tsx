import { Activity, Banknote, Boxes, LayoutDashboard, Wallet, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { trpc } from "../../utils/trpc";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  superAdminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/settlements", label: "Settlements", icon: Banknote, superAdminOnly: true },
  { href: "/withdrawals", label: "Withdrawals", icon: Wallet },
  { href: "/apps", label: "Apps", icon: Boxes },
  { href: "/ops", label: "Ops", icon: Wrench, superAdminOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = trpc.session.me.useQuery(undefined, { staleTime: 60_000 });
  const role = session.data?.role ?? null;
  const isSuperAdmin = role === "SUPER_ADMIN";
  const visibleItems = NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin);

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold tracking-tight">Fiber Link Operations</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {session.isLoading ? (
              <Skeleton className="h-5 w-28" />
            ) : role ? (
              <>
                <Badge variant={isSuperAdmin ? "default" : "secondary"}>{role}</Badge>
                {session.data?.adminUserId ? (
                  <span className="text-muted-foreground">{session.data.adminUserId}</span>
                ) : null}
              </>
            ) : (
              <Badge variant="destructive">No admin role</Badge>
            )}
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4 pb-2" aria-label="Primary">
          {visibleItems.map((item) => {
            const active = isActive(router.pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-${item.label.toLowerCase()}`}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
