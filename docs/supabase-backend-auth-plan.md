# Supabase Backend-Only Integration Plan

Status: Draft implementation handoff  
Last updated: 2026-09-20  
Scope: Supabase PostgreSQL, Supabase Auth, and Supabase Storage behind the existing Go API

## Implementation progress

Foundation milestone completed on 2026-09-20:

- [x] Added disabled-by-default Supabase configuration and validation.
- [x] Added the provider-neutral `IdentityProvider` interface.
- [x] Added a bounded, timeout-controlled Supabase Auth HTTP client.
- [x] Added safe provider error mapping that does not return Supabase response messages.
- [x] Added versioned AES-256-GCM encryption for server-held refresh tokens.
- [x] Added a forward/down migration for staged Supabase identity and session fields.
- [x] Added unit tests for configuration, provider calls, error redaction, response limits, encryption, tamper detection, and key rotation.
- [x] Verified the full Go test suite and `go vet ./...`.

Provider-auth milestone completed on 2026-09-20:

- [x] Added the PostgreSQL provider-session repository.
- [x] Added compare-and-swap refresh-token rotation to reject stale concurrent updates.
- [x] Added session and account-wide revocation.
- [x] Added one-time, server-stored password-recovery grants.
- [x] Added the Supabase-backed registration, login, confirmation, refresh, logout, resend, recovery, and password-update service.
- [x] Added compensating Supabase identity deletion when the application-user insert fails.
- [x] Added confirmation, resend-confirmation, forgot-password, recovery callback, and reset-password HTTP routes.
- [x] Wired the Supabase service behind `SUPABASE_ENABLED`; legacy bcrypt auth remains the default.
- [x] Added fake-Supabase HTTP integration tests for registration, confirmation, and password recovery.
- [x] Added handler tests and a frontend guard for pending email confirmation.
- [x] Applied migrations 001–017 to an isolated PostgreSQL 16 instance and ran the provider repository integration test.
- [x] Verified backend tests, Go static analysis, frontend lint, frontend tests, and the production frontend build.

The Supabase path is not active yet. `SUPABASE_ENABLED` defaults to `false`, and the existing bcrypt authentication remains the runtime implementation. Migrations `000016` and `000017` were verified on an isolated database but have not been applied to a shared development, staging, or production database.

Next implementation milestone:

1. Create the development Supabase project and configure custom SMTP.
2. Customize the confirmation email link to point to `AUTH_EMAIL_CONFIRM_URL` with `?token_hash={{ .TokenHash }}&type=email`.
3. Customize the recovery email link to point to `AUTH_PASSWORD_RESET_URL` with `?token_hash={{ .TokenHash }}&type=recovery`.
4. Apply migrations 001–017 to the development project.
5. Add the forgot-password and reset-password frontend screens and route.
6. Exercise the full flow against development Supabase before enabling it in staging.

## Objective

Move Bling to Supabase for managed PostgreSQL, user authentication, and profile-image storage without allowing the browser to communicate directly with Supabase.

The Go API remains the sole application boundary. The frontend must not contain a Supabase project URL, anon key, service-role key, database credential, access token, or refresh token.

```text
Browser
   |  HTTPS + opaque Secure/HttpOnly cookie
   v
Go API
   |-- Supabase Auth
   |-- Supabase PostgreSQL
   |-- Supabase Storage
   |-- Redis
   `-- Stripe
