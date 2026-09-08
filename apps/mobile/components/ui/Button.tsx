import { useState, type ReactNode } from "react";
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
  variant?: "primary" | "secondary";
  children: ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Story 10.1 primitive — mirrors apps/web/components/ui/Button.tsx. Styled from
// theme.ts (no hardcoded hex). Pressed state via Pressable's own callback.
export function Button({
  variant = "primary",
  children,
  disabled,
  style,
  ...rest
}: Props) {
  const [pressed, setPressed] = useState(false);
  const isPrimary = variant === "primary";

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.base,
        isPrimary
          ? {
              backgroundColor: pressed ? colors.primaryDark : colors.primary,
              borderColor: "transparent",
            }
          : {
              backgroundColor: pressed ? colors.primaryTint : colors.card,
              borderColor: colors.border,
            },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: isPrimary ? colors.card : colors.primary },
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
    borderRadius: radii.input,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: "WorkSans_600SemiBold",
    fontSize: 15,
  },
  disabled: {
    opacity: 0.5,
  },
});

export default Button;
