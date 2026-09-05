# Story 1.4 — Authentication, Optional 2FA, Biometric Unlock & Session Timeout

**Review Summary Strip:** Story ID: 1.4 | Objective: Secure access appropriate to financial-adjacent data | Core Change: Auth flow, optional 2FA, mobile biometric unlock, configurable idle-session timeout | Risk Level: High | Confidence Score: 78 | Blocking Issues: None (one Blocking Question was raised and resolved with Joseph before drafting — see Grounding Check) | ClaudeCode Ready: Yes

**User Story:** As any household member, I want secure but convenient login — with optional 2FA and biometric quick-unlock on mobile — so that my household's financial data stays protected without daily friction.

**Acceptance Criteria:**
1. Given valid email/password, when submitted from a new device, then full authentication is required (password + 2FA if the user has it enabled) — no shortcut.
2. Given an already-authenticated session on mobile, when the user re-opens the app within the idle-timeout window, then biometric/Face ID unlock (if available and enabled) may be used instead of re-entering the password.
3. Given a user-configurable idle timeout (default 30 minutes), when that duration elapses with no activity, then the client explicitly revokes the local session (`supabase.auth.signOut({ scope: 'local' })`) before any further access is offered, and full re-authentication is required on next access.
4. Given a user has not enabled 2FA, when they log in, then password-only auth succeeds — 2FA is opt-in, never mandatory.
5. **(Negative security AC — corrected, see Grounding Check)** Given a session whose idle timeout has elapsed, when the app is reopened or any authenticated action is attempted, then the idle-timer check runs **before** any biometric prompt or `setSession()` call on the stored token; if the idle window has elapsed, the app calls `supabase.auth.signOut({ scope: 'local' })` and deletes its own locally stored copy of the session (`SecureStore.deleteItemAsync`) instead of ever presenting the biometric prompt — no code path may reach `LocalAuthentication.authenticateAsync()` or `supabase.auth.setSession()` on a stored token without first passing this check.

**Dependencies & Assumptions:** Assumes device-level biometric APIs are available on the target platforms. Session timeout default (30 minutes) confirmed live in `household.session_timeout_minutes`; the UI to let a household change that value away from the default is a separate story (Epic 6/7) — this story implements enforcement of whatever value is currently stored, not a UI to edit it. **Corrected assumption:** no Preferences/Settings screen of any kind exists yet in either app (verified against the repo — see Grounding Check); this story must build a minimal, narrowly-scoped entry point for 2FA enrollment only, not a general Preferences screen.

**Traceability:** PIB Objective: "Authentication — email/password, optional 2FA, biometric quick-unlock." PSDD Capability: Authentication & Security.

**Change Impact:**
- What changes: Auth flow, 2FA enrollment/verification, biometric unlock integration, idle-timeout session revocation.
- What it touches: Auth system (web + mobile), mobile app device-API layer, a new minimal 2FA-enrollment entry point on both clients.
- Breaking risk: No (net-new build).

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement email/password auth as the baseline, optional TOTP 2FA enrollment via Supabase Auth's native MFA APIs, mobile biometric unlock scoped strictly to re-entering an existing, still-valid session (never a substitute for initial login on a new device), and an idle-timeout that the client itself enforces by explicitly revoking the session — not by relying on Supabase's platform-level Inactivity Timeout (Pro-plan-only; this org is on the Free plan — confirmed live) or on merely shortening the JWT expiry (which, alone, does not stop the SDK from silently refreshing an active app's token regardless of idle state). Do NOT implement: mandatory 2FA, biometric unlock as a new-device login method, social/passwordless/SSO, server-side push-based 2FA, a general Preferences/Settings screen, or a session-timeout-editing UI (Epic 6/7's concern).

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (repeated authentication attempts with the same credentials produce the same session outcome; repeated idle-timeout signOut calls are safe no-ops once a session is already revoked) | Reason: Security-sensitive story — implement exactly as specified, no invented shortcuts.
Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

---

### Story Summary

