import { useEffect, useRef } from 'react';
import { Animated, Easing, AccessibilityInfo } from 'react-native';

/** Cubic-bezier that matches the web pop-float: overshoot then settle. */
const POP_BEZIER = Easing.bezier(0.34, 1.56, 0.64, 1);

export interface SpringPopOptions {
  /** Delay before the animation begins (ms). Default 500. */
  delay?: number;
  /** Scale to overshoot to on the way up. Default 1.10. */
  overshoot?: number;
  /** translateY at the overshoot peak (negative = up). Default -6. */
  translateYPeak?: number;
  /**
   * When false the element is instantly shown at its final state (no animation).
   * Useful for conditional elements — pass false when the element shouldn't pop
   * (e.g. join button when !canJoin).
   */
  enabled?: boolean;
}

export interface SpringPopAnimValues {
  opacity: Animated.Value;
  scale: Animated.Value;
  translateY: Animated.Value;
}

/**
 * Deferred spring-pop attention animation.
 *
 * After `delay` ms the wrapped element pops up from slightly below,
 * overshoots its natural size, then settles — identical to the
 * `UpNextTrialBadge` bounce used on the home Up Next card.
 *
 * Usage:
 *   const pop = useSpringPopAnim({ delay: 600, enabled: canJoin });
 *   <Animated.View style={{ opacity: pop.opacity, transform: [{ scale: pop.scale }, { translateY: pop.translateY }] }}>
 *     ...children
 *   </Animated.View>
 */
export function useSpringPopAnim(options: SpringPopOptions = {}): SpringPopAnimValues {
  const {
    delay = 500,
    overshoot = 1.10,
    translateYPeak = -6,
    enabled = true,
  } = options;

  const opacity = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  const scale = useRef(new Animated.Value(enabled ? 0.4 : 1)).current;
  const translateY = useRef(new Animated.Value(enabled ? 12 : 0)).current;

  useEffect(() => {
    if (!enabled) {
      opacity.setValue(1);
      scale.setValue(1);
      translateY.setValue(0);
      return;
    }

    opacity.setValue(0);
    scale.setValue(0.4);
    translateY.setValue(12);

    let cancelled = false;
    let running: Animated.CompositeAnimation | null = null;
    const native = { useNativeDriver: true as const };

    const skipToEnd = () => {
      opacity.setValue(1);
      scale.setValue(1);
      translateY.setValue(0);
    };

    AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (cancelled) return;
      if (reduce) { skipToEnd(); return; }

      running = Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), ...native }),
          Animated.timing(scale, { toValue: overshoot, duration: 280, easing: POP_BEZIER, ...native }),
          Animated.timing(translateY, { toValue: translateYPeak, duration: 280, easing: POP_BEZIER, ...native }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 0.96, duration: 175, easing: Easing.inOut(Easing.quad), ...native }),
          Animated.timing(translateY, { toValue: 2, duration: 175, easing: Easing.inOut(Easing.quad), ...native }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.03, duration: 119, easing: Easing.inOut(Easing.quad), ...native }),
          Animated.timing(translateY, { toValue: -1, duration: 119, easing: Easing.inOut(Easing.quad), ...native }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 126, easing: Easing.inOut(Easing.quad), ...native }),
          Animated.timing(translateY, { toValue: 0, duration: 126, easing: Easing.inOut(Easing.quad), ...native }),
        ]),
      ]);

      if (!cancelled) running.start();
    });

    return () => {
      cancelled = true;
      running?.stop();
    };
    // Only re-run when enabled flips. The delay/overshoot are config-time constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { opacity, scale, translateY };
}
