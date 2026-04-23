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

  const initialLoadingRef = useRef(listLoading);
  const shellAnimated = useRef(false);
  const listAnimated = useRef(false);

  const hadInitialLoading = initialLoadingRef.current;

  const shellEnter = useRef(new Animated.Value(0)).current;
  const listGateEnter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (deferShell && listLoading) {
      shellEnter.setValue(0);
      shellAnimated.current = false;
      return;
    }
    if (shellAnimated.current) return;
    shellAnimated.current = true;

    shellEnter.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(shellEnter, {
        toValue: 1,
        duration: hadInitialLoading ? 280 : 200,
        easing: BEZIER,
        useNativeDriver: true,
      }).start();
    });
  }, [shellEnter, deferShell, listLoading, hadInitialLoading]);

  useEffect(() => {
    if (listLoading) {
      listGateEnter.setValue(0);
      listAnimated.current = false;
      return;
    }
    if (listAnimated.current) return;
    listAnimated.current = true;

    listGateEnter.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(listGateEnter, {
        toValue: 1,
        duration: hadInitialLoading ? 300 : 220,
        delay: hadInitialLoading ? 32 : 20,
        easing: BEZIER,
        useNativeDriver: true,
      }).start();
    });
  }, [listLoading, listGateEnter, hadInitialLoading]);

  const shellMotion = useMemo(
    () => ({
      opacity: shellEnter,
      transform: [{ translateY: shellEnter.interpolate({ inputRange: [0, 1], outputRange: [hadInitialLoading ? 10 : 4, 0] }) }],
    }),
    [shellEnter, hadInitialLoading],
  );

  const listGateMotion = useMemo(
    () => ({
      opacity: listGateEnter,
      transform: [{ translateY: listGateEnter.interpolate({ inputRange: [0, 1], outputRange: [hadInitialLoading ? 12 : 5, 0] }) }],
    }),
    [listGateEnter, hadInitialLoading],
  );

  return { shellMotion, listGateMotion };
}