This DIP delivers Story 1.4: Supabase Auth email/password login as the baseline, optional TOTP-based 2FA (opt-in, never mandatory), mobile biometric quick-unlock scoped strictly to resuming an already-valid session, and enforcement of the household's configurable idle timeout (`household.session_timeout_minutes`, default 30). The pre-drafted version of this DIP in `BACKLOG_DIP.md` contained two defects caught during this session's Grounding Check, both corrected here: (1) it assumed an existing "Preferences screen" to extend, which does not exist in the repo — the same category of false assumption already found and fixed in DIP-1.3's "Profile screen" reference; (2) its core session-timeout mechanism — "set the Supabase project's JWT expiry to match `session_timeout_minutes`" — does not actually achieve idle-based server-side expiry, for reasons detailed in the Grounding Check below, and has been replaced with an explicit client-triggered revocation design confirmed with Joseph via a Blocking Question before this DIP was finalized.

### Repo Target

Both apps: `apps/web` (Next.js) gets password + optional TOTP-2FA login, since Parents use the web app; `apps/mobile` (Expo) gets the full flow plus biometric quick-unlock and the idle-timeout/SecureStore logic, since only mobile has device-native biometric APIs and only mobile needs the resume-vs-reauthenticate branch. Both apps need a minimal 2FA-enrollment entry point (see Grounding Check).

### Grounding Check

**Schema:** `household.session_timeout_minutes` verified live via `information_schema.columns` on project `poqvothxwmjbtitqtbgh` (`ohhsteward-dev`): `integer not null default 30`. Matches the pre-draft's assumption exactly — no correction needed here.

**IMPLEMENTATION_CONVENTIONS.md checklist:** This story introduces no new table and no new `SECURITY DEFINER` function (its only server-side surface is a plain `select` against the already-RLS-scoped `household` table). Items 1–4 of the conventions doc are therefore **not applicable** to this story — stated explicitly per the doc's own instructions, not silently skipped.

**Repo-structure correction (Preferences screen):** The pre-drafted DIP's Repository Integration Instructions named an existing "Preferences screen" as the extension point for 2FA enrollment and the session-timeout setting. Verified against the actual repo (file lists from PRs #1–#8, the same verification method used for DIP-1.3's Profile-screen correction): `apps/web` currently has only `app/page.tsx`, `app/dashboard/page.tsx`, a budget-creation page (Story 2.1), invite screens (Story 1.2), and a minimal account-deletion entry point (Story 1.3); `apps/mobile` has a single `App.tsx` state machine plus the same account-deletion entry point. **No Preferences or Settings screen of any kind exists in either app.** This DIP corrects the assumption: it requires building a minimal, narrowly-scoped 2FA-enrollment entry point (not a general Preferences screen, and not a session-timeout-editing UI — that stays Epic 6/7's concern per this story's own Dependencies note) on each client.

**Session-timeout mechanism — Blocking Question raised and resolved:** The pre-draft's Technical Specification claimed two independent enforcement layers: a client idle timer, and "the Supabase project's JWT access-token expiry configured to match" `session_timeout_minutes`. Verified against Supabase's own documentation (`search_docs`) that this does not work as claimed: the client SDK proactively refreshes the access token in the background for as long as the app is active, independent of user idle state — shortening JWT expiry alone does not cause an idle session to expire. The platform feature that actually enforces server-side inactivity cutoff (Auth → Sessions → Inactivity Timeout / Time-box sessions) is Pro-plan-only; this organization's plan was confirmed live (`get_organization`) as **Free**. This is a genuine architecture gap in the pre-draft, not a wording nitpick — AC5's negative security criterion would not have held under the original design. Raised to Joseph as a Blocking Question with three options (client-triggered `signOut()`, upgrade to Pro, or ship the original design with the gap disclosed); **Joseph selected the client-triggered `signOut()` option** (no cost, works today). This DIP is built on that decision — see the corrected Technical Specification and Implementation Instructions below.

A second, related defect was found and corrected while designing the resolution: `supabase.auth.signOut()` defaults to `scope: 'global'`, which signs the user out of **every** device/session, not just the idle one. Confirmed via Supabase's JS reference docs. The idle-timeout handler in this DIP always passes `{ scope: 'local' }` explicitly — using the default would be a functional regression (an idle timeout on one device would force-logout the same user's other active sessions).

A third nuance, disclosed rather than hidden: per Supabase's own documentation, "Access Tokens of revoked sessions remain valid until their expiry time... there is no way to revoke a user's access token JWT until it expires." This means even a correctly-scoped `signOut({ scope: 'local' })` call revokes the *refresh* token immediately but leaves any already-issued *access* token independently valid/replayable until its own expiry. This is why Deployment Instruction #2 below (shorten the project's JWT/access-token expiry to match `session_timeout_minutes`'s default) is retained from the pre-draft — not as the primary idle-detection mechanism (that role belongs to the client-triggered `signOut`), but as the bound on this residual window. This residual risk is stated plainly in the Non-Functional Requirements/Security section below rather than silently omitted.

