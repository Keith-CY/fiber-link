import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import type { AppProps } from "next/app";
import { useState } from "react";
import superjson from "superjson";
import { AppShell } from "../components/layout/app-shell";
import { Toaster } from "../components/ui/sonner";
import { trpc } from "../utils/trpc";
import "../styles/globals.css";

export default function AdminApp({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [trpcClient] = useState(() =>
    trpc.createClient({
      // Non-batching link: the monitoring summary shells out to an ops script
      // and can be slow; batching would head-of-line block the fast queries
      // (apps / withdrawals / session) behind it.
      links: [httpLink({ url: "/api/trpc", transformer: superjson })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppShell>
          <Component {...pageProps} />
        </AppShell>
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
