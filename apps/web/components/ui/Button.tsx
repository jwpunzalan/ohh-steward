"use client";

import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  children: ReactNode;
};

// Story 10.1 primitive — styled entirely from the design tokens in
// app/globals.css (no hardcoded hex). Hover/pressed handled in React state
// since these are inline styles.
export function Button({
  variant = "primary",
  children,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  onMouseUp,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  const primary: CSSProperties = {
    background:
      pressed || hover ? "var(--color-primary-dark)" : "var(--color-primary)",
    color: "var(--color-card)",
    border: "1px solid transparent",
  };
  const secondary: CSSProperties = {
    background: hover ? "var(--color-primary-tint)" : "var(--color-card)",
    color: "var(--color-primary)",
    border: "1px solid var(--color-border)",
  };

  const base: CSSProperties = {
    fontFamily: "var(--font-work-sans), system-ui, sans-serif",
    fontWeight: 600,
    fontSize: "0.95rem",
    lineHeight: 1.2,
    padding: "0.65rem 1.15rem",
    borderRadius: "var(--radius-input)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background 120ms ease",
    ...(variant === "primary" ? primary : secondary),
    ...style,
  };

  return (
    <button
      {...rest}
      disabled={disabled}
      style={base}
      onMouseEnter={(e) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHover(false);
        setPressed(false);
        onMouseLeave?.(e);
      }}
      onMouseDown={(e) => {
        setPressed(true);
        onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        setPressed(false);
        onMouseUp?.(e);
      }}
    >
      {children}
    </button>
  );
}

export default Button;