**Trust boundary:** the login form (email, password, TOTP code) is untrusted client input, validated server-side entirely by Supabase Auth's own primitives — this story writes no custom validation of these values. The client-side idle timer and the decision to call `signOut()` are trusted only as a UX-triggering mechanism, not as the sole security boundary — the bounded JWT-expiry backstop above is what limits the consequence of a client-side bug in that logic.

### Acceptance Criteria

(Restated verbatim from above per §7 rule 15.)

1. Given valid email/password, when submitted from a new device, then full authentication is required (password + 2FA if the user has it enabled) — no shortcut.
2. Given an already-authenticated session on mobile, when the user re-opens the app within the idle-timeout window, then biometric/Face ID unlock (if available and enabled) may be used instead of re-entering the password.
3. Given a user-configurable idle timeout (default 30 minutes), when that duration elapses with no activity, then the client explicitly revokes the local session (`supabase.auth.signOut({ scope: 'local' })`) before any further access is offered, and full re-authentication is required on next access.
4. Given a user has not enabled 2FA, when they log in, then password-only auth succeeds — 2FA is opt-in, never mandatory.
5. **(Negative security AC)** Given a session whose idle timeout has elapsed, when the app is reopened or any authenticated action is attempted, then the idle-timer check runs before any biometric prompt or `setSession()` call on the stored token; if elapsed, the app calls `supabase.auth.signOut({ scope: 'local' })` and deletes its own SecureStore copy instead of ever presenting the biometric prompt — no code path may reach the biometric prompt or resume a stored token without first passing this check.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Do NOT make 2FA mandatory for any user.
   - Do NOT use biometric success as a new-device login method — it may only resume an existing, still-valid session, and only after the idle-timer check in step 6 has already passed.
   - Do NOT implement social/passwordless login or SSO — none was specified.
   - Do NOT implement server-side push-based 2FA — use Supabase's standard TOTP/app-based MFA.
   - Do NOT write any custom cryptography for token storage — use the OS Keychain/Keystore via `expo-secure-store` only.
   - Do NOT build a general Preferences/Settings screen, or a UI to let a household change `session_timeout_minutes` — both are out of scope (Epic 6/7). Build only the minimal 2FA-enrollment entry point named in step 5.
   - Do NOT call `supabase.auth.signOut()` with its default scope anywhere in the idle-timeout path — default scope is `'global'` and would sign the user out of every device, not just the idle one. Always pass `{ scope: 'local' }` for this call.
   - Do NOT rely on shortening the Supabase project's JWT/access-token expiry as the sole or primary idle-timeout enforcement mechanism — it does not, by itself, cause an idle session to expire (the client SDK refreshes tokens in the background independent of activity). It is retained here only as a bound on residual token validity after an explicit `signOut()`, per the Grounding Check above.
4. Implement `signInWithPassword` as the baseline login on both clients; on a **new device** (no valid session token in secure storage), always require the full flow — password, then MFA challenge if the user has 2FA enrolled — never a shortcut (AC1).
5. Implement 2FA enrollment/verification using Supabase Auth's TOTP MFA APIs (`auth.mfa.enroll`, `auth.mfa.challenge`, `auth.mfa.verify`). Enrollment is user-initiated, never required to log in (AC4). Since no Preferences screen exists yet, build a minimal, single-purpose entry point on each client — e.g. a "Security" action reachable from the existing dashboard/account-deletion area added in Story 1.3 — whose only function is starting TOTP enrollment; do not build anything beyond that single action.
6. On mobile, implement the idle-timeout check as the **first** step of any resume path (app foreground/resume, or before any authenticated action after a period away), before any biometric prompt or token use:
   - Compute `idleElapsedMinutes` from the locally tracked last-activity timestamp.
   - If `idleElapsedMinutes > household.session_timeout_minutes` (the caller's own household's current value, read via the already-RLS-scoped `select`): call `supabase.auth.signOut({ scope: 'local' })`, then `SecureStore.deleteItemAsync('sb-session')`, then route to the full re-authentication screen. Do not proceed further in this branch.
   - Otherwise (not yet elapsed): proceed to the biometric-unlock gate — read the stored session from `expo-secure-store`, prompt `LocalAuthentication.authenticateAsync()`, and on success call `supabase.auth.setSession(...)` to resume; on failure, fall through to full re-authentication (do not resume).
   - Update the last-activity timestamp on every authenticated action, not only at app-resume.
