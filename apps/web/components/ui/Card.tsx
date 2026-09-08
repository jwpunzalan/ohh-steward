import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

// Story 10.1 primitive — surface container. Radius / shadow / border / bg all
// from the design tokens in app/globals.css.
export function Card({ children, style, ...rest }: Props) {
  const base: CSSProperties = {
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-card)",
    boxShadow: "var(--shadow-card)",
    padding: "1.25rem",
    color: "var(--color-text)",
    ...style,
  };
  return (
    <div {...rest} style={base}>
      {children}
    </div>
  );
}

export default Card;
