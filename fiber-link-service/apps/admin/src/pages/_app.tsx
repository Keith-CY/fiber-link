import type { AppProps } from "next/app";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "../utils/trpc";
import { AppShell } from "../components/layout/app-shell";
import { Toaster } from "../components/ui/sonner";
import "../styles/globals.css";

export default function AdminApp({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
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