7. Configure the Supabase project's access-token (JWT) expiry to `session_timeout_minutes`'s default (30 minutes) as a bound on residual token validity after a `signOut()` call — not as the mechanism that detects or causes idle expiry, which is entirely the client-side check in step 6.

### Code Requirements

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL supplied in a DIP — any SQL supplied in a DIP must itself be parameterized, or explicitly marked as a one-time DDL/migration statement executed with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
2. **Input validation at trust boundaries.** Validate type, range, length, format, and allowed values on every input crossing a boundary — API route, RPC call, Edge Function, file upload, or external system response. Validate server-side; client-side validation is never sufficient. Reject by default rather than sanitize where a closed set of valid values exists. (ASVS V5)
3. **Output encoding.** Encode data for the context it enters — HTML, URL, SQL identifier, log line, or downstream message/notification. (CWE-79; ASVS V5)
4. **Secrets.** No credential, connection string, key, token, or certificate may appear in source, configuration committed to the repository, test fixtures, log output, error messages, or telemetry. Secrets are resolved at runtime through the platform's environment-variable and secret management, never hardcoded. (CWE-798; ASVS V6, V14)
5. **Sensitive data in logs and telemetry.** Do not log credentials, tokens, personal data, or full request/response payloads. Where a record must be traceable, log an identifier or reference, never the content. (CWE-532; ASVS V7, V8)
6. **Authentication and authorization.** Use the platform's authentication primitives — never implement custom authentication, session handling, or token validation. Enforce authorization on the server for every protected operation, and **fail closed** — an authorization check that errors must deny, never allow. (ASVS V2, V3, V4)
7. **Least privilege.** Database roles, RLS policies, service credentials, and API scopes are the minimum required by the story. Do not grant broad access for convenience. (ASVS V1)
8. **Cryptography.** Never write custom cryptography or invent a scheme. Use platform-provided algorithms and key management. TLS is required for all data in transit; do not disable certificate validation, including in local/dev code paths. (CWE-327, CWE-295; ASVS V6, V9)
9. **Deserialization and parsing.** Treat every inbound payload as untrusted — request bodies, webhook payloads, file uploads. Do not deserialize to arbitrary or polymorphic types from untrusted input; validate against an explicit schema rather than trusting shape. (CWE-502, CWE-611; ASVS V5)
10. **Error handling.** Error responses must not disclose stack traces, SQL text, connection strings, internal hostnames, or file paths to the client. Log the detail server-side; return a generic message and, where useful, a correlation identifier externally. (CWE-209; ASVS V7)
11. **Dependencies.** Do not add a dependency not named in the DIP. Any dependency the DIP does add must be pinned to an explicit version. (ASVS V14)
12. **Concurrency and state.** Where the story involves shared state or idempotency, the implementation must be safe under concurrent execution and retry — a check-then-act sequence over shared state must be atomic. (CWE-362)

**Application to this story:** Obligation 6 (Authentication/authorization): every credential and MFA check goes through Supabase Auth's own primitives — no custom session or token validation is written anywhere in this story; the idle-timeout `signOut()` call uses Supabase's own revocation path, not a custom one. Obligation 8 (Cryptography): the session token is stored via OS-native secure storage (`expo-secure-store`, backed by Keychain/Keystore) — no custom encryption is written, and biometric matching is entirely OS-handled. Obligation 4 (Secrets): the stored session token is treated as a secret — never logged, never included in crash reports or analytics. Obligation 5 (Sensitive data in logs): password, TOTP codes, and the session token are never logged on either client, including debug builds. Obligation 12 (Concurrency): the idle-timeout check-then-signOut sequence is a single client-local operation with no shared mutable state across requests, so no race window exists between checking elapsed time and revoking the session.

Illustrative client-side flow (React Native/Expo) reflecting the corrected design:

