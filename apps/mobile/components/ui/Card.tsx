import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii, shadow, spacing } from "../../theme";

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// Story 10.1 primitive — surface container. Radius / shadow / border / bg from
// theme.ts, mirroring apps/web/components/ui/Card.tsx.
export function Card({ children, style }: Props) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadow,
  },
});

export default Card;
