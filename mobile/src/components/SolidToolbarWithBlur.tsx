import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

const BLUR_H = 12;

export const TOOLBAR_SOLID_MIN_HEIGHT = 44;
export const TOOLBAR_BLUR_HEIGHT = BLUR_H;
/** Solid bar + frosted bottom edge — use for hero / scroll padding math */
export const TOOLBAR_TOTAL_CHROME_HEIGHT = TOOLBAR_SOLID_MIN_HEIGHT + BLUR_H;

type Props = {
  isDark: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Solid white (light) / black (dark) toolbar with a blurred strip along the bottom edge.
 */
export function SolidToolbarWithBlur({ isDark, children, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.solid, { backgroundColor: isDark ? '#000000' : '#FFFFFF' }]}>{children}</View>
      <BlurView intensity={55} tint={isDark ? 'dark' : 'light'} style={styles.blurStrip} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    overflow: 'hidden',
  },
  solid: {
    width: '100%',
  },
  blurStrip: {
    height: BLUR_H,
    width: '100%',
  },
});
