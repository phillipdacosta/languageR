import React, { useEffect, useRef } from 'react';
import { LayoutChangeEvent } from 'react-native';
import { BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const TAB_BAR_FALLBACK_HEIGHT = 88;

type Props = BottomTabBarProps & {
  homeOverlayCoversTabBar: boolean;
  lessonOverlayCoversTabBar: boolean;
  screenHidesTabBar: boolean;
};

export default function SlidingTabBar({ homeOverlayCoversTabBar, lessonOverlayCoversTabBar, screenHidesTabBar, ...props }: Props) {
  const measuredHeight = useSharedValue(TAB_BAR_FALLBACK_HEIGHT);
  const clipHeight = useSharedValue(TAB_BAR_FALLBACK_HEIGHT);
  const translateY = useSharedValue(0);
  const wasCovered = useRef(false);

  const anyCovered = homeOverlayCoversTabBar || lessonOverlayCoversTabBar || screenHidesTabBar;

  const onBarLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) {
      measuredHeight.value = h;
    }
  };

  useEffect(() => {
    if (anyCovered) {
      wasCovered.current = true;
      translateY.value = withTiming(18, { duration: 200, easing: Easing.in(Easing.cubic) });
      clipHeight.value = withTiming(0, { duration: 240, easing: Easing.in(Easing.cubic) });
      return;
    }

    const shouldAnimateIn = wasCovered.current;
    wasCovered.current = false;
    const targetH = measuredHeight.value;

    if (shouldAnimateIn && targetH > 0) {
      translateY.value = 14;
      clipHeight.value = 0;
      const timing = {
        duration: 420,
        easing: Easing.out(Easing.cubic),
      };
      clipHeight.value = withDelay(110, withTiming(targetH, timing));
      translateY.value = withDelay(110, withTiming(0, timing));
    } else {
      clipHeight.value = targetH > 0 ? targetH : TAB_BAR_FALLBACK_HEIGHT;
      translateY.value = 0;
    }
  }, [anyCovered]);

  const clipStyle = useAnimatedStyle(() => ({
    height: clipHeight.value,
    overflow: 'hidden' as const,
  }));

  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={clipStyle}>
      <Animated.View style={innerStyle} onLayout={onBarLayout}>
        <BottomTabBar {...props} />
      </Animated.View>
    </Animated.View>
  );
}
