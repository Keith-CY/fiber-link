import { Toaster as SonnerToaster } from "sonner";

/**
 * Inline toast surface that replaces the legacy 303-redirect + query-string
 * flash pattern. Mounted once in `_app.tsx`.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "rounded-md border bg-card text-card-foreground shadow-md",
          description: "text-muted-foreground",
          error: "border-destructive",
        },
      }}
    />
  );
}
