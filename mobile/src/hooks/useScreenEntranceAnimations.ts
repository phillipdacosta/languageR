import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/** Matches My Materials: soft opacity + translateY with cubic-bezier easing. */
const BEZIER = Easing.bezier(0.25, 0.1, 0.25, 1);

export type ScreenEntranceOptions = {
  /**
   * When true, shell motion waits until `listLoading` is false (e.g. full-screen spinner first).
   * Default false — shell runs on mount; list runs when loading finishes (Materials pattern).
   */
  deferShellUntilListReady?: boolean;
};

export function useScreenEntranceAnimations(
  listLoading: boolean,
  options?: ScreenEntranceOptions,
) {
  const deferShell = options?.deferShellUntilListReady ?? false;
  const shellEnter = useRef(new Animated.Value(0)).current;
  const listGateEnter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (deferShell && listLoading) {
      shellEnter.setValue(0);
      return;
    }
    shellEnter.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(shellEnter, {
        toValue: 1,
        duration: 280,
        easing: BEZIER,
        useNativeDriver: true,
      }).start();
    });
  }, [shellEnter, deferShell, listLoading]);

  useEffect(() => {
    if (listLoading) {
      listGateEnter.setValue(0);
      return;
    }
    listGateEnter.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(listGateEnter, {
        toValue: 1,
        duration: 300,
        delay: 32,
        easing: BEZIER,
        useNativeDriver: true,
      }).start();
    });
  }, [listLoading, listGateEnter]);

  const shellMotion = useMemo(
    () => ({
      opacity: shellEnter,
      transform: [{ translateY: shellEnter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
    }),
    [shellEnter],
  );

  const listGateMotion = useMemo(
    () => ({
      opacity: listGateEnter,
      transform: [{ translateY: listGateEnter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
    }),
    [listGateEnter],
  );

  return { shellMotion, listGateMotion };
}
