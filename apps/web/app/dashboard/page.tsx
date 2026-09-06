import Link from "next/link";

export default function DashboardPage() {
  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Welcome to your household</h1>
      <p>
        You don&apos;t have any budgets or categories yet. This is a
        placeholder — later stories will build the real dashboard here.
      </p>
      <Link href="/dashboard/budgets/new">Create a budget</Link>
      <br />
      <Link href="/dashboard/accounts/new">Add an account</Link>
      <br />
      <Link href="/dashboard/invites/new">Invite someone to your household</Link>
      <br />
      <Link href="/dashboard/account">Account</Link>
      <br />
      <Link href="/dashboard/security">Security</Link>
    </main>
  );
}
