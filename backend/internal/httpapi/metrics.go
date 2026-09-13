package httpapi

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

type metricsHandler struct {
	social *socialHandler
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func (h metricsHandler) serve(w http.ResponseWriter, r *http.Request) {
	var waiting, activeCalls, reconnecting, pendingOutbox, pendingCaptures, pendingRefunds, failedRefunds, failedWebhookEvents, openDisputes, failedPayouts int64
	var creatorLiability, creatorPending, creatorAvailable, unverifiedLiability, negativeCreators, payoutItemsPending int64
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
	err = h.pool.QueryRow(r.Context(), `WITH balances AS (
		SELECT creator_id,sum(amount_cents) total,
		       sum(amount_cents) FILTER (WHERE effective_at <= now()) available,
		       sum(amount_cents) FILTER (WHERE effective_at > now()) pending
		FROM creator_ledger_entries GROUP BY creator_id
	) SELECT
		COALESCE(sum(total),0),COALESCE(sum(pending),0),COALESCE(sum(available),0),
		COALESCE(sum(total) FILTER (WHERE NOT EXISTS(SELECT 1 FROM creator_payout_accounts a WHERE a.creator_id=balances.creator_id AND a.transfers_status='active')),0),
		count(*) FILTER (WHERE total<0),
		(SELECT count(*) FROM creator_payout_items WHERE status IN ('RESERVED','SENDING','RETRY','FAILED'))
	FROM balances`).Scan(&creatorLiability, &creatorPending, &creatorAvailable, &unverifiedLiability, &negativeCreators, &payoutItemsPending)
	if err != nil {
		h.logger.Error("creator balance metrics failed", "error", err)
		http.Error(w, "metrics unavailable", http.StatusServiceUnavailable)
		return
	}
	var socialPending int64
	var socialOldest float64
	if h.social != nil {
		if err := h.pool.QueryRow(r.Context(), `SELECT count(*),COALESCE(EXTRACT(EPOCH FROM now()-min(queued_at)),0)::float8 FROM social_dirty_creators`).Scan(&socialPending, &socialOldest); err != nil {
			h.logger.Error("social backlog metrics failed", "error", err)
			http.Error(w, "metrics unavailable", 503)
			return
		}
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if h.social != nil {
		_, _ = fmt.Fprint(w, h.social.metrics())
		_, _ = fmt.Fprintf(w, "# TYPE bling_social_projection_pending gauge\nbling_social_projection_pending %d\n# TYPE bling_social_projection_oldest_seconds gauge\nbling_social_projection_oldest_seconds %f\n", socialPending, socialOldest)
	}
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
	_, _ = fmt.Fprintf(w, "# TYPE bling_creator_balance_liability_cents gauge\nbling_creator_balance_liability_cents %d\n", creatorLiability)
	_, _ = fmt.Fprintf(w, "# TYPE bling_creator_balance_pending_cents gauge\nbling_creator_balance_pending_cents %d\n", creatorPending)
	_, _ = fmt.Fprintf(w, "# TYPE bling_creator_balance_available_cents gauge\nbling_creator_balance_available_cents %d\n", creatorAvailable)
	_, _ = fmt.Fprintf(w, "# TYPE bling_creator_balance_unverified_cents gauge\nbling_creator_balance_unverified_cents %d\n", unverifiedLiability)
	_, _ = fmt.Fprintf(w, "# TYPE bling_creator_balance_negative_accounts gauge\nbling_creator_balance_negative_accounts %d\n", negativeCreators)
	_, _ = fmt.Fprintf(w, "# TYPE bling_creator_payout_items_pending gauge\nbling_creator_payout_items_pending %d\n", payoutItemsPending)
}
