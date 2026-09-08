import type { CSSProperties } from "react";

type Props = {
  /** 0–100. Clamped. */
  value: number;
  /** Fill colour — defaults to the on-track pacing colour. */
  color?: string;
  style?: CSSProperties;
};

// Story 10.1 primitive — track/fill pair (no native <progress>, for parity
// with the mobile View-based implementation). The default fill is the
// semantic on-track green; a caller passes an over-budget colour when the
// pacing band says so.
export function ProgressBar({
  value,
  color = "var(--color-green)",
  style,
}: Props) {
  const pct = Math.max(0, Math.min(100, value));
  const track: CSSProperties = {
    width: "100%",
    height: 10,
    borderRadius: "var(--radius-pill)",
    background: "var(--color-border)",
    overflow: "hidden",
    ...style,
  };
  const fill: CSSProperties = {
    width: `${pct}%`,
    height: "100%",
    borderRadius: "var(--radius-pill)",
    background: color,
    transition: "width 200ms ease",
  };
  return (
    <div style={track} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={fill} />
    </div>
  );
}

export default ProgressBar;
