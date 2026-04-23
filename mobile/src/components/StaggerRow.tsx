import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

const BEZIER = Easing.bezier(0.25, 0.1, 0.25, 1);

interface Props {
  index: number;
  children: React.ReactNode;
  /** Stagger delay per item in ms (default 32). */
  stagger?: number;
  /** Max items to stagger before capping the delay (default 10). */
  cap?: number;
  /**
   * When true, skip entrance motion (use on full-screen modals / overlays so content
   * does not “fall in” on top of the home fade).
   */
  instant?: boolean;
}

export default function StaggerRow({ index, children, stagger = 32, cap = 10, instant = false }: Props) {
  const anim = useRef(new Animated.Value(instant ? 1 : 0)).current;

  useEffect(() => {
    if (instant) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index, cap) * stagger,
      easing: BEZIER,
      useNativeDriver: true,
    }).start();
  }, [index, anim, stagger, cap, instant]);

  if (instant) {
    return <View>{children}</View>;
  }

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