```ts
// on app resume / before any authenticated action
const idleElapsedMinutes = minutesSince(lastActivityAt);

if (idleElapsedMinutes > household.session_timeout_minutes) {
  // Idle timeout elapsed: revoke this device's session only, then require full re-auth.
  await supabase.auth.signOut({ scope: 'local' }); // 'local' — NEVER the default 'global' scope here
  await SecureStore.deleteItemAsync('sb-session');
  // fall through to full re-authentication screen — do not offer biometric resume
} else {
  const stored = await SecureStore.getItemAsync('sb-session');
  if (stored) {
    const ok = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock OHh Steward',
    });
    if (ok.success) {
      await supabase.auth.setSession(JSON.parse(stored)); // resumes locally-valid session
    } else {
      // fall through to full re-auth — do not resume
    }
  } else {
    // no stored session — full re-auth required
  }
}
```

No custom SQL for this story beyond a plain `select session_timeout_minutes from household where id = ...`, already covered by Story 2.1's RLS policy on `household`.

### API Contract

Supabase Auth SDK calls only, no custom endpoints:
`supabase.auth.signInWithPassword({ email, password })`; `supabase.auth.mfa.enroll({ factorType: 'totp' })`; `supabase.auth.mfa.challenge({ factorId })`; `supabase.auth.mfa.verify({ factorId, challengeId, code })`; `supabase.auth.setSession(session)` (resume after biometric success, only after the idle-timer check has passed); `supabase.auth.signOut({ scope: 'local' })` (idle timeout — this device only).

### Non-Functional Requirements

*Performance:* Auth round-trips bounded by Supabase Auth's own latency; the idle-timer check and biometric prompt are local and near-instant.

*Scalability:* No scale concern — per-user, per-device operations only.

*Reliability:* The client-triggered `signOut({ scope: 'local' })` is the authoritative idle-timeout enforcement mechanism for this story (chosen over the Pro-plan-only platform Inactivity Timeout feature, which this Free-plan org does not have). The shortened JWT/access-token expiry is a secondary bound, not the primary mechanism.

*Security:* ASVS chapters in scope: V2 (Authentication), V3 (Session Management). Trust boundaries: the login form (email/password/TOTP code) is untrusted client input, validated server-side by Supabase Auth; the locally-stored session token is trusted only as far as OS secure-storage guarantees, and is always re-validated server-side on the next API call. Sensitive data: password, MFA secret/codes, session token — none logged, none stored outside OS-native secure storage. Weaknesses excluded: CWE-798 (no hardcoded credentials), CWE-295 (certificate validation never disabled).

**Disclosed residual risk (not a defect to silently hide):** Supabase Auth provides no mechanism to invalidate an already-issued access token before its own expiry — `signOut()` revokes the refresh token immediately, but a previously-issued access token remains independently valid/replayable until it naturally expires. Combined with this story's design, the practical exposure is: an access token issued shortly before the idle boundary can remain valid for up to `session_timeout_minutes` (default 30) past the nominal timeout instant, in the specific scenario where the token itself (not just the app's stored copy) was somehow extracted and replayed directly against the API outside the app. This is bounded by Deployment Instruction #2 below and is an accepted, disclosed platform constraint — closing it further would require the org's Supabase plan to move to Pro (Joseph's explicit decision, recorded in the Grounding Check, was to proceed on the Free plan for now).

### Observability

Rely on Supabase Auth's built-in sign-in/MFA/session logs. No additional application-level auth logging is required for this story (structured Edge Function logging remains DEFERRED per the DVP's NFR decision, and this story has no Edge Function of its own). Do not log the idle-elapsed computation's inputs/outputs at a level that could leak activity timestamps tied to a specific user beyond what Supabase Auth's own session log already retains.

### Files to Create/Modify

