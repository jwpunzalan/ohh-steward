import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { radii } from "../../theme";

type Props = {
  /** Badge background — typically a category accent from theme.ts colours. */
  background: string;
  /** The already-rendered icon element. This primitive owns no icon library. */
  children: ReactNode;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

// Story 10.1 primitive — a rounded, tinted container for an icon. The icon
// itself belongs to whichever screen story uses it (Stories 10.2–10.5).
// Mirrors apps/web/components/ui/IconBadge.tsx.
export function IconBadge({ background, children, size = 40, style }: Props) {
  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, backgroundColor: background },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.input,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default IconBadge;
