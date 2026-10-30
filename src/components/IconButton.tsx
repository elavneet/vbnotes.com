import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  /** Sits on a round surface chip instead of bare. */
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  label: string;
  disabled?: boolean;
  active?: boolean;
};

/** A 44pt round touch target around one Ionicons glyph. */
export function IconButton({ name, onPress, size = 22, color, filled, style, label, disabled, active }: Props) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        (filled || active) && { backgroundColor: active ? t.colors.surface2 : t.colors.surface },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={color ?? (active ? t.colors.text : t.colors.textSecondary)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 22 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.3 },
});
