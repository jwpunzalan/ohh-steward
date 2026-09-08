# Story 10.1 — Design System Foundation (Tokens, Typography, Shared UI Primitives)

**Review Summary Strip:** Story ID: 10.1 | Objective: Establish a reusable "warm & friendly" design system on both web and mobile, matching the approved mockup | Core Change: Color/type/spacing tokens + 5 shared UI primitive components (Button, Card, Chip, ProgressBar, IconBadge) on both platforms — no screen is reskinned by this story | Risk Level: Low | Confidence Score: 88 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As the Product Owner, I want a single, reusable design-system foundation (colors, typography, spacing, and shared UI building blocks) established on both web and mobile before any individual screen is reskinned, so that every subsequent screen story (10.2–10.5) draws from one consistent source of truth instead of each reinventing its own styling.

## Origin

This story is not a gap found while implementing another story — it is new top-level scope, authored directly from Joseph's product direction (2026-09-08): the existing UI ("designed using a typewriter," his words) does not meet the bar for a commercial app he intends to ship. A visual-direction mockup (warm/friendly, old-Mint-inspired, blue primary) was built and approved by Joseph before this DIP was drafted — the design decision itself is not invented by Atlas; it is the grounding artifact this DIP implements, the same role an ATD plays for a schema decision. Filed as Epic STEW-43, with this story and four screen-specific follow-on stories (10.2–10.5, Jira STEW-45 through STEW-48) as children. 10.2–10.5 are intentionally **not** DIP'd yet — per this pipeline's one-story-at-a-time working pattern this session, each will be grounded against the actual post-10.1 primitives and DIP'd individually once 10.1 has merged.

**Acceptance Criteria:**
1. Given the web app, when any page imports the shared tokens, then the exact color, typography, spacing, radius, and shadow values below are available as CSS custom properties on `:root`, and Nunito/Work Sans are loaded and applied as the default heading/body fonts.
2. Given the mobile app, when any screen imports `theme.ts`, then the identical color/spacing/radius values are available as plain TypeScript constants, and Nunito/Work Sans are loaded and available as font families via `expo-font`.
3. Given a developer needs a Button, Card, Chip, ProgressBar, or IconBadge on web, then a corresponding component exists under `apps/web/components/ui/` built from the tokens in AC1, matching the approved mockup's visual treatment (radii, shadow, padding, states) — not a generic/default-styled control.
4. Given a developer needs the same five primitives on mobile, then equivalent components exist under `apps/mobile/components/ui/`, matching the same visual treatment via React Native `StyleSheet`, built from `theme.ts`.
5. Given this story merges, then **no existing screen's visual output changes** — the tokens and primitives are added as new, unused-by-default building blocks; wiring them into actual screens is Stories 10.2–10.5's scope, not this one's.

**Dependencies & Assumptions:** No dependency on any other story — this is new foundational scope. Assumes Joseph's approved mockup (blue primary `#3D7BD9`, warm cream background, Nunito/Work Sans) is the source of truth for exact values, reproduced verbatim below rather than re-interpreted. Assumes the existing npm-workspaces structure (`apps/*` only, confirmed live via the root `package.json` — no `packages/*` pattern exists today) stays as-is: tokens are duplicated once per app rather than extracted into a new shared workspace package, to avoid a repo-structure change this story doesn't need — worth revisiting only if token drift between platforms becomes a real maintenance problem.

**Traceability:** PIB Problem Statement (positioning the product "for sale or handoff" already implies a commercial quality bar, never previously made concrete). New PIB/PSDD alignment note: neither document currently states a visual-design success metric — this Epic effectively adds one by direct product-owner direction, the same class of decision the multi-currency clarification (2.4.G2) already established a precedent for handling directly rather than blocking on a formal PIB revision. Originating: none (new top-level Epic, STEW-43).

