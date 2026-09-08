/**
 * Story 10.1 — Design System Foundation (mobile).
 * "Warm & friendly", blue-primary. Values verbatim from Joseph's approved
 * mockup (2026-09-08), mirroring apps/web/app/globals.css exactly (same hex;
 * mobile-specific radii/shadow per the DIP).
 *
 * `colors.green` / `colors.amber` / `colors.red` are RESERVED for pacing-band
 * semantics (Story 6.2) — never a decorative or category-accent colour.
 */
export const colors = {
  bg: "#FBF3E7",
  card: "#FFFDF9",
  text: "#3A2E22",
  textMuted: "#8B7A67",
  border: "#EFE2CE",

  primary: "#3D7BD9",
  primaryDark: "#2C64B8",
  primaryTint: "#DDE9FB",

  coral: "#F2795C",
  gold: "#F0B429",
  lavender: "#9B87F5",
  slate: "#5B6B8C",
  slateTint: "#E7EAF2",
  sage: "#6FA287",

  green: "#4CAF7D",
  amber: "#F2B84B",
  red: "#E8735A",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  card: 18,
  input: 14,
  pill: 999,
} as const;

// Card shadow: 0 8px 20px rgba(58,46,34,0.10). RN needs the iOS shadow* props
// and an Android elevation fallback.
export const shadow = {
  shadowColor: "#3A2E22",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.1,
  shadowRadius: 20,
  elevation: 6,
} as const;

export const fonts = {
  headingBold: "Nunito_700Bold",
  headingExtraBold: "Nunito_800ExtraBold",
  bodyRegular: "WorkSans_400Regular",
  bodyMedium: "WorkSans_500Medium",
  bodySemiBold: "WorkSans_600SemiBold",
} as const;

const theme = { colors, spacing, radii, shadow, fonts };
export default theme;
