import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
  /** Pass the theme colors object to auto-switch light/dark base color. */
  colors?: any;
}

/**
 * Shimmer skeleton block.
 * Replaces the static gray skeleton boxes with a left-to-right shimmer sweep,
 * matching the Airbnb "content loading" motion language.
 */
export default function ShimmerSkeleton({ width, height, borderRadius, style, colors }: Props) {
  const shimmer = useRef(new Animated.Value(0)).current;
  const isDark = colors?.isDark ?? false;
  const baseColor = isDark ? '#2a2a2e' : '#ebebeb';
  const highlightColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.6)';
  const numWidth = typeof width === 'number' ? width : 200;

  useEffect(() => {
    shimmer.setValue(0);
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1300,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const translateX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-numWidth, numWidth * 1.5],
  });

  const r = borderRadius ?? Math.min(height / 2, 10);

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: r,
          backgroundColor: baseColor,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}
      >
        <LinearGradient
          colors={['transparent', highlightColor, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}