**Change Impact:**
- What changes: New token files (`globals.css` additions on web, new `theme.ts` on mobile), two new Google-Fonts font loads, ten new UI-primitive component files (5 per platform), one new mobile dependency set (`expo-font` + two `@expo-google-fonts` packages).
- What it touches: `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, new `apps/web/components/ui/*`; new `apps/mobile/theme.ts`, new `apps/mobile/components/ui/*`, `apps/mobile/package.json`, `apps/mobile/App.tsx` (font-loading gate only).
- Breaking risk: No — purely additive; nothing existing imports or renders any of this yet (AC5).

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement exactly the tokens and five primitives specified below, on both platforms, matching the approved mockup's values verbatim. Do NOT implement: any change to an existing screen/page/component's rendered output (AC5 — this is foundation-only); a shared `packages/` workspace for tokens (see Dependencies & Assumptions — out of scope, not needed yet); a full icon-library abstraction (IconBadge accepts a passed-in icon element as a child/prop — the actual icon SVGs belong to whichever screen story uses them, per Story 10.2–10.5); Tailwind CSS or any other new web styling framework (CSS custom properties in the existing `globals.css` are sufficient and add zero new dependencies); any navigation library on mobile (unrelated to this story and separately constrained by Story 1.1.G1's DIP).

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (adding CSS custom properties, a new TS constants file, and new unused component files has no runtime side effect on any existing screen) | Reason: Purely additive, no data layer, no auth/authorization surface touched at all — the lowest-risk category of story in this backlog.

Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

**Standing Rule scope clarification:** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

---

### Story Summary

Establishes the approved warm/friendly, blue-primary design system as reusable infrastructure on both platforms before any screen is touched. Web gets CSS custom properties (no new dependency — `next/font/google` already ships with Next.js) and a small `components/ui/` primitive set; mobile gets an equivalent `theme.ts` plus matching primitives, with `expo-font` and two `@expo-google-fonts` packages as the only new dependencies (unavoidable — React Native has no built-in custom-font loading). Nothing existing renders differently after this story merges; Stories 10.2–10.5 do the actual reskinning, one screen area at a time, against this now-established foundation.

### Repo Target

`apps/web` (Next.js — new files under `components/ui/`, additions to `app/globals.css` and `app/layout.tsx`) and `apps/mobile` (Expo — new `theme.ts` and `components/ui/`, a font-loading gate added to `App.tsx`, two new dependency entries in `package.json`). No Supabase/migration surface at all.

### Grounding Check

**Verified live this session:** root `package.json`'s `workspaces` field is `["apps/*"]` only — confirmed via direct read of the `dev` branch, not assumed from any spec. No `packages/*` directory or workspace pattern exists. `apps/web/app/globals.css` and `apps/web/app/layout.tsx` both exist today (standard Next.js App Router scaffolding from Story 1.1.G1). `apps/web/package.json` has no Tailwind/PostCSS config and no CSS framework dependency — confirmed via direct read. `apps/mobile/App.tsx` is 2,157 lines, a single-file `Screen` string-union state machine (confirmed this session) — this story adds a font-loading gate to it (a `useFonts()` check before rendering, matching the Expo-recommended pattern) but does not otherwise restructure it. `apps/mobile/package.json` has no `expo-font`, no `@expo-google-fonts/*`, and no `react-native-svg` — confirmed via direct read; the first two are added by this story, the third is deliberately deferred to whichever of Stories 10.2–10.5 first needs to render an actual icon on mobile (Do NOT implement list), since this story's IconBadge primitive only needs to accept an already-rendered icon element as a child, not render one itself.

**Trust boundary:** none. This story introduces zero user input, zero data reads/writes, and zero new API/RPC surface — it is presentational-only. The Secure Coding Baseline below is reproduced per §7 rule 14's mandatory-in-every-DIP requirement, with an honest "mostly not applicable" Application note rather than a padded one.

**Design values (source of truth — reproduced verbatim from Joseph's approved mockup, not re-interpreted):**

```
Color tokens
  --color-bg:            #FBF3E7   (warm cream, page background)
  --color-card:          #FFFDF9   (card/surface background)
  --color-text:           #3A2E22   (primary text)
  --color-text-muted:     #8B7A67   (secondary text)
  --color-border:         #EFE2CE
  --color-primary:        #3D7BD9   (blue — buttons, active states, logo mark)
  --color-primary-dark:   #2C64B8   (hover/pressed)
  --color-primary-tint:   #DDE9FB   (light badge backgrounds on primary-associated elements)
  --color-coral:          #F2795C   (category accent — e.g. Groceries)
  --color-gold:           #F0B429   (category accent — e.g. Dining, savings)
  --color-lavender:       #9B87F5   (category accent — e.g. Entertainment)
  --color-slate:          #5B6B8C   (category accent — e.g. Transportation; bg tint #E7EAF2)
  --color-sage:           #6FA287   (category accent — e.g. Utilities)
  --color-green:          #4CAF7D   (semantic — on-track / good pacing band; NEVER reused as a brand/decorative color)
  --color-amber:          #F2B84B   (semantic — warning pacing band)
  --color-red:            #E8735A   (semantic — over-budget pacing band; a soft coral-red, not a harsh pure red)

Typography
  Headings / numeric figures: 'Nunito', system-ui, sans-serif — weights 700/800
  Body / labels / inputs:     'Work Sans', system-ui, sans-serif — weights 400/500/600

Spacing & shape
  Card radius:      20px (web) / 18px (mobile)
  Input/chip radius: 13–16px
  Pill radius:       999px (fully rounded)
  Card shadow:       0 8px 24px rgba(58,46,34,0.08)  [web]  /  0 8px 20px rgba(58,46,34,0.10)  [mobile]
```

**Semantic vs. brand color — explicit rule for this and every downstream 10.x story:** `--color-green` / `--color-amber` / `--color-red` are reserved exclusively for pacing-band meaning (on-track / warning / over-budget, per Story 6.2's already-shipped thresholds) and must never be reused as a decorative or category accent color, even if a hue would otherwise look fine there — conflating "this category happens to be green" with "this category is on-track" is a real usability regression the mockup review already caught once (Transportation was originally sharing the same teal as the primary/Checking-account accent and had to be split out — Do NOT repeat that mistake with the semantic colors).

### Acceptance Criteria

(Restated verbatim from the story — §7 rule 15.)

1. Given the web app, when any page imports the shared tokens, then the exact color, typography, spacing, radius, and shadow values above are available as CSS custom properties on `:root`, and Nunito/Work Sans are loaded and applied as the default heading/body fonts.
2. Given the mobile app, when any screen imports `theme.ts`, then the identical color/spacing/radius values are available as plain TypeScript constants, and Nunito/Work Sans are loaded and available as font families via `expo-font`.
3. Given a developer needs a Button, Card, Chip, ProgressBar, or IconBadge on web, then a corresponding component exists under `apps/web/components/ui/` built from the tokens in AC1, matching the approved mockup's visual treatment (radii, shadow, padding, states) — not a generic/default-styled control.
4. Given a developer needs the same five primitives on mobile, then equivalent components exist under `apps/mobile/components/ui/`, matching the same visual treatment via React Native `StyleSheet`, built from `theme.ts`.
5. Given this story merges, then no existing screen's visual output changes — the tokens and primitives are added as new, unused-by-default building blocks; wiring them into actual screens is Stories 10.2–10.5's scope, not this one's.
6. **(Negative/scope-boundary AC)** Given this story's completion report, when reviewed, then `git diff dev [branch] -- apps/web/app/dashboard apps/web/app/page.tsx apps/mobile/App.tsx` (excluding the font-loading-gate hunk explicitly required by AC2) shows no change to any existing screen's JSX/markup or rendered styling — proving AC5 by inspection, not by assertion.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Do NOT change any existing screen's rendered output, JSX, or imports (AC5/AC6) — this story adds new, unimported-by-default files only.
   - Do NOT introduce Tailwind, styled-components, or any other CSS framework/library on web — plain CSS custom properties in the existing `globals.css` satisfy AC1 with zero new dependencies.
   - Do NOT create a shared `packages/` workspace — tokens are duplicated once per app per the Dependencies & Assumptions note above.
   - Do NOT build a general icon library or icon component — `IconBadge` accepts an already-rendered icon as a child/prop; actual icon SVGs are each screen story's own concern.
   - Do NOT add `react-native-svg` in this story — deferred to the first of Stories 10.2–10.5 that actually renders an icon on mobile.
   - Do NOT reuse `--color-green`/`--color-amber`/`--color-red` for anything other than pacing-band semantics (see Grounding Check).
   - Do NOT add any navigation library to mobile — unrelated to this story, separately constrained by Story 1.1.G1.
4. **Web — tokens:** append a new `:root { ... }` block to `apps/web/app/globals.css` containing every CSS custom property listed in the Grounding Check's "Design values" block above, using the `--color-*` naming shown. Do not touch any other rule already in that file.
5. **Web — fonts:** in `apps/web/app/layout.tsx`, import `Nunito` and `Work_Sans` from `next/font/google` (already available — `next` is already a dependency, `next/font/google` adds no new package), each with `subsets: ['latin']`, `weight` covering the ranges in the Grounding Check block, and a `variable` (`--font-nunito`, `--font-work-sans`). Apply both variable classNames to the root `<html>` or `<body>` element alongside whatever className is already there — do not remove or replace the existing className, append to it. Add `font-family: var(--font-work-sans), system-ui, sans-serif;` as the `body` rule's font-family in `globals.css` (headings/numeric figures use `var(--font-nunito)` explicitly per-component, not globally).
6. **Web — primitives:** create `apps/web/components/ui/Button.tsx`, `Card.tsx`, `Chip.tsx`, `ProgressBar.tsx`, `IconBadge.tsx` — each a small, typed React function component accepting the minimal props implied by the mockup (e.g. `Button`: `variant?: 'primary' | 'secondary'`, `children`, `onClick?`, standard button attrs; `ProgressBar`: `value: number` 0–100, `color?: string` defaulting to `--color-green`; `Chip`: `selected?: boolean`, `children`; `IconBadge`: `background: string`, `children` for the icon element). Style every one from the CSS custom properties in step 4 — no hardcoded hex values inside any primitive.
7. **Mobile — tokens:** create `apps/mobile/theme.ts` exporting a single default-exported (or named, developer's reasonable choice) object with `colors`, `spacing`, `radii`, and `shadow` keys mirroring the web tokens' values exactly (same hex, same radii/shadow numbers per the mobile-specific shadow value in the Grounding Check block).
8. **Mobile — fonts:** add `expo-font`, `@expo-google-fonts/nunito`, `@expo-google-fonts/work-sans` to `apps/mobile/package.json`, each pinned to the latest version compatible with the already-pinned `expo ~57.0.20` (resolve the exact compatible version via `npx expo install expo-font @expo-google-fonts/nunito @expo-google-fonts/work-sans` locally, then pin what it resolves — do not guess a version number). In `apps/mobile/App.tsx`, add a `useFonts()` call (from `expo-font`, loading `Nunito_700Bold`, `Nunito_800ExtraBold`, `WorkSans_400Regular`, `WorkSans_500Medium`, `WorkSans_600SemiBold`) near the top of the root component; while fonts are loading, render nothing but a plain `View` with the same `--color-bg` background (no spinner needed — this is a sub-second load) instead of the app's normal content; once loaded, render exactly what already renders today. This is the only change this story makes to `App.tsx`.
9. **Mobile — primitives:** create `apps/mobile/components/ui/Button.tsx`, `Card.tsx`, `Chip.tsx`, `ProgressBar.tsx`, `IconBadge.tsx` — React Native function components with the same prop shapes as their web counterparts (step 6), styled via `StyleSheet.create()` referencing `theme.ts` from step 7. `ProgressBar` renders as a `View`-based track/fill pair (React Native has no native `<progress>` element). No hardcoded hex values inside any primitive.

### Code Requirements

This story is presentational-only — there is no SQL, no RPC, no migration. The "code" here is the token/primitive scaffolding specified in Implementation Instructions 4–9 above; no additional snippet is prescribed beyond those instructions, since the exact component prop shapes are an implementation judgment call within the stated constraints (Do NOT implement list), not a fixed contract CC must copy verbatim.

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL supplied in a DIP — any SQL supplied here is either parameterized or a one-time DDL/migration statement with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
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

**Application to this story:** Obligations 1–3, 6–10, and 12 do not apply — this story has no SQL, no server-side logic, no authentication surface, no error paths, and no shared/concurrent state; it is static presentational scaffolding. Obligation 11 (dependencies) is the one obligation that genuinely bites here: exactly three new dependencies are named (`expo-font`, `@expo-google-fonts/nunito`, `@expo-google-fonts/work-sans`), each must be pinned to the exact version `npx expo install` resolves (Implementation Instruction 8) rather than a floating range, and no dependency beyond those three (`react-native-svg` explicitly included) may be added by this story. Obligation 4/5 (secrets/logging) are trivially satisfied by having nothing to log or hardcode — no external service, API key, or credential of any kind is touched.

### API Contract

Not applicable — no API/RPC surface in this story.

### Non-Functional Requirements

**Performance:** Google Fonts loaded via `next/font/google` are self-hosted and inlined by Next.js's build step (no runtime request to Google's font CDN, no layout shift) — this is why `next/font/google` was chosen over a plain `<link>` tag. On mobile, `expo-font`'s `useFonts()` load is a one-time, sub-second asset load on app start; the brief blank-background gate in Implementation Instruction 8 avoids a flash-of-unstyled-text without adding a real perceived-loading delay.

**Scalability:** Not applicable — no data layer, no per-request cost of any kind.

**Reliability:** Because AC5/AC6 guarantee zero existing-screen change, this story cannot regress any already-shipped, already-tested behavior — the only way it could "fail" is if a later story (10.2–10.5) misuses the primitives, which is that story's own review responsibility, not this one's.

**Security:** ASVS chapters in scope: none directly — this is presentational-only, as detailed in the Code Requirements Application note above. Trust boundary: none opened by this story. Sensitive data: none handled. Weaknesses excluded: not applicable (no injection surface, no auth surface, no data handling).

### Observability

None needed — no server-side logic, no error paths beyond what React/React Native already surface to the developer console during local development. Nothing here is deployed as a runtime service to monitor.

### Files to Create/Modify

- `apps/web/app/globals.css` — append the `:root` token block (Implementation Instruction 4).
- `apps/web/app/layout.tsx` — add the two `next/font/google` imports and apply their variable classNames (Implementation Instruction 5).
- `apps/web/components/ui/Button.tsx`, `Card.tsx`, `Chip.tsx`, `ProgressBar.tsx`, `IconBadge.tsx` — new files (Implementation Instruction 6).
- `apps/mobile/theme.ts` — new file (Implementation Instruction 7).
- `apps/mobile/package.json` — add the three new dependencies, pinned (Implementation Instruction 8).
- `apps/mobile/App.tsx` — add the font-loading gate only; no other change (Implementation Instruction 8).
- `apps/mobile/components/ui/Button.tsx`, `Card.tsx`, `Chip.tsx`, `ProgressBar.tsx`, `IconBadge.tsx` — new files (Implementation Instruction 9).

### Migration Files

Not applicable — no database change in this story.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-44

1. No migration to apply — this is a pure application-code change. Standard local build/typecheck (`npm run build` for web, `npx tsc --noEmit` or the mobile app's existing typecheck script if one exists) is the only local validation needed before opening the PR.
2. After merge, visually confirm on a local run of both apps that no existing screen's appearance changed (AC5) — the new tokens/primitives/fonts are present in the bundle but not yet imported by anything.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** none — this story creates new files only, plus the two narrowly-scoped additions named above (`globals.css`'s new `:root` block, `layout.tsx`'s font imports, `App.tsx`'s font-loading gate).

**Expected integration behavior:** the new tokens and primitives sit unused until Stories 10.2–10.5 import them screen-by-screen. No client polls, triggers, or otherwise depends on this story beyond a normal import.

**Data flow impact:** none — no data layer touched.

**Dependencies to add/update:** `expo-font`, `@expo-google-fonts/nunito`, `@expo-google-fonts/work-sans` (mobile only, each pinned per Implementation Instruction 8). No web dependency changes.

**Constraints:** must not alter any existing screen's rendered output (AC5/AC6); must not introduce `packages/*` workspace restructuring, Tailwind, or `react-native-svg` (Do NOT implement list).

### Change Impact

- What changes: New CSS tokens and font loading on web; new `theme.ts`, font loading, and three new pinned dependencies on mobile; five new, currently-unused UI primitive components per platform.
- What it touches: `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, new `apps/web/components/ui/*`; `apps/mobile/App.tsx` (font-gate only), `apps/mobile/package.json`, new `apps/mobile/theme.ts`, new `apps/mobile/components/ui/*`.
- Breaking risk: No.

### Branch Name

feature/10.1-design-system-foundation

### Commit Message

10.1: Add warm/friendly design-system foundation — tokens, typography, shared UI primitives (web + mobile)

### Pull Request Description

Implements Story 10.1 (STEW-44): establishes the design-system foundation Joseph approved via mockup on 2026-09-08 (warm/friendly, blue primary `#3D7BD9`, Nunito/Work Sans) as reusable tokens and five shared UI primitives (Button, Card, Chip, ProgressBar, IconBadge) on both web and mobile — AC1–AC4. AC5/AC6: this PR changes zero existing screens; `git diff` against every current screen file shows no change outside the two narrowly-scoped font-loading additions named in Implementation Instructions 5 and 8. Sets up Stories 10.2–10.5 (STEW-45 through STEW-48) to reskin Dashboard/Accounts and Add Transaction/forms on each platform against this shared foundation, one screen area at a time.

### Jira Linkage

- PDE Story ID: 10.1
- Jira Epic Key: STEW-43
- Jira Story Key: STEW-44

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-10.1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file created or modified in the completion report — not a summary. Include `git diff dev [branch] -- apps/web/app/dashboard apps/web/app/page.tsx apps/mobile/App.tsx` showing only the font-loading-gate hunk in `App.tsx` and zero output elsewhere, as explicit proof of AC5/AC6.

### Confidence Assessment

- **Confidence Score:** 88/100
- **Reasoning:** This is the lowest-risk category of story in the backlog — no data layer, no auth surface, and AC5/AC6 make "did this story stay in scope" mechanically checkable via `git diff` rather than a judgment call. The exact token values were pulled directly from the approved mockup rather than re-derived, removing the main source of ambiguity a design-system story usually carries. The score isn't higher only because the mobile font-pinning step (Implementation Instruction 8) genuinely requires running `npx expo install` locally to resolve compatible versions rather than being fully specifiable in this DIP — a reasonable, bounded judgment call, not an open question.
- **Top Risk Areas:**
  1. `expo-font`/`@expo-google-fonts/*` version compatibility with the already-pinned Expo SDK 57 — mitigated by requiring `npx expo install` (which resolves SDK-compatible versions) rather than a guessed version number.
  2. The temptation to "just also fix" one existing screen while building the primitives, since the developer will be looking at them anyway — AC5/AC6 and the mandatory `git diff` proof exist specifically to catch this.
  3. Primitive prop-shape decisions (exact prop names) are left to implementation judgment within stated constraints — worth a quick look during Stories 10.2's grounding to confirm the primitives actually fit real screen usage before that story is DIP'd, rather than assuming they will.

### ⚠️ Open Questions to be Answered Before Moving Forward

None — the one open technical question (shared `packages/` workspace vs. per-app duplication) was resolved in the Dependencies & Assumptions note above by choosing the lower-risk, no-repo-restructuring option, consistent with this project's established preference (plain npm workspaces, no Turborepo/pnpm, per Story 1.1.G1) for minimal new tooling.
