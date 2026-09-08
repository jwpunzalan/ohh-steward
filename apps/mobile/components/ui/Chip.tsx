import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radii } from "../../theme";

type Props = Omit<PressableProps, "children" | "style"> & {
  selected?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// Story 10.1 primitive — pill-shaped, selectable filter/tag. Mirrors
// apps/web/components/ui/Chip.tsx. Tokens only.
export function Chip({ selected = false, children, style, ...rest }: Props) {
  return (
    <Pressable
      {...rest}
      style={[
        styles.base,
        {
          backgroundColor: selected ? colors.primaryTint : colors.card,
          borderColor: selected ? colors.primary : colors.border,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: selected ? colors.primaryDark : colors.textMuted },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
    alignSelf: "flex-start",
  },
  label: {
    fontFamily: "WorkSans_500Medium",
    fontSize: 13,
  },
});

export default Chip;
