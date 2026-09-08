// Story 7.1 — shown to an authenticated Member who tries to use the web app.
// Lives outside app/dashboard/, so the Parent sidebar shell never wraps it.
// Plain/unstyled, matching the /dashboard/security convention.
export default function MemberWebBlockedPage() {
  return (
    <main style={{ maxWidth: 420, margin: "6rem auto", padding: "0 1rem" }}>
      <h1>The web app is for parents</h1>
      <p>
        Your account is a household member. Please use the OHh Steward mobile
        app to view your budgets and add transactions.
      </p>
    </main>
  );
}
