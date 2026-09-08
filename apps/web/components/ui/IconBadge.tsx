import type { CSSProperties, ReactNode } from "react";

type Props = {
  /** Badge background — typically a category accent token, e.g. "var(--color-coral)". */
  background: string;
  /** The already-rendered icon element. This primitive does not own an icon library. */
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
};

// Story 10.1 primitive — a rounded, tinted container for an icon. The icon SVG
// itself belongs to whichever screen story uses it (Stories 10.2–10.5); this
// only provides the coloured chip around it.
export function IconBadge({ background, children, size = 40, style }: Props) {
  const base: CSSProperties = {
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-input)",
    background,
    color: "var(--color-card)",
    flexShrink: 0,
    ...style,
  };
  return <span style={base}>{children}</span>;
}

export default IconBadge;