Intent-driven (repo structure not yet fully confirmed beyond what's been observed in PRs #1–#8):
- `apps/web`: login page/hook (password + optional TOTP challenge step), a minimal "Security" entry point for 2FA enrollment reachable from the existing dashboard/account area.
- `apps/mobile`: login screen/hook (password + optional TOTP challenge step), the idle-timer + biometric-resume logic described in Implementation Instructions step 6, `expo-secure-store` session persistence, a minimal "Security" entry point for 2FA enrollment mirroring the web one.
- No new database migration.

### Migration Files (if applicable)

Not applicable — no schema change in this story.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-13

1. Enable TOTP MFA in the Supabase Auth project settings (confirm live in the dashboard, not just assumed default-on).
2. Set the project's access-token (JWT) expiry to 30 minutes (`session_timeout_minutes`'s default) — this bounds residual token validity after a `signOut()` call, per the Grounding Check and disclosed residual risk above; it is not the mechanism that detects idle timeout.
3. Add `expo-secure-store` and `expo-local-authentication` to the mobile app's pinned dependencies (exact versions to be confirmed against the current Expo SDK version already pinned in the repo per Story 1.1.G1's Next.js/Expo version-pinning precedent).
4. Do not enable or configure Auth → Sessions → Inactivity Timeout / Time-box sessions — confirmed unavailable on this org's Free plan; revisit only if the org later upgrades to Pro.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** web auth pages/hooks (Next.js), mobile auth screens/hooks (Expo), plus a new minimal "Security" entry point on each client (2FA enrollment only — not a general Preferences/Settings screen; the session-timeout value itself is read-only in this story, sourced from `household.session_timeout_minutes` as already defined in Story 1.1, with no UI to edit it here).

**Expected integration behavior:** login flow branches on device/session state (new device vs. resumable session) consistently across both clients; mobile additionally runs the idle-timer check before ever offering biometric resume.

**Data flow impact:** none to the schema beyond reading the existing `household.session_timeout_minutes` column.

**Dependencies to add/update:** `expo-secure-store`, `expo-local-authentication` (pin exact versions in `package.json`).

**Constraints:** do not persist any "remember this device" token — every new device must complete the full flow per AC1, with no exception. Do not build a session-timeout-editing UI. Do not call `signOut()` with its default scope anywhere in this story's code.

### Change Impact

- What changes: Auth flow, 2FA enrollment/verification, biometric unlock integration, idle-timeout session revocation.
- What it touches: Auth system (web + mobile), mobile device-API layer, a new minimal 2FA-enrollment entry point on both clients.
- Breaking risk: No (net-new build).

### Branch Name

feature/1.4-auth-2fa-biometric-session-timeout

### Commit Message

1.4: Implement email/password auth, optional TOTP 2FA, mobile biometric unlock, and client-enforced idle session timeout

### Pull Request Description

Maps to each Acceptance Criterion:
- AC1: `signInWithPassword` + mandatory full flow (password + MFA if enrolled) on any device with no valid stored session.
- AC2: biometric resume gate on mobile, reached only after the idle-timer check passes.
- AC3: idle-timer check triggers `supabase.auth.signOut({ scope: 'local' })` on elapse, forcing full re-authentication.
- AC4: TOTP enrollment is user-initiated from the new minimal Security entry point, never required to log in.
- AC5 (negative security): idle-timer check runs before any biometric prompt or stored-token resume; on elapse, the session is explicitly revoked and the local copy deleted rather than ever offering resume.

### Jira Linkage

- PDE Story ID: 1.4
- Jira Epic Key: STEW-1
- Jira Story Key: STEW-13

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-1.4.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file created or modified in the completion report — not a summary. For any file this DIP requires to remain untouched, include `git diff dev [branch] -- [file]` showing zero output as explicit proof.

### Confidence Assessment

- **Confidence Score:** 78
- **Reasoning:** The auth/MFA/biometric mechanics themselves are standard, well-documented Supabase Auth + Expo primitives with no custom cryptography or session handling, which supports a high score. The score is capped below the 85 the pre-draft claimed because this story's core session-timeout guarantee now depends on getting the client-side ordering exactly right (idle-check strictly before biometric/resume, correct `signOut` scope, explicit SecureStore cleanup) rather than a passive platform setting — a real implementation-discipline risk the pre-draft didn't carry, and one CC should treat as the single most scrutinized part of this DIP during its own validation.
- **Top Risk Areas:** (1) Ordering bug — a future code path that calls `LocalAuthentication.authenticateAsync()` or reads the SecureStore token before the idle-timer check would silently defeat AC5; (2) `signOut` scope — any call site using the default `'global'` scope instead of `{ scope: 'local' }` would incorrectly log the user out of other devices; (3) the disclosed residual-validity window (bounded by JWT expiry, not eliminated) — acceptable per Joseph's Free-plan decision, but should be revisited if the org ever handles more sensitive data types or upgrades to Pro.

### ⚠️ Open Questions to be Answered Before Moving Forward

None — the one substantive open question (session-timeout enforcement mechanism given the Free-plan constraint) was raised and resolved with Joseph before this DIP was finalized; see the Grounding Check.
