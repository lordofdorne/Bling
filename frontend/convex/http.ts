import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { unsubscribeRoute } from "./liveAlerts";
import { stripeWebhook } from "./webhooks";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({ path: "/stripe/webhook", method: "POST", handler: stripeWebhook });
// Live-alert unsubscribe: GET shows a confirm button, POST unsubscribes
// (also what mail clients' one-click unsubscribe sends).
for (const method of ["GET", "POST"] as const) {
  http.route({ path: "/email/unsubscribe", method, handler: unsubscribeRoute });
}

export default http;
