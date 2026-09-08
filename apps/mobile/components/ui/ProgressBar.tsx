import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii } from "../../theme";

type Props = {
  /** 0–100. Clamped. */
  value: number;
  /** Fill colour — defaults to the on-track pacing colour. */
  color?: string;
  style?: StyleProp<ViewStyle>;
};

// Story 10.1 primitive — track/fill View pair (React Native has no native
// progress element). Mirrors apps/web/components/ui/ProgressBar.tsx; the
// default fill is the semantic on-track green.
export function ProgressBar({ value, color = colors.green, style }: Props) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={[styles.track, style]}>
      <View
        style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: "100%",
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radii.pill,
  },
});

export default ProgressBar;
