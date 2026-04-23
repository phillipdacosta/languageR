import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import LottieView from 'lottie-react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const CELEBRATION_LOTTIE = require('../../assets/onboarding/Celebration.lottie');

/** Matches web: Celebration plays during intro, then hero compacts and content slides in. */
const REVEAL_DELAY_MS = 3800;
const LOTTIE_LARGE = 220;
const LOTTIE_SMALL = 72;
const easeHero = Easing.bezier(0.32, 0.72, 0, 1);

export type OnboardingWelcomeAnimatedProps = {
  title: string;
  subtitle: string;
  titleColor: string;
  subtitleColor: string;
  children: React.ReactNode;
  footerWrapStyle?: StyleProp<ViewStyle>;
  renderFooter: (opts: { interactive: boolean }) => React.ReactNode;
  scrollContentStyle?: StyleProp<ViewStyle>;
};

export function OnboardingWelcomeAnimated({
  title,
  subtitle,
  titleColor,
  subtitleColor,
  children,
  footerWrapStyle,
  renderFooter,
  scrollContentStyle,
}: OnboardingWelcomeAnimatedProps) {
  const [layoutRow, setLayoutRow] = useState(false);
  const [footerInteractive, setFooterInteractive] = useState(false);

  const lottieSize = useSharedValue(LOTTIE_LARGE);
  const padTop = useSharedValue(40);
  const padBottom = useSharedValue(40);
  const titleOpacity = useSharedValue(0);
  const titleTx = useSharedValue(20);
  const bodyOpacity = useSharedValue(0);
  const bodyTy = useSharedValue(16);

  useEffect(() => {
    const revealId = setTimeout(() => {
      setLayoutRow(true);
      lottieSize.value = withTiming(LOTTIE_SMALL, { duration: 600, easing: easeHero });
      padTop.value = withTiming(0, { duration: 600, easing: easeHero });
      padBottom.value = withTiming(16, { duration: 600, easing: easeHero });
      titleOpacity.value = withDelay(150, withTiming(1, { duration: 500 }));
      titleTx.value = withDelay(150, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
      bodyOpacity.value = withDelay(250, withTiming(1, { duration: 500 }));
      bodyTy.value = withDelay(250, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
    }, REVEAL_DELAY_MS);

    const footerId = setTimeout(() => setFooterInteractive(true), REVEAL_DELAY_MS + 400);

    return () => {
      clearTimeout(revealId);
      clearTimeout(footerId);
    };
  }, []);

  const lottieBoxStyle = useAnimatedStyle(() => ({
    width: lottieSize.value,
    height: lottieSize.value,
  }));

  const heroPadStyle = useAnimatedStyle(() => ({
    paddingTop: padTop.value,
    paddingBottom: padBottom.value,
  }));

  const titleAnimStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateX: titleTx.value }],
  }));

  const bodyAnimStyle = useAnimatedStyle(() => ({
    opacity: bodyOpacity.value,
    transform: [{ translateY: bodyTy.value }],
  }));

  const footerAnimStyle = useAnimatedStyle(() => ({
    opacity: bodyOpacity.value,
    transform: [{ translateY: bodyTy.value }],
  }));

  return (
    <View style={styles.fill}>
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollPad, scrollContentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={[
            styles.hero,
            heroPadStyle,
            { flexDirection: layoutRow ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: 8 },
          ]}
        >
          <Animated.View style={[styles.lottieClip, lottieBoxStyle]}>
            <LottieView
              source={CELEBRATION_LOTTIE as any}
              autoPlay
              loop
              speed={1}
              resizeMode="contain"
              style={styles.lottie}
            />
          </Animated.View>
          <View style={[styles.titleWrap, layoutRow ? { flex: 1, minWidth: 0 } : { width: 0, height: 0, overflow: 'hidden' }]}>
            <Animated.Text style={[styles.welcomeTitle, { color: titleColor }, titleAnimStyle]} numberOfLines={3}>
              {title}
            </Animated.Text>
          </View>
        </Animated.View>

        <Animated.View style={bodyAnimStyle}>
          <Text style={[styles.welcomeSub, { color: subtitleColor }]}>{subtitle}</Text>
          {children}
        </Animated.View>
      </Animated.ScrollView>

      <Animated.View style={[footerWrapStyle, footerAnimStyle]}>
        {renderFooter({ interactive: footerInteractive })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flex: 1 },
  scrollPad: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 120 },
  hero: { alignSelf: 'stretch' },
  lottieClip: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  lottie: { width: '100%', height: '100%' },
  titleWrap: { justifyContent: 'center' },
  welcomeTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, textAlign: 'left' },
  welcomeSub: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
});
