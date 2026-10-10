import { useQuery } from "@tanstack/react-query";
import { convex } from "@/lib/backend";
import { cn } from "@/lib/utils";

type Readiness = {
  status: "ok" | "unavailable";
};

async function getReadiness(): Promise<Readiness> {
  // Convex has no /readyz; its client knows whether it is connected.
  if (convex) {
    if (!convex.connectionState().isWebSocketConnected) {
      throw new Error("Convex is unreachable");
    }
    return { status: "ok" };
  }
  const response = await fetch("/readyz");
  if (!response.ok) {
    throw new Error("API dependencies are unavailable");
  }
  return response.json() as Promise<Readiness>;
}

export function ApiStatus() {
  const readiness = useQuery({
    queryKey: ["api-readiness"],
    queryFn: getReadiness,
    refetchInterval: 30_000,
  });

  const state = readiness.isPending
    ? "checking"
    : readiness.isSuccess
      ? "ready"
      : "offline";
  return (
    <div
      className="text-muted-foreground flex items-center gap-2 text-sm"
      role="status"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          state === "ready" && "bg-[var(--green-light)]",
          state === "checking" && "bg-muted-foreground",
          state === "offline" && "bg-primary",
        )}
      />
      {state === "checking" && "Checking local API…"}
      {state === "ready" && "Local stack is ready"}
      {state === "offline" && "Start the local API and dependencies"}
    </div>
  );
}
