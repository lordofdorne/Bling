package httpapi

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

type metricsHandler struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func (h metricsHandler) serve(w http.ResponseWriter, r *http.Request) {
	var waiting, activeCalls, reconnecting, pendingOutbox, pendingCaptures, pendingRefunds, failedRefunds, failedWebhookEvents, openDisputes, failedPayouts int64
	err := h.pool.QueryRow(r.Context(), `SELECT
		(SELECT count(*) FROM queue_entries WHERE status='WAITING'),
		(SELECT count(*) FROM calls WHERE status IN ('CREATED','CONNECTING','LIVE')),
		(SELECT count(*) FROM calls WHERE status IN ('CREATED','CONNECTING','LIVE') AND (creator_disconnected_at IS NOT NULL OR viewer_disconnected_at IS NOT NULL)),
		(SELECT count(*) FROM queue_outbox WHERE published_at IS NULL),
		(SELECT count(*) FROM payment_attempts WHERE status='CAPTURING'),
		(SELECT count(*) FROM payment_refunds WHERE status IN ('REQUESTED','PROCESSING','RETRY','PENDING')),
		(SELECT count(*) FROM payment_refunds WHERE status='FAILED'),
		(SELECT count(*) FROM stripe_webhook_events WHERE status='FAILED'),
		(SELECT count(*) FROM payment_disputes WHERE status NOT IN ('won','lost','warning_closed','prevented')),
		(SELECT count(*) FROM creator_payout_events WHERE status='failed')`).Scan(&waiting, &activeCalls, &reconnecting, &pendingOutbox, &pendingCaptures, &pendingRefunds, &failedRefunds, &failedWebhookEvents, &openDisputes, &failedPayouts)
	if err != nil {
		h.logger.Error("operational metrics query failed", "error", err)
		http.Error(w, "metrics unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = fmt.Fprintf(w, "# TYPE bling_queue_waiting gauge\nbling_queue_waiting %d\n", waiting)
	_, _ = fmt.Fprintf(w, "# TYPE bling_calls_active gauge\nbling_calls_active %d\n", activeCalls)
	_, _ = fmt.Fprintf(w, "# TYPE bling_calls_in_reconnect_grace gauge\nbling_calls_in_reconnect_grace %d\n", reconnecting)
	_, _ = fmt.Fprintf(w, "# TYPE bling_queue_outbox_pending gauge\nbling_queue_outbox_pending %d\n", pendingOutbox)
	_, _ = fmt.Fprintf(w, "# TYPE bling_payment_captures_pending gauge\nbling_payment_captures_pending %d\n", pendingCaptures)
	_, _ = fmt.Fprintf(w, "# TYPE bling_payment_refunds_pending gauge\nbling_payment_refunds_pending %d\n", pendingRefunds)
	_, _ = fmt.Fprintf(w, "# TYPE bling_payment_refunds_failed gauge\nbling_payment_refunds_failed %d\n", failedRefunds)
	_, _ = fmt.Fprintf(w, "# TYPE bling_stripe_webhook_events_failed gauge\nbling_stripe_webhook_events_failed %d\n", failedWebhookEvents)
	_, _ = fmt.Fprintf(w, "# TYPE bling_payment_disputes_open gauge\nbling_payment_disputes_open %d\n", openDisputes)
	_, _ = fmt.Fprintf(w, "# TYPE bling_creator_payouts_failed gauge\nbling_creator_payouts_failed %d\n", failedPayouts)
}
