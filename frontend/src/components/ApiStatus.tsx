import { useQuery } from "@tanstack/react-query";

type Readiness = {
  status: "ok" | "unavailable";
};

async function getReadiness(): Promise<Readiness> {
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
    <div className={`status status-${state}`} role="status">
      <span aria-hidden="true" />
      {state === "checking" && "Checking local API…"}
      {state === "ready" && "Local stack is ready"}
      {state === "offline" && "Start the local API and dependencies"}
    </div>
  );
}
