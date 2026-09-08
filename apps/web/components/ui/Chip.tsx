"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  children: ReactNode;
};

// Story 10.1 primitive — a pill-shaped, selectable filter/tag. Selected state
// uses the primary tint; unselected sits on the card surface. Tokens only.
export function Chip({ selected = false, children, style, ...rest }: Props) {
  const base: CSSProperties = {
    fontFamily: "var(--font-work-sans), system-ui, sans-serif",
    fontWeight: 500,
    fontSize: "0.85rem",
    lineHeight: 1.2,
    padding: "0.35rem 0.8rem",
    borderRadius: "var(--radius-pill)",
    cursor: "pointer",
    background: selected
      ? "var(--color-primary-tint)"
      : "var(--color-card)",
    color: selected ? "var(--color-primary-dark)" : "var(--color-text-muted)",
    border: `1px solid ${
      selected ? "var(--color-primary)" : "var(--color-border)"
    }`,
    ...style,
  };
  return (
    <button type="button" {...rest} style={base}>
      {children}
    </button>
  );
}

export default Chip;
