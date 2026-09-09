"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Story 10.2.G1 — the persistent left sidebar shell. Every route under
// apps/web/app/dashboard/ is automatically wrapped by this layout; each page's
// own inner content is untouched. Presentation/routing chrome only — no data
// fetching, no Budget/Period state (that stays owned by dashboard/page.tsx).

const svg = (): CSSProperties => ({ width: 18, height: 18 });
const ic = () => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  style: svg(),
});

function HomeIcon() {
  return (
    <svg {...ic()}>
      <path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg {...ic()}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
function PlusCircleIcon() {
  return (
    <svg {...ic()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}
function FolderPlusIcon() {
  return (
    <svg {...ic()}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}
function WalletPlusIcon() {
  return (
    <svg {...ic()}>
      <path d="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h9" />
      <path d="M18 14v6M15 17h6" />
    </svg>
  );
}
function UserPlusIcon() {
  return (
    <svg {...ic()}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M18 9v6M15 12h6" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...ic()}>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
      <path d="M9.5 12l1.7 1.7L15 10" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg {...ic()}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg {...ic()}>
      <path d="M20 12l-8 8-9-9V4h7z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg {...ic()}>
      <path d="M4 20V4M4 20h16M8 16v-4M13 16V8M18 16v-7" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg {...ic()}>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4" />
    </svg>
  );
}

type NavItem = { href: string; label: string; icon: ReactNode };

// AC2: exactly the eight real, currently-reachable destinations. "Dashboard"
// is new (the shared shell now needs a way back). No "Accounts" or
// "Categories" — those routes don't exist yet (future stories add them here).
const CORE: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <HomeIcon /> },
  { href: "/dashboard/transactions", label: "Transactions", icon: <ListIcon /> },
  {
    href: "/dashboard/transactions/new",
    label: "Add Transaction",
    icon: <PlusCircleIcon />,
  },
];
const SETUP: NavItem[] = [
  { href: "/dashboard/categories", label: "Categories", icon: <TagIcon /> },
  { href: "/dashboard/budgets/new", label: "New Budget", icon: <FolderPlusIcon /> },
  { href: "/dashboard/accounts/new", label: "New Account", icon: <WalletPlusIcon /> },
  { href: "/dashboard/invites/new", label: "Invite", icon: <UserPlusIcon /> },
  { href: "/dashboard/security", label: "Security", icon: <ShieldIcon /> },
  { href: "/dashboard/account", label: "Account", icon: <UserIcon /> },
  { href: "/dashboard/reports", label: "Reports", icon: <ChartIcon /> },
  { href: "/dashboard/audit-log", label: "Audit Log", icon: <ClipboardIcon /> },
];
const ALL_ITEMS = [...CORE, ...SETUP];

const itemBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.65rem",
  padding: "0.5rem 0.7rem",
  borderRadius: "var(--radius-input)",
  fontFamily: "var(--font-work-sans), system-ui, sans-serif",
  fontSize: "0.9rem",
  fontWeight: 500,
  color: "var(--color-text-muted)",
};

function NavList({ items, activeHref }: { items: NavItem[]; activeHref: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              ...itemBase,
              background: active ? "var(--color-primary-tint)" : "transparent",
              color: active
                ? "var(--color-primary-dark)"
                : "var(--color-text-muted)",
              fontWeight: active ? 600 : 500,
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";

  // Most-specific match wins, so /dashboard/transactions/new doesn't also
  // light up "Transactions" (AC3 / Instruction 4).
  const activeHref =
    ALL_ITEMS.map((i) => i.href)
      .filter((h) =>
        h === "/dashboard"
          ? pathname === "/dashboard"
          : pathname === h || pathname.startsWith(h + "/"),
      )
      .sort((a, b) => b.length - a.length)[0] ?? "";

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          background: "var(--color-bg)",
          borderRight: "1px solid var(--color-border)",
          padding: "1.25rem 0.85rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        <Link
          href="/dashboard"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            padding: "0 0.3rem",
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-input)",
              background: "var(--color-primary)",
              color: "var(--color-card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <HomeIcon />
          </span>
          <span
            style={{
              fontFamily: "var(--font-nunito), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: "19px",
              color: "var(--color-text)",
            }}
          >
            Steward
          </span>
        </Link>

        <nav style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <NavList items={CORE} activeHref={activeHref} />
          <div style={{ height: 1, background: "var(--color-border)", margin: "0 0.3rem" }} />
          <NavList items={SETUP} activeHref={activeHref} />
        </nav>
      </aside>

      <div style={{ flexGrow: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