```

## Architecture decisions

1. Supabase Auth owns credentials, email verification, password resets, authentication factors, and identity suspension.
2. `auth.users.id` is the canonical identity UUID.
3. Bling retains an application-owned `users` row with the same UUID for usernames, application state, and existing foreign keys.
4. The browser receives only Bling's opaque `bling_session` cookie. Supabase JWTs and refresh tokens remain on the server.
5. The Go API performs all authorization. Supabase's Data API is not an application API for Bling.
6. Application tables are not exposed through PostgREST. Database grants, schema exposure, network controls, and RLS provide defense in depth.
7. Profile-image writes and reads pass through Go. The Supabase Storage bucket is private.
8. Redis remains in use for rate limiting, realtime fan-out, presence, and queue indexing. Supabase Realtime is not part of this migration.
9. Stripe, WebRTC, TURN, and the existing payment ledger remain unchanged except for continuing to reference the same user UUID.
10. Assuming there are no production users, use a clean auth cutover. Do not maintain bcrypt/Supabase dual authentication unless real production accounts are discovered.

## Current implementation context

The current application already uses a backend-for-frontend pattern:

- The React frontend calls only `/api/v1/*` through `frontend/src/lib/api.ts`.
- Authentication requests are defined in `frontend/src/lib/auth.ts`.
- Go authentication lives under `backend/internal/auth/` and `backend/internal/httpapi/auth.go`.
- `backend/internal/httpapi/auth_middleware.go` protects creator routes by resolving `bling_session`.
- The current `users` table owns bcrypt password hashes.
- The current `sessions` table stores only hashed opaque session tokens.
- Many tables reference `users.id`; preserving the UUID shape avoids broad downstream changes.
- Profile pictures currently upload to Go and are stored as `BYTEA` in `creator_profile_avatars`.
- Public profile images are already served through `GET /api/v1/creators/{username}/avatar`.

Important files:

- `backend/internal/auth/auth.go`
- `backend/internal/auth/store.go`
- `backend/internal/auth/ratelimit.go`
- `backend/internal/httpapi/auth.go`
- `backend/internal/httpapi/auth_middleware.go`
- `backend/internal/httpapi/router.go`
- `backend/internal/httpapi/social.go`
- `backend/internal/database/database.go`
- `backend/internal/config/config.go`
- `backend/cmd/api/main.go`
- `backend/migrations/000001_initial_schema.up.sql`
- `backend/migrations/000010_social_discovery.up.sql`
- `backend/migrations/000015_profile_avatars.up.sql`
- `frontend/src/lib/auth.ts`
- `frontend/src/components/AuthPage.tsx`
- `frontend/src/components/ProfileEditor.tsx`

## Phase 1: Supabase environments and platform configuration

Create independent Supabase projects for development, staging, and production. Production and staging must never share identities, Storage buckets, secrets, or databases.

Configure each project as follows:

- Select the same geographic region as the deployed Go API.
- Use a paid plan for production.
- Enable email confirmation.
- Configure custom SMTP before inviting production users.
- Require SSL for database connections.
- Enable MFA for all Supabase organization administrators.
- Add at least two organization owners.
- Configure an explicit production spend cap and billing alerts.
- Keep daily backups enabled.
- Document whether point-in-time recovery is enabled; it is a separate paid add-on.
- Establish an off-platform `pg_dump` backup schedule and test restoration.
- Decide on the production Go host before applying network restrictions, because its outbound addresses must be known or stable.

Do not enable Supabase Realtime, Edge Functions, or direct frontend SDK access as part of this work.

## Phase 2: Lock down the database and Data API

The preferred layout is an application schema that is not exposed through Supabase's Data API.

1. Create an `app` schema for Bling-owned tables.
2. Configure the Data API exposed-schema list so `app` is absent.
3. Revoke schema, table, sequence, and function privileges from `PUBLIC`, `anon`, and `authenticated`.
4. Create a `bling_backend` database role with only the privileges the Go API needs.
5. Make migration ownership and runtime ownership distinct if practical.
6. Require TLS in the Go database connection.
7. Apply database network restrictions when the API's egress addresses are known.
8. Confirm direct REST access cannot select, insert, update, or delete any Bling data.

If moving every existing table out of `public` would make the first cutover excessively risky, an acceptable transitional design is:

- Keep tables in `public` temporarily.
- Remove `public` from the exposed-schema list, or expose only a deliberately empty `api` schema.
- Revoke access from `PUBLIC`, `anon`, and `authenticated`.
- Use schema-qualified SQL throughout new migrations.
- Move tables to `app` in a follow-up migration.

Do not treat RLS alone as the boundary. RLS should still be enabled where useful, but the principal controls are schema isolation, revoked grants, backend-only credentials, TLS, and network restrictions.

## Phase 3: Database identity migration

Create a new forward migration; do not edit migrations that may already have run.

Target model:

```sql
-- Illustrative only; adapt naming and constraints in the migration.
CREATE TABLE app.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migration requirements:

- Remove `password_hash` from Bling's user model after Supabase Auth is active.
- Treat email in `auth.users` as canonical.
- Avoid exposing `auth.users` to the runtime database role beyond the minimum required relationship.
- Preserve current UUIDs for downstream relationships.
- Preserve all existing foreign keys from shows, profiles, follows, balances, payouts, and payments.
- Keep `creator_profiles` initialization working when the Bling application user is inserted.
- Rename `users` only if doing so materially improves clarity; avoid unnecessary repository-wide churn.
- Add a migration-down strategy where safe, but do not attempt to reconstruct deleted password hashes.

If real users exist at cutover time, stop and replace the clean-cutover assumption with a dedicated migration process. Password hashes cannot be silently converted into Supabase passwords. Existing users would need an invite/password-reset migration or a supported hash-import process.

## Phase 4: Supabase Auth adapter in Go

Introduce an Auth provider abstraction rather than calling Supabase directly from HTTP handlers.

Suggested responsibilities:

```go
type IdentityProvider interface {
    SignUp(ctx context.Context, email, password string) (Identity, Tokens, error)
    SignInWithPassword(ctx context.Context, email, password string) (Identity, Tokens, error)
    Refresh(ctx context.Context, refreshToken string) (Tokens, error)
    VerifyEmailOTP(ctx context.Context, tokenHash string) (Identity, Tokens, error)
    SendPasswordReset(ctx context.Context, email, redirectURL string) error
    VerifyPasswordReset(ctx context.Context, tokenHash string) (Identity, Tokens, error)
    UpdatePassword(ctx context.Context, accessToken, password string) error
    SignOut(ctx context.Context, accessToken string) error
    DeleteUser(ctx context.Context, userID string) error
}
```

Implementation rules:

- Use Supabase Auth's HTTPS API from Go.
- Use narrowly scoped clients: normal Auth operations should not automatically receive the service-role key.
- Reserve the service-role key for operations that actually require administration, such as compensating deletion.
- Apply short HTTP timeouts, bounded response reads, and retry only idempotent operations.
- Map provider errors into the existing safe application errors.
- Never return raw provider errors or account-enumeration details to clients.
- Never log passwords, Supabase access tokens, refresh tokens, authorization headers, OTP token hashes, or service-role credentials.
- Add contract tests using an `httptest.Server` in addition to integration tests against a local or staging Supabase project.

## Phase 5: Server-owned application sessions

Keep `bling_session` as a random opaque cookie. Do not put Supabase JWTs in JavaScript-accessible storage.

Extend or replace the existing `sessions` table with fields equivalent to:

- `id`
- `user_id`
- `token_hash`
- `encrypted_refresh_token`
- `access_token_expires_at`
- `provider_validated_at`
- `expires_at`
- `created_at`
- `last_seen_at`
- `revoked_at`

Session behavior:

1. Generate the Bling session token with a cryptographically secure RNG.
2. Store only its SHA-256 hash, as the application already does.
3. Encrypt the Supabase refresh token at rest using a dedicated versioned encryption key.
4. Never store the refresh token in plaintext or in logs.
5. Refresh the Supabase session server-side before provider expiry.
6. Handle refresh-token rotation atomically so concurrent requests cannot corrupt the session.
7. If refresh reports a revoked, expired, or deleted identity, revoke the Bling session.
8. Logout should revoke the provider session where possible, revoke the local session, and expire the cookie.
9. Password reset, account deletion, or administrator suspension must invalidate all local sessions.
10. Keep the cookie `HttpOnly`, `Secure` in production, `SameSite=Lax` or stricter, and scoped to the smallest practical domain and path.

Add a version prefix to encrypted session material so keys can be rotated without invalidating every active session at once.

New configuration will likely include:

- `SUPABASE_URL`
- `SUPABASE_AUTH_KEY` or equivalent server-held Auth key
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `SESSION_ENCRYPTION_KEYS`
- `AUTH_EMAIL_CONFIRM_URL`
- `AUTH_PASSWORD_RESET_URL`

Configuration validation must fail closed in production when required values are absent.

## Phase 6: Registration and account lifecycle

Registration sequence:

1. Validate and normalize username and email in Go.
2. Apply the existing Redis-backed IP and identity rate limits.
3. Pre-check username availability for a useful response, while retaining the database unique constraint as the authority.
4. Create the Supabase identity.
5. Insert the Bling `users` row with exactly the Supabase UUID.
6. If the Bling insert fails, use an administrator operation to delete the newly created Supabase identity.
7. Make retries idempotent and add reconciliation for rare partial failures.
8. Do not grant a fully authenticated Bling session until the configured email-confirmation policy is satisfied.

Email confirmation:

- Customize the Supabase email template so the visible link returns to a Go endpoint.
- The Go endpoint accepts only the required token hash and type, verifies them with Supabase, creates or completes the application session, and redirects to an allowlisted frontend location.
- Do not place access or refresh tokens in frontend URLs.

Password reset:

- The browser requests reset through Go.
- Always return the same outward response whether the account exists or not.
- The email link returns to Go.
- Go verifies the reset token, accepts the new password through a protected short-lived flow, updates Supabase Auth, and revokes all existing Bling sessions.

Account deletion:

- Require recent authentication or another explicit confirmation.
- Stop active shows/calls safely before deletion.
- Resolve Stripe payout and financial-retention requirements before deleting financial records.
- Delete private Storage objects.
- Revoke sessions.
- Delete or disable the Supabase identity according to the financial data retention policy.

## Phase 7: HTTP routes and middleware

Preserve the current frontend-facing routes where possible:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`

Add:

- `GET /api/v1/auth/confirm`
- `POST /api/v1/auth/resend-confirmation`
- `POST /api/v1/auth/forgot-password`
- `GET /api/v1/auth/reset`
- `POST /api/v1/auth/reset-password`
- `DELETE /api/v1/account`

Update `requireCreator` so it resolves the server-owned session and places the application user in context exactly as it does today. Protected feature handlers should not need to understand Supabase.

Security requirements:

- Preserve `Cache-Control: no-store` on authentication and account responses.
- Keep exact origin checking for all browser requests.
- Add explicit CSRF protection for cookie-authenticated state-changing requests. Exact Origin checking is useful but should not be the only mechanism.
- Preserve generic invalid-credential responses.
- Rate-limit register, login, resend, forgot-password, reset, and confirmation attempts independently.
- Set strict request-size and JSON-decoding limits.
- Audit successful and failed authentication lifecycle events without sensitive payloads.

## Phase 8: Move avatars to private Supabase Storage

Create a private bucket such as `profile-avatars`.

The browser continues to upload multipart form data only to:

```text
POST /api/v1/profile/avatar
```

The Go handler must:

1. Enforce the request and decoded-image size limits.
2. Decode the image rather than trusting the filename or MIME header.
3. Reject unsupported formats and unreasonable pixel dimensions.
4. Correct orientation if needed.
5. Re-encode into an approved JPEG or WebP format.
6. Strip EXIF, GPS, color-profile surprises, and other metadata.
7. Generate the object key on the server, for example `{userID}/avatar-{version}.webp`.
8. Upload using a server-held credential.
9. Store only the object key and content metadata in PostgreSQL.
10. Update the profile only after upload succeeds.
11. Remove the replaced object after the database update, with cleanup/reconciliation for partial failures.

Keep the existing read URL:

```text
GET /api/v1/creators/{username}/avatar
```

Go should authorize profile visibility, retrieve the object from private Storage, and return it with:

- Correct `Content-Type`
- `Content-Length` where known
- `X-Content-Type-Options: nosniff`
- An `ETag`
- An appropriate public cache policy for published profiles

After cutover, remove `creator_profile_avatars.image_data` and the associated database blob path in a later migration. Do not delete existing blobs until migration verification succeeds.

## Phase 9: Frontend work

The frontend should remain unaware of Supabase.

Expected changes are limited to:

- Email-confirmation pending and completed states.
- Forgot-password and reset-password screens.
- Resend-confirmation action.
- Handling session-expired responses consistently.
- Possibly an account-security section for password changes and session revocation.

Do not add `@supabase/supabase-js` unless a later architecture decision explicitly permits direct client integration.

The current login, registration, `useMe`, logout, protected-route, and profile-image upload patterns should otherwise remain intact.

## Phase 10: Testing

### Unit tests

- Supabase error mapping does not leak provider details.
- Registration compensation removes orphaned identities.
- Session token hashing and refresh-token encryption.
- Encryption-key rotation and unknown-key failure behavior.
- Atomic refresh-token rotation under concurrent requests.
- Revoked, expired, or deleted provider users lose local sessions.
- Login and registration rate limiting.
- Confirmation and reset redirect allowlists.
- Avatar type, byte-size, dimension, malformed-data, and metadata stripping behavior.

### Integration tests

- Register -> confirm -> login -> `/me` -> logout.
- Incorrect password and nonexistent email produce indistinguishable outward errors.
- Forgot password -> reset -> old sessions revoked -> new login succeeds.
- Direct PostgREST access to application tables is denied for anon and authenticated roles.
- Direct Storage upload and download are denied.
- The Go database role can perform required queries but cannot administer Auth or unrelated schemas.
- Existing show, queue, call, social, payment, payout, and balance flows work using Supabase identity UUIDs.
- Avatar replacement leaves one active object and no leaked database blob.

### Operational tests

- Restore an off-platform database backup into a disposable project.
- Rotate the service-role key.
- Rotate the session-encryption key.
- Disable a test user and verify session invalidation.
- Simulate Supabase Auth downtime and confirm fail-closed behavior with safe error responses.
- Simulate Storage downtime without corrupting the saved profile.
- Verify logs and traces contain no passwords, tokens, cookie values, or secret keys.

## Phase 11: Deployment and cutover

1. Create development Supabase project and local environment configuration.
2. Add database/security migrations and verify them on a disposable database.
3. Implement the Auth provider behind interfaces and retain existing handler contracts.
4. Implement encrypted server-owned sessions and new account lifecycle endpoints.
5. Implement private Storage avatars.
6. Run the full backend and frontend test suites.
7. Create staging, load representative data, and complete the security tests.
8. Complete a backup-and-restore drill.
9. Configure production secrets, SMTP, redirect allowlists, database restrictions, alerts, and dashboards.
10. Deploy Go first if it remains backward compatible; otherwise schedule a short maintenance window.
11. Run migrations.
12. Deploy the frontend.
13. Perform production smoke tests with a dedicated test account.
14. Monitor authentication failures, database errors, Storage failures, and orphan reconciliation closely after cutover.

## Observability and operations

Add metrics and alerts for:

- Registration, confirmation, login, refresh, and logout outcomes
- Provider latency and error rates
- Session refresh conflicts
- Orphan identity reconciliation failures
- Password-reset and resend volume
- Authentication rate-limit triggers
- Storage upload/read failures
- Database pool saturation
- Supabase resource utilization and disk growth

Prepare runbooks for:

- Supabase Auth outage
- Database outage
- Storage outage
- Leaked anon/Auth key
- Leaked service-role key
- Leaked database password
- Leaked session-encryption key
- User suspension and account recovery
- Backup restoration

## Security acceptance criteria

The migration is not complete until all of the following are true:

- [ ] The browser bundle and runtime configuration contain no Supabase credentials or project endpoint.
- [ ] Browser network traces show application traffic only to the Go API, except explicitly approved third-party flows such as Stripe or an OAuth provider.
- [ ] Supabase access and refresh tokens never reach JavaScript-accessible storage.
- [ ] The service-role key is never used by or returned to the frontend.
- [ ] Application tables are inaccessible through the Supabase Data API.
- [ ] The Storage bucket rejects direct client reads and writes.
- [ ] Go uses a least-privileged runtime database role over TLS.
- [ ] Authentication cookies are Secure, HttpOnly, appropriately SameSite, and narrowly scoped.
- [ ] State-changing cookie-authenticated endpoints have CSRF protection.
- [ ] Provider token rotation is atomic and tested.
- [ ] Account suspension, password reset, logout, and deletion revoke relevant Bling sessions.
- [ ] Logs contain no credentials, cookies, JWTs, refresh tokens, OTP hashes, or secret keys.
- [ ] Database and Storage recovery procedures have been tested.

## Functional acceptance criteria

- [ ] A new user can register, confirm their email, sign in, and sign out.
- [ ] An existing user can reset their password.
- [ ] `/api/v1/me` and all creator-protected routes use the Supabase-backed identity through the Bling session.
- [ ] Existing shows, calls, queues, follows, notifications, payments, balances, and payouts continue to work.
- [ ] A creator can upload, replace, view, and remove a profile picture.
- [ ] Published avatars remain available at the existing Go API URL.
- [ ] Frontend code has no direct Supabase dependency.
- [ ] CI runs the new unit, integration, and security tests.

## Known tradeoffs

- Proxying public avatars through Go preserves the backend-only boundary but uses bandwidth twice: Supabase-to-Go and Go-to-user. This can be revisited later for public, non-sensitive images.
- A server-owned session adds database state and token-encryption responsibilities, but it keeps provider tokens away from the browser and preserves immediate application-level revocation.
- A standard Supabase project does not currently provide the same mature production write-failover model as RDS Multi-AZ. Daily backups are included on paid plans, while point-in-time recovery is a separate cost.
- Network restrictions depend on stable outbound addresses from the Go hosting provider.
- Supabase security still follows a shared-responsibility model. Backend-only access reduces exposure but does not replace secure database grants, Storage policies, secret handling, monitoring, and backups.

## Out of scope

- Replacing Redis with Supabase Realtime
- Replacing the Go API with Edge Functions
- Direct frontend access to Supabase Auth, Database, or Storage
- OAuth/social login in the initial migration
- Multi-factor authentication for Bling users in the initial migration
- Changing Stripe, WebRTC, TURN, or the financial ledger architecture
- Enabling Supabase Multigres while it is not recommended for mission-critical production workloads

## First implementation task

Start with a small foundation change that does not affect frontend behavior:

1. Add the Supabase configuration fields with production validation.
2. Add the `IdentityProvider` interface and a fake implementation for tests.
3. Add a Supabase Auth HTTP client with redacted errors and strict timeouts.
4. Draft the forward database migration for identity UUID ownership and encrypted session fields.
5. Add tests for configuration, error mapping, token encryption, and session rotation.

Do not switch the live auth handlers until the provider adapter, migration, session encryption, confirmation flow, and rollback procedure have all been verified in staging.
