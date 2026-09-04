# Story 1.1.G1 — Web & Mobile App Scaffolding (Monorepo Bootstrap)

**Jira Story Key:** STEW-32 | **Jira Epic Key:** STEW-1 | **DIP ID:** DIP-1.1.G1-v1

**Review Summary Strip:** Story ID: 1.1.G1 | Objective: Make the product actually runnable on web and mobile | Core Change: Scaffold `apps/web` (Next.js) and `apps/mobile` (Expo) under npm workspaces; complete Story 1.1's deferred client wiring | Risk Level: Low (no schema/RLS changes) | Confidence Score: 82 | Blocking Issues: None (tooling choice confirmed by Joseph) | ClaudeCode Ready: Yes

**User Story:** As the product owner, I want a working Next.js web app and Expo mobile app wired to Supabase, so that Story 1.1's registration flow (and every story after it) has somewhere to actually live.

---

### Story Summary

While implementing Story 1.1 (STEW-10), CC correctly flagged that neither a web nor a mobile app exists anywhere in the repo — only `supabase/` and `documentation/` exist so far. Every story from 1.1 onward (`BACKLOG_DIP.md`'s Repository Integration Instructions for nearly every story) assumes "the Next.js auth page/hook" or "the Expo auth screen/hook" already exists to extend. Nothing in PIB, PSDD, ATD, or DVP actually schedules the initial app scaffolding as its own step — a genuine documentation-chain gap, not something Story 1.1 was ever meant to cover on its own. This story closes that gap once, establishing the monorepo structure every later story will build into, and finishes the one concrete piece of work this unblocked: wiring Story 1.1's `signUp` → `rpc_bootstrap_household()` flow into an actual screen on both platforms.

### Repo Target

Both `apps/web` and `apps/mobile`, newly created. Root-level `package.json` gains npm workspaces (`"workspaces": ["apps/*"]`) per Joseph's confirmed tooling choice — npm workspaces over pnpm/Turborepo, to avoid Metro-resolver friction with React Native and keep the setup minimal per the PIB's solo-developer/free-tier constraint.

### Grounding Check

- Verified via CC's own repo exploration during Story 1.1 (STEW-10, PR #2): no `apps/`, `web/`, `mobile/`, or any Next.js/Expo scaffold exists in the repo. Confirmed independently by this DIP: no ATD, PSDD, DVP, or Backlog story schedules initial app scaffolding as a distinct deliverable.
- Trust boundary: this story introduces the Supabase anon key and project URL into two new client codebases. Both are public-safe values by Supabase's own design (protected by RLS, not secrecy) but must still never be hardcoded — they are read from environment variables at runtime on both platforms, never committed to source.
- Grounding for the registration screen itself: reuses Story 1.1's already-implemented `rpc_bootstrap_household()` and `supabase.auth.signUp()` contract exactly as specified in `documentation/dips/DIP-1.1.md` — no new backend logic is introduced by this story.
- Dependency: Story 1.1 (STEW-10, PR #2) must be merged to `dev` first — this story wires a screen to an RPC that must already exist.

### Dependencies & Assumptions

- Discovered while implementing Story 1.1 (STEW-10) — CC's PR #2 commentary is the origin of this gap story.
- Assumes npm workspaces, per Joseph's explicit choice (2026-09-04): npm workspaces over pnpm workspaces, Turborepo, or no workspace tooling.
- Assumes TypeScript for both apps — the de facto standard for both Next.js and Expo today, and not itself a contested decision; flagged here for completeness rather than as an open question.

### Traceability

- PIB Objective: "Deliver the following functional scope... Feature parity between web and mobile" (§3) — unreachable without both apps existing.
- PSDD Capability: Epic 1, Household & Identity Foundation (registration is the first user-facing capability); ATD §1 Architecture Overview (Next.js/Vercel web, React Native/Expo mobile, both talking directly to Supabase).
- Originating story: 1.1 (STEW-10).

### Acceptance Criteria

1. Given a fresh clone of the repo, when `npm install` is run at the root, then both `apps/web` and `apps/mobile` install correctly as npm workspaces with no manual per-app setup step required.
2. Given the web app running locally, when an unauthenticated visitor loads the app, then they land on a registration/sign-in screen (Supabase Auth email/password) rather than any protected content.
3. Given a person submits valid registration details on the web app, when `signUp` succeeds, then `rpc_bootstrap_household()` is called and the user is routed to an empty-dashboard placeholder screen — satisfying Story 1.1's AC1/AC2/AC4 end-to-end through the UI, not just via direct RPC call.
4. Given the same flow on the mobile app (Expo), when registration succeeds, then the identical `signUp` → `rpc_bootstrap_household()` → empty-dashboard sequence occurs, using the same Supabase project.
5. **(Negative security AC)** Given the committed source of both `apps/web` and `apps/mobile`, when searched for literal Supabase URLs, anon keys, or any credential, then none are found outside of environment-variable reads (`process.env.*` on web, `Constants.expoConfig.extra.*` or `process.env.EXPO_PUBLIC_*` on mobile) — and in particular, no `service_role` key appears anywhere in either client codebase.

### Dependencies & Assumptions

(See above — combined with Traceability per the compact story format; no further items.)

### Change Impact

- What changes: creates `apps/web` (Next.js, TypeScript) and `apps/mobile` (Expo, TypeScript) from scratch, root-level npm workspaces config, and a working registration screen on both that completes Story 1.1's client wiring.
- What it touches: no existing files (nothing exists yet to touch) beyond adding workspace config at repo root; no schema/migration changes.
- Breaking risk: No.

---

--- ClaudeCode HANDOFF SECTION ---

### Implementation Intent + Technical Constraints

Establish the minimum viable monorepo structure and Supabase wiring needed for Story 1.1's registration flow to be usable end-to-end — not a full design system, not any screen beyond registration/empty-dashboard, and not Story 7.1's Parent-only route guard (that is explicitly out of scope here; this story has no roles to distinguish yet, since a brand-new user is always a Parent per Story 1.1). Every screen after this one is a later story's job to build into the structure this establishes.

**Do NOT implement:**
- Do NOT build any screen beyond registration/sign-in and an empty-dashboard placeholder — invite screens (1.2), category management (2.3), admin layer (7.1), etc. are explicitly later stories.
- Do NOT implement role-based route guarding (Parent-only web access) — that is Story 7.1's job; every user created by Story 1.1's flow is a Parent, so there is nothing to distinguish yet.
- Do NOT implement biometric unlock or local notifications on mobile — Stories 1.4 and 8.1 respectively.
- Do NOT add Turborepo, pnpm, or any workspace tooling beyond plain npm workspaces — Joseph's explicit choice.
- Do NOT commit a `.env` file with real values to the repo, on either app — use `.env.example`/`.env.local` (git-ignored) for web and Expo's standard `EXPO_PUBLIC_*` env-var convention for mobile.
- Do NOT introduce any dependency not named in this DIP's Files/Dependencies sections without flagging it as a Blocking Question first.

### Acceptance Criteria

(Restated verbatim from above.)

1. Given a fresh clone of the repo, when `npm install` is run at the root, then both `apps/web` and `apps/mobile` install correctly as npm workspaces with no manual per-app setup step required.
2. Given the web app running locally, when an unauthenticated visitor loads the app, then they land on a registration/sign-in screen (Supabase Auth email/password) rather than any protected content.
3. Given a person submits valid registration details on the web app, when `signUp` succeeds, then `rpc_bootstrap_household()` is called and the user is routed to an empty-dashboard placeholder screen — satisfying Story 1.1's AC1/AC2/AC4 end-to-end through the UI, not just via direct RPC call.
4. Given the same flow on the mobile app (Expo), when registration succeeds, then the identical `signUp` → `rpc_bootstrap_household()` → empty-dashboard sequence occurs, using the same Supabase project.
5. **(Negative security AC)** Given the committed source of both `apps/web` and `apps/mobile`, when searched for literal Supabase URLs, anon keys, or any credential, then none are found outside of environment-variable reads — and in particular, no `service_role` key appears anywhere in either client codebase.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

3. **Do NOT implement list** — see above.

4. At repo root, add `"workspaces": ["apps/*"]` to `package.json` (create one if none exists yet at root).

5. Scaffold `apps/web`: Next.js (latest stable, App Router, TypeScript). Add `@supabase/supabase-js` and `@supabase/ssr` (both pinned to whatever exact version `npm install --save-exact` resolves — no `^`/`~` ranges) — `@supabase/ssr` specifically because Story 7.1's server-side Parent-only route guard will need server-readable sessions later; wiring the SSR-compatible client now avoids an auth-library migration when that story lands. Read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from environment variables only.

6. Scaffold `apps/mobile`: Expo (latest stable, TypeScript). Add `@supabase/supabase-js` and `@react-native-async-storage/async-storage` (pinned the same way) for session persistence across app restarts — without this, a user would be signed out every time the app closes, which is not an added feature but the minimum needed for auth to function at all. Read `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` via Expo's standard public-env-var convention.

7. Build the web registration screen: email/password form → `supabase.auth.signUp()` → on success, `supabase.rpc('rpc_bootstrap_household')` → route to an empty-dashboard placeholder route. Errors from either call show a generic message (Secure Coding obligation 10) — never raw Supabase/Postgres error text.

8. Build the identical flow on mobile: same call sequence, Expo screen equivalent, same empty-dashboard placeholder.

9. Add `.env.example` (web) and document the `EXPO_PUBLIC_*` variables needed (mobile) — real values are never committed; Joseph supplies them locally and in Vercel/EAS per Deployment Instructions below.

10. Add a root `.gitignore` entry (if not already present) for `.env`, `.env.local`, and any Expo/EAS local credential files.

### Code Requirements

No SQL — this story is scaffolding and client-side wiring only, reusing Story 1.1's existing `rpc_bootstrap_household()` and Supabase Auth's `signUp()` exactly as already specified. No new database objects, no migration file.

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL written by Atlas — any SQL supplied in a DIP must itself be parameterized, or explicitly marked as a one-time DDL/migration statement executed with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
2. **Input validation at trust boundaries.** Validate type, range, length, format, and allowed values on every input crossing a boundary — API route, RPC call, Edge Function, file upload, or external system response. Validate server-side; client-side validation is never sufficient. Reject by default rather than sanitize where a closed set of valid values exists. (ASVS V5)
3. **Output encoding.** Encode data for the context it enters — HTML, URL, SQL identifier, log line, or downstream message/notification. (CWE-79; ASVS V5)
4. **Secrets.** No credential, connection string, key, token, or certificate may appear in source, configuration committed to the repository, test fixtures, log output, error messages, or telemetry. Secrets are resolved at runtime through the platform's environment-variable and secret management, never hardcoded. (CWE-798; ASVS V6, V14)
5. **Sensitive data in logs and telemetry.** Do not log credentials, tokens, personal data, or full request/response payloads. Where a record must be traceable, log an identifier or reference, never the content. (CWE-532; ASVS V7, V8)
6. **Authentication and authorization.** Use the platform's authentication primitives — never implement custom authentication, session handling, or token validation. Enforce authorization on the server for every protected operation, and fail closed — an authorization check that errors must deny, never allow. (ASVS V2, V3, V4)
7. **Least privilege.** Database roles, RLS policies, service credentials, and API scopes are the minimum required by the story. Do not grant broad access for convenience. (ASVS V1)
8. **Cryptography.** Never write custom cryptography or invent a scheme. Use platform-provided algorithms and key management. TLS is required for all data in transit; do not disable certificate validation, including in local/dev code paths. (CWE-327, CWE-295; ASVS V6, V9)
9. **Deserialization and parsing.** Treat every inbound payload as untrusted — request bodies, webhook payloads, file uploads. Do not deserialize to arbitrary or polymorphic types from untrusted input; validate against an explicit schema rather than trusting shape. (CWE-502, CWE-611; ASVS V5)
10. **Error handling.** Error responses must not disclose stack traces, SQL text, connection strings, internal hostnames, or file paths to the client. Log the detail server-side; return a generic message and, where useful, a correlation identifier externally. (CWE-209; ASVS V7)
11. **Dependencies.** Do not add a dependency not named in the DIP. Any dependency the DIP does add must be pinned to an explicit version. (ASVS V14)
12. **Concurrency and state.** Where the story involves shared state or idempotency, the implementation must be safe under concurrent execution and retry — a check-then-act sequence over shared state must be atomic. (CWE-362)

**Application to this story:** Obligation 4 (Secrets) is the primary one in play: the Supabase URL/anon key must be read from environment variables only, on both platforms, satisfied by AC5's negative security check. Obligation 11 (Dependencies): every package this DIP adds (`@supabase/supabase-js`, `@supabase/ssr`, `@react-native-async-storage/async-storage`, plus whatever Next.js/Expo CLI scaffolding installs by default) is named here and must be pinned to an exact resolved version — no ranged installs. Obligation 6 (Authentication): both apps call Supabase Auth's native `signUp()` directly — no custom auth logic is written. Obligation 10 (Error handling): both registration screens show a generic failure message, never a raw Supabase/Postgres error. Obligations 1/2/3/5/7/8/9/12 are not substantively engaged by this story (no SQL, no new authorization decision, no new shared/concurrent state beyond what Story 1.1 already handles server-side) — noted for completeness, not silently skipped.

### API Contract

No new API/RPC surface — this story consumes Story 1.1's existing `supabase.auth.signUp()` and `supabase.rpc('rpc_bootstrap_household')` contract exactly as documented in `documentation/dips/DIP-1.1.md`, from two new client codebases.

### Non-Functional Requirements

*Performance:* Standard Next.js/Expo cold-start and Supabase Auth round-trip times; no story-specific target beyond what Story 1.1 already set (<300ms p95 for the RPC call itself).

*Scalability:* Not applicable — this is app scaffolding, not a data-scaling concern.

*Reliability:* Establishes the one monorepo structure every later story extends — getting the workspace/dependency setup right now avoids per-story scaffolding drift.

**Security:** ASVS chapters in scope: V6/V14 (Configuration — secrets via environment variables only, on both platforms), V14 (Dependency management — every added package pinned). Trust boundary: the Supabase anon key shipped to both client bundles is public-safe by Supabase's design (RLS is the real boundary, per ATD §4.1) but must never be joined by a `service_role` key or any other credential in client code — AC5 exists specifically to catch that class of mistake. Sensitive data handled: none directly by this story (registration's password handling is entirely Supabase Auth's, per Story 1.1). Weaknesses excluded: CWE-798 (env-var-only secret loading, verified by AC5).

### Observability

No new logging infrastructure. Registration failures surface a generic client-side message (per obligation 10); rely on Supabase's built-in Auth logs (as Story 1.1 already does) for anything requiring investigation.

### Files to Create/Modify

- `package.json` (repo root) — add `workspaces: ["apps/*"]`.
- `apps/web/` — new Next.js app (standard scaffold from `create-next-app` or equivalent, TypeScript, App Router).
- `apps/mobile/` — new Expo app (standard scaffold from `create-expo-app` or equivalent, TypeScript).
- `.gitignore` (repo root or per-app) — `.env`, `.env.local`, Expo/EAS local credential files.
- `apps/web/.env.example` — documents `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (no real values).
- Exact internal file paths within each app (component/route structure) are intent-driven per the instructions above — CC should follow each framework's own default conventions (Next.js App Router, Expo Router or React Navigation, whichever the scaffolding CLI defaults to) rather than inventing a bespoke structure.

### Migration Files

Not applicable — no schema changes in this story.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-32

1. Confirm Story 1.1 (STEW-10, PR #2) is merged to `dev` first.
2. After this PR merges, Joseph adds `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` to Vercel's Preview environment variables (scoped to `dev`), pointing at `ohhsteward-dev` (project ref `poqvothxwmjbtitqtbgh`) — values pulled via the Supabase MCP `get_project_url`/`get_publishable_keys` tools, never typed by hand.
3. Joseph adds the equivalent `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` to the Expo project's environment configuration (EAS secrets or `.env.local`, per whichever the scaffolded app uses) for local/preview builds.
4. No migration to apply — this step is manual env-var configuration only, not a merge-blocking step for CC's own PR.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** none yet exist — this story creates `apps/web` and `apps/mobile` as the components every subsequent story's "Components to extend" section refers to.

**Expected integration behavior:** every future story's web/mobile instructions (e.g., Story 1.2's "invite-send UI", Story 7.1's admin layer) now have a concrete app to extend, following whichever internal routing/component convention this story's scaffolding CLI defaults establish.

**Data flow impact:** none — no schema changes; both apps consume the existing Supabase project exactly as Story 1.1 already defined.

**Dependencies to add/update:** `@supabase/supabase-js`, `@supabase/ssr` (web only), `@react-native-async-storage/async-storage` (mobile only) — all pinned to exact resolved versions, no ranges.

**Constraints:** do not introduce Turborepo, pnpm, or any workspace tooling beyond npm workspaces. Do not build any screen beyond registration/sign-in and the empty-dashboard placeholder.

### Change Impact

- What changes: creates `apps/web` and `apps/mobile` from scratch under npm workspaces, wires both to Supabase, and implements Story 1.1's registration flow end-to-end on both platforms.
- What it touches: repo root `package.json`/`.gitignore` only (both currently minimal/nonexistent for this purpose) — no existing application code to affect.
- Breaking risk: No.

### Branch Name

`feature/1.1.G1-app-scaffolding`

### Commit Message

`1.1.G1: Scaffold web (Next.js) and mobile (Expo) apps under npm workspaces, wire Story 1.1 registration flow`

### Pull Request Description

Maps to each Acceptance Criterion:
- AC1: root `package.json` workspaces config; `npm install` at root installs both apps.
- AC2: unauthenticated visitors land on the registration/sign-in screen (web).
- AC3: web registration screen chains `signUp` → `rpc_bootstrap_household()` → empty-dashboard placeholder, completing Story 1.1's AC1/AC2/AC4 through the actual UI.
- AC4: identical flow on mobile (Expo), same Supabase project.
- AC5 (negative security): no hardcoded Supabase URL/key/credential anywhere in either app's committed source — env-var reads only.

### Jira Linkage

- PDE Story ID: 1.1.G1
- Jira Epic Key: STEW-1
- Jira Story Key: STEW-32

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-1.1.G1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary, and note that most files here are net-new (no `git diff` baseline exists for them; include full file contents instead, per the DIP's own instruction for new files).

### Confidence Assessment

- **Confidence Score:** 82
- **Reasoning:** The Supabase wiring itself is low-risk and directly reuses Story 1.1's already-implemented, already-tested backend contract. Confidence is bounded by this being the first UI work in the whole project — exact scaffolding CLI defaults (Next.js App Router conventions, Expo Router vs. React Navigation) aren't pinned down in any prior artifact, so CC has legitimate latitude on file-level structure as long as it stays inside this DIP's constraints.
- **Top Risk Areas:** Expo/React Native session persistence (AsyncStorage wiring) is the one piece with real platform-specific gotchas if done incorrectly — worth a close look in review. `@supabase/ssr` on web is being introduced ahead of the story (7.1) that actually needs server-side session reads, as a forward-compatibility choice — flagged explicitly so it doesn't read as unexplained scope.

### ⚠️ Open Questions to be Answered Before Moving Forward

None blocking — Joseph's tooling choice (npm workspaces) resolved the one open architectural decision before this DIP was drafted.
