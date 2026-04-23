import React, { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  Dimensions,
  Share,
  Platform,
  ActivityIndicator,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated as RNAnimated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  withTiming,
  Easing,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { getRootNavigation } from '../utils/navigationRoot';
import { ProcessedLessonCard } from '../utils/lessonCardModel';
import {
  getLessonEnd,
  lessonService,
  LessonDetailResponse,
  PaymentData,
  BillingData,
  getCachedLessonDetail,
  fetchAndCacheLessonDetail,
  getJoinGateState,
  formatTimeUntilLessonStart,
  isLessonInProgressSlot,
} from '../services/lessons';
import { materialService, RecommendedMaterial } from '../services/materials';
import { isLessonMockId, getMockRecommendedMaterials } from '../utils/lessonMockPreview';
import { stripSimpleHtml } from '../utils/stripSimpleHtml';
import {
  resolveClassAttendeesForPreview,
  attendeeStackInitials,
  MOCK_CLASS_ATTENDEES_PREVIEW,
} from '../constants/mockClassAttendeesPreview';
import { LessonDateHeaderCenter, formatDateBadgeParts } from './LessonDateHeaderCenter';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SolidToolbarWithBlur, TOOLBAR_TOTAL_CHROME_HEIGHT, TOOLBAR_SOLID_MIN_HEIGHT } from './SolidToolbarWithBlur';
import type { ClassGoingMessageRequest } from './ClassGoingMessageModal';

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  card: ProcessedLessonCard;
  cardRect: CardRect;
  /** Kept for API back-compat. No longer used internally — the overlay now uses a single surface morph, no CTA alignment. */
  ctaTargetRect?: CardRect | null;
  /** Kept for API back-compat. No longer used internally — the overlay now uses a single surface morph, no thumbnail FLIP. */
  thumbnailTargetRect?: CardRect | null;
  onCloseStart: () => void;
  onCloseEnd: () => void;
  /**
   * Fires once during close when the overlay's body content has faded out
   * and the surface itself is about to start fading. Parent animates the
   * source card 0 → 1 over ~200ms — so the surface and card cross-fade
   * directly (no opaque-white gap), revealing the card underneath as the
   * surface becomes transparent.
   */
  onBeginReveal?: () => void;
  /**
   * Parent (Home / Lessons) renders `ClassGoingMessageModal` at screen root
   * so the RN `Modal` is not nested under Reanimated/another Modal (iOS
   * often fails to show inner modals).
   */
  onClassGoingMessageRequest?: (p: ClassGoingMessageRequest) => void;
}

const { width: SW, height: SH } = Dimensions.get('window');

/** Height of the full-bleed class thumbnail hero at the top of the sheet. */
const CLASS_HERO_H = 260;
/** How far the content card overlaps the class hero (same as Bundle). */
const CLASS_CARD_OVERLAP = 88;

/**
 * ONE spring, ONE job — animate the surface rect from `cardRect` to full
 * screen on open, and back on close. Reanimated 4's duration/dampingRatio form
 * is easier to reason about than stiffness/damping/mass:
 *  - duration: perceived motion length (ms)
 *  - dampingRatio: 1 = critical (no overshoot); < 1 bounces; > 1 slower settle
 * 0.92 gives a subtle, nearly-zero overshoot that reads as "confident" rather
 * than "wooden." 420ms matches iOS modal-present / Airbnb card-expand feel.
 */
const MORPH_SPRING = { duration: 520, dampingRatio: 0.94 } as const;
/**
 * Close uses a tight timing curve, not a spring. Spring physics on close
 * produce a small overshoot right at the end where the surface is settling
 * back onto the card rect — that's exactly where the eye is tracking the
 * avatar landing, so the overshoot reads as "not quite aligned." A plain
 * cubic-out is decisive, predictable, and lands square on the source card.
 * ~380ms is fast enough to feel responsive without making the scaffold
 * content fade pop.
 */
const MORPH_CLOSE_TIMING = { duration: 380, easing: Easing.out(Easing.cubic) } as const;

export default function LessonDetailOverlay({
  card,
  cardRect,
  thumbnailTargetRect,
  onCloseStart,
  onCloseEnd,
  onBeginReveal,
  onClassGoingMessageRequest,
}: Props) {
  const { user } = useAuth();
  const { colors: C, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const timeFormat = user?.profile?.calendarTimeFormat || '12h';

  const id = card.lesson?._id || card.id;
  const currentUserId = String(user?._id || user?.id || '');
  const cached = id ? getCachedLessonDetail(id, card.lesson) : null;

  /**
   * Single morph progress: 0 = collapsed at `cardRect`, 1 = full screen.
   * Drives the surface rect (top/left/width/height/borderRadius), backdrop
   * opacity, and a delayed content fade-in. No element-level scale/translate
   * animations — the whole surface is one rigid rectangle growing in place.
   */
  const progress = useSharedValue(0);
  // `closing` gates two behaviours only relevant during the close animation:
  //  1. Content fades (header / meta / detail / footer) stop fading OUT, so
  //     the card doesn't briefly look empty between progress ~0.35 and ~0.
  //  2. A tail opacity fade on the surface during the last ~10% of close
  //     crossfades the overlay into the real card underneath, hiding any
  //     sub-pixel layout mismatch at handoff.
  const closing = useSharedValue(0);
  const asyncFade = useSharedValue(cached ? 1 : 0);
  const ASYNC_FADE_IN = { duration: 380, easing: Easing.out(Easing.cubic) };
  /**
   * Fades the below-the-fold detail column in AFTER the open spring has
   * finished. Keeping the heavy mount off the spring's critical path is
   * what lets the card + avatar morph run at native frame rate.
   */
  const detailFade = useSharedValue(0);
  const DETAIL_FADE_IN = { duration: 260, easing: Easing.out(Easing.cubic) };

  const [detail, setDetail] = useState<LessonDetailResponse | null>(cached?.detail ?? null);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(cached?.payment ?? null);
  const [billingData, setBillingData] = useState<BillingData | null>(cached?.billing ?? null);
  const [detailMounted, setDetailMounted] = useState(false);
  const [recMaterials, setRecMaterials] = useState<RecommendedMaterial[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [joinUiTick, setJoinUiTick] = useState(0);
  /** Light status text on photo; switches to dark (iOS) when the sheet reads as white (Airbnb). */
  const [classHeroStatusBarLight, setClassHeroStatusBarLight] = useState(true);

  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => setJoinUiTick(x => x + 1), 10000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    progress.value = withSpring(1, MORPH_SPRING);
    /**
     * Defer mounting the heavy detail column until AFTER the morph spring
     * has settled. The below-the-fold tree (recommended materials, AI bits,
     * payments, etc.) costs hundreds of ms of reconciliation + Yoga layout
     * on real lessons; running any of that during the spring blocks the JS
     * thread and produces the "framey" expansion the user is seeing.
     *
     * The mount is off-screen at progress=1 — only the stats grid and above
     * are in the viewport — so the user never sees the delayed mount. We
     * fade the column in on its own cheap opacity spring so scrolling down
     * immediately still reveals it gracefully.
     */
    const mountTimer = setTimeout(() => {
      setDetailMounted(true);
      detailFade.value = withTiming(1, DETAIL_FADE_IN);
    }, MORPH_SPRING.duration + 20);
    return () => clearTimeout(mountTimer);
  }, []);

  /**
   * Guards every async `setState` against landing after unmount. Rapid
   * open/close cycles of the overlay would otherwise let a stale instance's
   * fetch resolve after its tree was torn down and schedule renders that
   * the fresh instance (mounted on the *next* tap) pays for — a classic
   * "UI wedges after a few taps" pattern.
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!id) return;
    fetchAndCacheLessonDetail(id, card.lesson, currentUserId).then((fresh) => {
      if (!isMountedRef.current) return;
      if (fresh.detail) setDetail(fresh.detail);
      if (fresh.payment) setPaymentData(fresh.payment);
      if (fresh.billing) setBillingData(fresh.billing);
      if (!cached) {
        asyncFade.value = withTiming(1, ASYNC_FADE_IN);
      }
    }).catch(() => {});
  }, [id, currentUserId]);

  useEffect(() => {
    const mockRole = (card.lesson as any)?._mockViewRole;
    let viewerIsStudent: boolean;
    if (mockRole === 'tutor' || mockRole === 'student') {
      viewerIsStudent = mockRole === 'student';
    } else {
      const tid = String((card.lesson?.tutorId as any)?._id || card.lesson?.tutorId || '');
      viewerIsStudent = !!currentUserId && !!tid && tid !== currentUserId;
    }
    if (!viewerIsStudent) return;

    if (id && isLessonMockId(id)) {
      const mockRecs = getMockRecommendedMaterials(id);
      if (mockRecs.length && isMountedRef.current) setRecMaterials(mockRecs as any);
      return;
    }

    const lang = card.lesson?.language;
    if (!lang) return;
    setRecLoading(true);
    const tutId = card.lesson?.tutorId?._id || (typeof card.lesson?.tutorId === 'string' ? card.lesson.tutorId : undefined);
    materialService.getRecommendedMaterials(lang, { lessonId: id, tutorId: tutId }).then((res) => {
      if (!isMountedRef.current) return;
      if (res.success && res.materials?.length) setRecMaterials(res.materials);
      setRecLoading(false);
    }).catch(() => {
      if (isMountedRef.current) setRecLoading(false);
    });
  }, [id, currentUserId, card.lesson?.tutorId, card.lesson?.language]);

  /**
   * Debounce close against rapid taps on the X / back button. Without this
   * every tap re-fires `withSpring(0, …)` which resets the spring callback
   * and can emit multiple `runOnJS(onCloseEnd)` calls — each triggers
   * `setOverlayCard(null)` + `setLessonOverlayCoversTabBar(false)` on the
   * parent, i.e. cascades of re-renders that block the UI thread and wedge
   * the morph mid-flight. `closingRef` ensures `onCloseStart` and the
   * spring-to-0 run at most once per mount.
   */
  const closingRef = useRef(false);
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    onCloseStart();
    closing.value = 1;
    progress.value = withTiming(0, MORPH_CLOSE_TIMING, (fin) => {
      if (fin) runOnJS(onCloseEnd)();
    });
  };

  const HEADER_H = TOOLBAR_TOTAL_CHROME_HEIGHT;
  const BODY_PAD_OPEN = insets.top + HEADER_H;

  // Early-compute display mode so animated styles can reference it without
  // hitting temporal-dead-zone issues. `showHero` means the class cover
  // thumbnail is rendered full-bleed at the top of the sheet; in that mode
  // the "single big avatar" is replaced by an attendee stack and therefore
  // doesn't need a scale animation.
  const lessonForMode = detail?.lesson || card.lesson;
  const isClassMode = !!lessonForMode?.isClass;
  const classThumbForMode = (lessonForMode?.classData?.thumbnail || '').trim();
  const showHero = isClassMode && !!classThumbForMode;

  // Scale factors: card-side sizes / detail-side sizes. Used to grow the
  // avatar and name in lockstep with the surface morph so they feel like
  // the exact card elements continuously enlarging — no pop, no fade swap.
  //   card avatar 72px → detail 120px → start scale 0.6
  //   card name 18pt  → detail 24pt   → start scale 0.75
  const AVATAR_START_SCALE = 72 / 120;
  const NAME_START_SCALE = 18 / 24;

  // Position correction: transform-scale keeps the LAYOUT box the same size
  // as the detail-sized element, so the visual center of the scaled-down
  // avatar/name lands a few pixels away from where the source card actually
  // draws them. Without this the avatar appears to "snap down" at the end of
  // the close as the overlay handoff fires. We translateY each element so
  // that at progress=0 the visible center sits EXACTLY on the card-side
  // position, then relax back to 0 at progress=1.
  //
  //   card avatar center Y = cardTop + 32 (paddingTop) + 36 (avatar half)  = cardTop + 68
  //   overlay avatar center Y at progress=0 = surfaceTop + 60 (box center)  → off by +8
  //
  //   card name center Y = cardTop + 32 + 72 + 14 (avatarBlock mb) + ~11   = cardTop + 129
  //   overlay name center Y at progress=0 = surfaceTop + 144 + ~18         → off by -33
  //
  // Values derived for iOS default line heights; fine to tweak by ±2-3 if
  // you spot a residual nudge on a specific device.
  const AVATAR_START_TRANSLATE_Y = 8;
  const NAME_START_TRANSLATE_Y = -33;

  // ── Surface ──
  // ONE rectangle growing/shrinking between `cardRect` and the full screen.
  // Same `backgroundColor: C.card` as the source card. Corner radius matches
  // the list card (28) at progress=0 so the rounded silhouette handoff is
  // seamless.
  //
  // Surface opacity: stays 1 the entire open. On close, body content fades
  // out first ([0.35, 0.6] band, see `contentFadeStyle`), then the SURFACE
  // itself fades out during [0, 0.35] — cross-fading with the source card
  // underneath (which LessonsScreen animates 0 → 1 in sync, triggered by
  // `onBeginReveal` at progress=0.35). Result: no pure-white empty-card
  // frame; the user sees content fade out, then a smooth cross-fade from
  // overlay-surface to real card. Tight, airbnb-style handoff.
  const surfaceStyle = useAnimatedStyle(() => ({
    top: interpolate(progress.value, [0, 1], [cardRect.y, 0]),
    left: interpolate(progress.value, [0, 1], [cardRect.x, 0]),
    width: interpolate(progress.value, [0, 1], [cardRect.width, SW]),
    height: interpolate(progress.value, [0, 1], [cardRect.height, SH]),
    // Keep the top corners rounded at full open (~22) so the detail reads
    // as a sheet pushed over the page, not a flat full-bleed screen.
    // Matches Airbnb's detail-card look. Card state (progress=0) uses 28
    // to match the source card's corner radius exactly.
    borderRadius: interpolate(progress.value, [0, 1], [28, 62]),
    opacity: closing.value > 0
      ? interpolate(progress.value, [0, 0.35], [0, 1], Extrapolation.CLAMP)
      : 1,
  }));

  // Inner clip layer — mirrors the outer wrapper's borderRadius so content
  // (header, body, hero image) clips to the rounded silhouette while the
  // outer wrapper is free to cast its shadow (iOS won't draw shadows
  // through a view with overflow:hidden, so the shadow must live on the
  // NON-clipping outer view).
  const surfaceClipStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(progress.value, [0, 1], [28, 62]),
  }));

  /**
   * Shadow only renders at the two "rest" endpoints of the morph:
   *   - `p ≤ 0.08`: surface sitting over the source card → shadow visible
   *     so the overlay reads as a raised sheet before it starts moving.
   *   - `p ≥ 0.08` through the whole resize phase: shadow off. iOS
   *     re-rasterizes the drop shadow path *every time* the view's box
   *     changes size, and the surface changes size every frame here. Any
   *     non-zero `shadowOpacity` during resize is a constant ~3-5ms/frame
   *     tax on the UI thread. Zero means iOS skips the shadow pipeline.
   *   - Fullscreen doesn't want a shadow either (it reads as a dark gutter
   *     against the screen edge), so we leave it at 0 at `p=1`.
   * Close reverses: shadow stays off until the surface is nearly settled
   * back on the card, then pops in for the last ~8% to hand off cleanly.
   */
  const surfaceShadowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(
      progress.value,
      [0, 0.08, 0.92, 1],
      [0.22, 0, 0, 0],
      Extrapolation.CLAMP,
    ),
  }));

  // ── Backdrop ──
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 0.38], Extrapolation.CLAMP),
  }));

  // ── Header chrome ──
  // Open: fade in late [0.7, 0.95] so it doesn't compete with the morph.
  // Close: fade out EARLY [0.85, 1] → the X and Share icons are the first
  // things to disappear the moment the user taps close, so the eye reads
  // "this page is leaving" immediately rather than having the icons linger
  // on a shrinking card.
  const headerStyle = useAnimatedStyle(() => ({
    opacity: closing.value > 0
      ? interpolate(progress.value, [0.85, 1], [0, 1], Extrapolation.CLAMP)
      : interpolate(progress.value, [0.7, 0.95], [0, 1], Extrapolation.CLAMP),
  }));

  /**
   * ── Body padding ── grows LINEARLY with progress so the avatar/name
   * positional math is a clean `[0, 1]` interpolation (see `avatarScaleStyle`).
   * Previously this used a piecewise `[0, 0.5, 1] → [0, BPO, BPO]` ramp so
   * paddingTop hit its target halfway through; that forced the avatar's
   * translateY to be piecewise too, which is what produced the "stays the
   * same size for a while, then snaps to final" feel the user sees.
   *
   * Class cover (`showHero`) keeps paddingTop at 0 — full-bleed cover uses
   * extra hero height via `heroOpenHeight` instead.
   */
  const bodyPadStyle = useAnimatedStyle(() => ({
    paddingTop: showHero
      ? 0
      : interpolate(progress.value, [0, 1], [0, BODY_PAD_OPEN], Extrapolation.CLAMP),
  }));

  // ── Content fade (close only) ──
  // Tight close timing (progress 1 → 0 over ~380ms, cubic-out easing means
  // progress drops very fast at the start and crawls at the end):
  //
  //   [1.00 → 0.80]  body fades out HARD and FAST (~20ms of wall time) —
  //                  before the surface has had a chance to shrink, so
  //                  there's no moment where the outgoing text can be
  //                  caught mid-fade at a position that doesn't match
  //                  anything. By progress 0.80 the body is a clean,
  //                  empty surface.
  //   [0.80 → 0.00]  empty surface shrinks + avatar/name ride it down.
  //                  Source card is INSTANTLY revealed behind the surface
  //                  (opacity=1 via `onBeginReveal`) from the very start
  //                  of close, so as the surface becomes transparent in
  //                  the tail the card underneath is already fully painted
  //                  — no fade-in race, no ghosted duplicate text.
  //
  // IMPORTANT: this is applied to the avatar's SIBLINGS (name, date header,
  // stats grid, detail sections) — never to the avatar itself. The avatar
  // is the one element that's a true "shared element" between the card and
  // the detail; it scales continuously from small→big and back, and must
  // never flash to 0.
  const contentFadeStyle = useAnimatedStyle(() => ({
    opacity: closing.value > 0
      ? interpolate(progress.value, [0.80, 0.95], [0, 1], Extrapolation.CLAMP)
      : 1,
  }));

  // Trigger the parent's card reveal IMMEDIATELY at close start. The parent
  // snaps `cardRevealOpacity` to 1 in a single frame (no fade), so the
  // source card sits fully painted at `cardRect` under the overlay surface
  // for the entire close. The opaque overlay surface hides the card while
  // it's shrinking; only in the last ~35% (when `surfaceStyle.opacity`
  // drops 1→0 over the [0, 0.35] progress window — see `surfaceStyle`)
  // does the card become visible. Because the card is already at opacity
  // 1 by then, there's no fade-in that could overlap with the dying
  // overlay text — the eye sees ONE surface fading out to reveal ONE
  // card, not two semi-transparent sets of text stacked on top of each
  // other.
  useAnimatedReaction(
    () => closing.value > 0,
    (curr, prev) => {
      if (curr && !prev && onBeginReveal) {
        runOnJS(onBeginReveal)();
      }
    },
  );

  /**
   * Drop the heavy detail tree the moment close begins. It's scrolled
   * off-screen anyway by the time the surface starts shrinking, so the
   * user can't see it disappear — but keeping it mounted means every frame
   * of the shrinking surface has to re-layout the detail column's subtree
   * as well. On real lessons that's measurably 60-80ms of extra JS-side
   * work spread across the close, which shows up as stalls right where
   * the eye is tracking the avatar landing.
   */
  useAnimatedReaction(
    () => closing.value > 0,
    (curr, prev) => {
      if (curr && !prev) {
        runOnJS(setDetailMounted)(false);
      }
    },
  );

  /**
   * ── Avatar: grows CONTINUOUSLY with the card over the whole morph ──
   *
   * Previously the avatar was locked at the source-card position/scale during
   * `[0, 0.35]`, scaled through `[0.35, 0.65]`, then locked at full detail
   * size through `[0.65, 1]`. That compresses all the visible growth into
   * 30% of the animation, which the eye reads as "sits still → snaps to
   * end". Airbnb's version grows in lockstep with the card surface — the
   * avatar has frames at every size between the card's 72px and the
   * detail's 120px.
   *
   * With `bodyPadStyle` now linear over `[0, 1]`, keeping the avatar in
   * exact screen-Y alignment with the source card at `p=0` (and at natural
   * layout at `p=1`) reduces to a trivial linear translate:
   *
   *   wanted_y(p) = (1-p)*(cardRect.y + 68) + p*(BODY_PAD_OPEN + 60)
   *   actual_y(p) = (1-p)*cardRect.y + p*BODY_PAD_OPEN + 60 + translateY
   *   → translateY(p) = AVATAR_START_TRANSLATE_Y * (1 - p)
   *
   * Scale is also linear `[AVATAR_START_SCALE, 1]`, so at `p=0` the avatar
   * renders at exactly 72px over the card's avatar slot (cross-fade stays
   * pixel-perfect on close); at `p=1` it sits at 120px in its natural slot;
   * every intermediate frame shows a smoothly-scaling avatar tied to the
   * card's growth.
   */
  /**
   * Open uses a single linear ramp `[0, 1] → [start, end]` so the avatar
   * grows continuously with the card (the "multiple frames of growth"
   * Airbnb shows).
   *
   * Close uses pixel-precise math to keep the overlay avatar pinned to the
   * source-card avatar's absolute screen position throughout the entire
   * cross-fade zone.
   *
   * The previous close curve just locked `translateY` at the constant
   * `AVATAR_START_TRANSLATE_Y = 8` during `[0, 0.35]`. That's only right if
   * `cardRect.y === BODY_PAD_OPEN` (~100). Real cards sit hundreds of px
   * lower, so the overlay avatar's *absolute* screen-Y drifted by
   * `p * (cardRect.y - BODY_PAD_OPEN)` during `[0, 0.35]` — while the
   * source card's avatar was fading in at a fixed Y. Result: two avatars
   * ghosting at different vertical positions during the handoff, which is
   * exactly what shows up in the screenshot.
   *
   * The correct `translateY` that pins `abs_y = cardRect.y + 68`:
   *   natural_y(p) = (1-p)*cardRect.y + p*BPO + 60
   *   pinned_y    = cardRect.y + 68
   *   → translateY(p) = AVATAR_START_TRANSLATE_Y + p*(cardRect.y - BPO)
   *
   * Below `AVATAR_CLOSE_LAND_BY` we use that pinned formula directly.
   * Above it we interpolate from the value the formula produces at the
   * land-point back to the natural end-of-close state at `p=1`.
   */
  const AVATAR_CLOSE_LAND_BY = 0.35;
  const avatarScaleStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (showHero) {
      return { transform: [{ translateY: 0 }, { scale: 1 }] };
    }

    if (closing.value > 0) {
      if (p <= AVATAR_CLOSE_LAND_BY) {
        return {
          transform: [
            { translateY: AVATAR_START_TRANSLATE_Y + p * (cardRect.y - BODY_PAD_OPEN) },
            { scale: AVATAR_START_SCALE },
          ],
        };
      }
      const tyAtLand = AVATAR_START_TRANSLATE_Y + AVATAR_CLOSE_LAND_BY * (cardRect.y - BODY_PAD_OPEN);
      return {
        transform: [
          { translateY: interpolate(p, [AVATAR_CLOSE_LAND_BY, 1], [tyAtLand, 0], Extrapolation.CLAMP) },
          { scale: interpolate(p, [AVATAR_CLOSE_LAND_BY, 1], [AVATAR_START_SCALE, 1], Extrapolation.CLAMP) },
        ],
      };
    }

    const scale = interpolate(p, [0, 1], [AVATAR_START_SCALE, 1], Extrapolation.CLAMP);
    const ty = interpolate(p, [0, 1], [AVATAR_START_TRANSLATE_Y, 0], Extrapolation.CLAMP);
    return { transform: [{ translateY: ty }, { scale }] };
  });

  /**
   * ── Name: same pattern as the avatar ──
   * Linear over `[0, 1]`. At `p=0` it lands pixel-perfect on the card's
   * name row; at `p=1` it's at its natural detail position; in between it
   * grows continuously in lockstep with the card and avatar.
   */
  /**
   * Name mirrors the avatar: open uses linear `[0, 1] → [start, end]`;
   * close uses the pixel-pinned formula so the overlay name sits exactly
   * on the source card's name row throughout the cross-fade (and avoids
   * the same ghosting the avatar had before the fix above).
   */
  const nameScaleStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (showHero) {
      return { transform: [{ translateY: 0 }, { scale: 1 }] };
    }

    if (closing.value > 0) {
      if (p <= AVATAR_CLOSE_LAND_BY) {
        return {
          transform: [
            { translateY: NAME_START_TRANSLATE_Y + p * (cardRect.y - BODY_PAD_OPEN) },
            { scale: NAME_START_SCALE },
          ],
        };
      }
      const tyAtLand = NAME_START_TRANSLATE_Y + AVATAR_CLOSE_LAND_BY * (cardRect.y - BODY_PAD_OPEN);
      return {
        transform: [
          { translateY: interpolate(p, [AVATAR_CLOSE_LAND_BY, 1], [tyAtLand, 0], Extrapolation.CLAMP) },
          { scale: interpolate(p, [AVATAR_CLOSE_LAND_BY, 1], [NAME_START_SCALE, 1], Extrapolation.CLAMP) },
        ],
      };
    }

    const scale = interpolate(p, [0, 1], [NAME_START_SCALE, 1], Extrapolation.CLAMP);
    const ty = interpolate(p, [0, 1], [NAME_START_TRANSLATE_Y, 0], Extrapolation.CLAMP);
    return { transform: [{ translateY: ty }, { scale }] };
  });

  // ── Stats grid + date header ── appear once the card is mostly open.
  // These are "new" elements not present on the card, so they need a
  // dedicated fade rather than a naked scale.
  //
  /**
   * Date badge + quick-stats strip reveal — combines opacity + a
   * compensating translateY so they appear cleanly at a STABLE absolute
   * screen position.
   *
   * Two failed attempts before this:
   *   1. Fade during `[0.3, 0.6]` of progress — user saw them drift down
   *      as they appeared, because `bodyPadStyle.paddingTop` grows linearly
   *      through the morph and meta sits below it in the flex stack. So
   *      during the fade window, meta's absolute screen-Y was climbing
   *      ~50px while the opacity interpolated 0→1.
   *   2. Post-morph fade tied to `detailFade` — user saw a visible "gap"
   *      where the source-card date briefly existed, then nothing, then
   *      the overlay date popped in 540ms later. The gap reads as a flash.
   *
   * The fix combines both lessons: fade in during the LAST 30% of the
   * morph (so no gap), AND apply a `translateY` that exactly cancels both
   * the surface-top motion AND the paddingTop growth during that window
   * so the element's absolute screen-Y is fixed throughout the fade.
   *
   * Derivation:
   *   abs_y(p) = surface_top(p) + body_paddingTop(p) + meta_offset + tyComp(p)
   *            = (1-p)*cardRect.y + p*BPO + meta_offset + tyComp(p)
   *   want abs_y(p) = BPO + meta_offset  (= position at p=1)
   *   → tyComp(p) = (1 - p) * (BPO - cardRect.y)
   *
   * That's independent of meta_offset, so the same formula applies to both
   * the date strip and the stats grid below it.
   */
  /**
   * Fade starts at 82% of the morph. Chosen by walking the math:
   *   - Avatar is still shrinking/moving toward its final position during
   *     the morph tail. Its bottom edge at progress `p` sits at roughly
   *     `0.2·cardRect.y + BPO·p + 60 + 55·(0.6+p·0.4)`.
   *   - Date sits pinned (via the compensation below) at `BPO + meta_offset`.
   *   - Starting the fade at 0.82 keeps clearance between the avatar's
   *     bottom and the date's position for the full typical range of
   *     `cardRect.y` (up to ~650px, i.e. well below any normal visible
   *     tap target). Later would feel snappy / popped; earlier would risk
   *     the faint-opacity date bleeding through the avatar on
   *     deep-scrolled cards.
   */
  const META_FADE_START = 0.82;
  const metaRevealStyle = useAnimatedStyle(() => {
    // During close, DO NOT set opacity here — `contentFadeStyle` is the
    // single source of truth for the close fade-out. Two animated styles
    // both setting `opacity` in the same style array gets merged in a way
    // that's not always deterministic on iOS (last-writer-wins by prop,
    // but the "last writer" can flip between frames on the UI thread),
    // producing the ghost-text the user sees in IMG_2316.
    if (closing.value > 0) {
      return { transform: [{ translateY: 0 }] };
    }
    const p = progress.value;
    const opacity = interpolate(p, [META_FADE_START, 1], [0, 1], Extrapolation.CLAMP);
    const tyComp = interpolate(
      p,
      [META_FADE_START, 1],
      [(1 - META_FADE_START) * (BODY_PAD_OPEN - cardRect.y), 0],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ translateY: tyComp }] };
  });

  /**
   * ── Detail sections (bio, AI, payments, etc.) ──
   *
   * The detail column mounts AFTER the morph spring completes (see the
   * main `useEffect`), at which point `progress` is already 1. So opacity
   * can't be tied to `progress` — we drive it from a dedicated `detailFade`
   * shared value that runs a short fade-in right after mount. Scrolling
   * down after open reveals the column with a smooth 260ms fade rather
   * than a pop.
   *
   * During close (`closing.value > 0`) we keep it at full opacity — the
   * surface itself is doing the cross-fade with the source card, so the
   * detail column just rides along inside the shrinking surface until the
   * overlay tears down.
   */
  const detailStyle = useAnimatedStyle(() => ({
    opacity: closing.value > 0 ? 1 : detailFade.value,
  }));

  // ── Footer CTA ──
  // Open: fade in + slide UP from below on a soft band [0.5, 0.95]. Starts
  // ~40px below its final position and rises into place as the surface
  // settles — same direction you see in Airbnb's detail-page reveal.
  // Close: fade out EARLY [0.85, 1] along with the header chrome, sliding
  // slightly back down so it tucks away instead of popping. The shrinking
  // card should never look like it's dragging a detached CTA along the
  // bottom of the screen.
  const FOOTER_SLIDE = 40;
  const footerFadeStyle = useAnimatedStyle(() => {
    const closingNow = closing.value > 0;
    const op = closingNow
      ? interpolate(progress.value, [0.85, 1], [0, 1], Extrapolation.CLAMP)
      : interpolate(progress.value, [0.55, 0.9], [0, 1], Extrapolation.CLAMP);
    const ty = closingNow
      ? interpolate(progress.value, [0.85, 1], [FOOTER_SLIDE, 0], Extrapolation.CLAMP)
      : interpolate(progress.value, [0.5, 0.95], [FOOTER_SLIDE, 0], Extrapolation.CLAMP);
    return {
      opacity: op,
      transform: [{ translateY: ty }],
    };
  });

  // ── Class hero image close-to-card mapping ──
  // For classes with a cover thumbnail, the detail screen shows a full-bleed
  // 260h hero at the top. In the list, the same image lives INSIDE the card
  // (inset by card padding, aspect 16:9, borderRadius 16). Without animating
  // the image itself, on close it stays full-bleed while the surface shrinks
  // — so at progress=0 the image is at the wrong size/position, creating a
  // visible "jump" when the overlay unmounts.
  //
  // We measure the card's thumbnail rect in `LessonsScreen.openDetail` and
  // pass it via `thumbnailTargetRect`. Here we interpolate the image's
  // width/height/top-inset/borderRadius between the card-thumb rect (at
  // progress=0) and full-bleed (at progress=1). Fallback values use the
  // known card paddings so it still works if the measurement hasn't arrived.
  const thumbInsetTop = showHero && thumbnailTargetRect
    ? Math.max(0, thumbnailTargetRect.y - cardRect.y)
    : 32;
  const thumbWidth = showHero && thumbnailTargetRect
    ? thumbnailTargetRect.width
    : Math.max(0, cardRect.width - 48);
  const thumbHeight = showHero && thumbnailTargetRect
    ? thumbnailTargetRect.height
    : thumbWidth * 9 / 16;

  /** Full-bleed class cover extends under the status bar + toolbar (body pad reclaimed). */
  const heroOpenHeight = CLASS_HERO_H + BODY_PAD_OPEN;

  /**
   * Scroll position for the class-hero fade/blur, driven on the NATIVE thread
   * via `RNAnimated.event({ useNativeDriver: true })`. Matches BundleDetailScreen
   * exactly — that's the only way the hero stays locked to the card during scroll
   * on iOS. A JS-bridged scroll (Reanimated shared-value + JS onScroll) lags
   * roughly one frame behind the native ScrollView and makes the card look like
   * its top "separates" from the hero mid-scroll.
   */
  const mainScrollY = useRef(new RNAnimated.Value(0)).current;
  const classHeroNavScrollRef = useRef({ paperBy: 0 });

  const classPinnedHeroDimOpacity = mainScrollY.interpolate({
    inputRange: [0, heroOpenHeight],
    outputRange: [1, 0.4],
    extrapolate: 'clamp',
  });
  const classPinnedHeroScale = mainScrollY.interpolate({
    inputRange: [0, heroOpenHeight],
    outputRange: [1, 1.08],
    extrapolate: 'clamp',
  });
  const classPinnedHeroBlurOpacity = mainScrollY.interpolate({
    inputRange: [0, heroOpenHeight * 0.6],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const heroSpacerFinal = heroOpenHeight - CLASS_CARD_OVERLAP;
  /**
   * `e` = total scroll to bring the card lip to the top. The **pinned-hero** area must read as
   * full `C.card` **before** the under-scroll **toolbar strip** and pill→flat nav appear, so
   * the bar never shows over a still-visual photo. Blur/gradient/hero wash share
   * `classHeroHeroSurfaceBlend`; the solid bar + bar icons use the later `classHeroToolbar...`.
   */
  const classHeroChromeBlendEnd = Math.max(120, Math.round(heroSpacerFinal));
  const classHeroChromeBlendStart = Math.max(16, Math.round(classHeroChromeBlendEnd * 0.1));
  /**
   * Anchor everything to the moment the card lip reaches the **bottom of the toolbar strip**
   * (right at the back/share buttons). At that scroll position the hero must already be full
   * `C.card` paper **and** the toolbar must already be solid, so there is never a visible
   * seam between them. `classHeroChromeBlendEnd` is when the card lip hits `y = 0` of the
   * viewport; the button row sits ~`insets.top + 50`px below that, so we pull the handoff
   * up by that much (plus a small 8px lead).
   */
  const classHeroHandoffBuffer = insets.top + 58;
  const classHeroHeroPaperBy = Math.max(
    72,
    Math.round(classHeroChromeBlendEnd - classHeroHandoffBuffer),
  );
  /** Toolbar strip is fully opaque at the same moment the hero finishes going white. */
  const classHeroToolbarRampEnd = classHeroHeroPaperBy;
  const classHeroToolbarRampStart = Math.max(
    classHeroChromeBlendStart,
    Math.min(classHeroToolbarRampEnd - 40, classHeroToolbarRampEnd - 1),
  );
  const classHeroHeroSurfaceBlend = mainScrollY.interpolate({
    inputRange: [0, classHeroChromeBlendStart, classHeroHeroPaperBy],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const classHeroToolbarBarOpacity = mainScrollY.interpolate({
    inputRange: [0, classHeroToolbarRampStart, classHeroToolbarRampEnd],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const classHeroPillsOpacity = mainScrollY.interpolate({
    inputRange: [0, classHeroToolbarRampStart, classHeroToolbarRampEnd],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });
  const classHeroBarIconOpacity = mainScrollY.interpolate({
    inputRange: [0, classHeroToolbarRampStart, classHeroToolbarRampEnd],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const classHeroBlurDampen = mainScrollY.interpolate({
    inputRange: [0, classHeroChromeBlendStart, classHeroHeroPaperBy],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });
  const classHeroPinnedBlurCombined = RNAnimated.multiply(
    classPinnedHeroBlurOpacity,
    classHeroBlurDampen,
  );
  const classHeroTopGuardOpacity = mainScrollY.interpolate({
    inputRange: [0, 0.05 * classHeroChromeBlendEnd, 0.42 * classHeroChromeBlendEnd, classHeroHeroPaperBy],
    outputRange: [0, 0.15, 0.82, 1],
    extrapolate: 'clamp',
  });
  classHeroNavScrollRef.current.paperBy = classHeroHeroPaperBy;

  /**
   * Bundle (RN) pattern: clear scroll space = (hero area height − overlap). Overlap
   * is NOT a `marginTop` on the card — that wrapper can split compositing vs a plain
   * `View` child when scrolling. Height morphs: full thumb stack at p=0, `heroOpenHeight
   * − overlap` at p=1.
   *
   * Once the spring settles (p ≥ 0.999), we pin the value to the EXACT final integer
   * height so sub-pixel spring tail oscillations can't jiggle the card's starting Y
   * while the user is scrolling — that's what made the rounded top look like it was
   * "separating" from the hero on iOS.
   */
  const heroSpacerStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (p >= 0.999) return { height: heroSpacerFinal };
    return {
      height: interpolate(
        p,
        [0, 1],
        [thumbInsetTop + thumbHeight, heroSpacerFinal],
        Extrapolation.CLAMP,
      ),
    };
  });

  const heroImgHeightOpen = showHero ? heroOpenHeight : CLASS_HERO_H;
  const heroImgStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (p >= 0.999) {
      return { width: SW, height: heroImgHeightOpen, marginTop: 0, borderRadius: 0 };
    }
    return {
      width: interpolate(p, [0, 1], [thumbWidth, SW], Extrapolation.CLAMP),
      height: interpolate(p, [0, 1], [thumbHeight, heroImgHeightOpen], Extrapolation.CLAMP),
      marginTop: interpolate(p, [0, 1], [thumbInsetTop, 0], Extrapolation.CLAMP),
      borderRadius: interpolate(p, [0, 1], [16, 0], Extrapolation.CLAMP),
    };
  });

  // ── Async sub-values (network-ready billing lines) ──
  const asyncSubStyle = useAnimatedStyle(() => ({
    opacity: asyncFade.value,
  }));

  const lesson = useMemo(() => {
    const base = card.lesson;
    if (!detail?.lesson) return base;
    const d = detail.lesson;
    const classMerged = { ...(base as { classData?: { thumbnail?: string; description?: string; name?: string } }).classData, ...(d as { classData?: { thumbnail?: string; description?: string; name?: string } }).classData };
    const dAtt = (d as { attendees?: unknown[] }).attendees;
    const baseAtt = (base as { attendees?: unknown[] }).attendees;
    const attendees =
      Array.isArray(dAtt) && dAtt.length > 0
        ? dAtt
        : Array.isArray(baseAtt) && baseAtt.length > 0
          ? baseAtt
          : Array.isArray(dAtt)
            ? dAtt
            : baseAtt;
    return {
      ...base,
      ...d,
      tutorId: d.tutorId || base?.tutorId,
      studentId: d.studentId || base?.studentId,
      ...(Object.keys(classMerged).length > 0 ? { classData: classMerged } : {}),
      ...(attendees !== undefined ? { attendees } : {}),
    };
  }, [card.lesson, detail?.lesson]);
  const isClass = isClassMode;
  const classThumbUri = classThumbForMode;
  const heroThumbUri = classThumbUri;

  const mainScrollRef = useRef<ScrollView>(null);

  /** Native-driven scroll + light listener to flip status bar with the white blend (Airbnb). */
  const onMainScroll = useMemo(
    () => RNAnimated.event(
      [{ nativeEvent: { contentOffset: { y: mainScrollY } } }],
      {
        useNativeDriver: true,
        listener: (ev: NativeSyntheticEvent<NativeScrollEvent>) => {
          const y = ev.nativeEvent.contentOffset.y;
          setClassHeroStatusBarLight((prev) => {
            const next = y < classHeroNavScrollRef.current.paperBy;
            return prev === next ? prev : next;
          });
        },
      },
    ),
    [mainScrollY],
  );

  useEffect(() => {
    if (!showHero) return;
    mainScrollY.setValue(0);
    setClassHeroStatusBarLight(true);
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [showHero, card.lesson?._id, mainScrollY]);

  const baseInfo = useMemo(() => {
    const src = card.lesson;
    if (!src || !src.startTime) return null;
    const start = new Date(src.startTime);
    const endRaw = src.endTime || getLessonEnd(src).toISOString();
    const end = new Date(endRaw);
    const now = new Date();

    const fmt = (d: Date): string => {
      if (timeFormat === '24h')
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    return {
      start,
      end,
      duration: src.duration || Math.round((end.getTime() - start.getTime()) / 60000),
      isPast: end < now,
      isNow: start <= now && end > now,
      isUpcoming: start > now,
      isCancelled: src.status === 'cancelled',
      price: src.price,
      notes: src.notes,
      timeRange: `${fmt(start)} – ${fmt(end)}`,
      dateLabel: start.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    };
  }, [card.lesson, timeFormat]);

  const info = useMemo(() => {
    if (!lesson || !lesson.startTime) return baseInfo;
    const start = new Date(lesson.startTime);
    const endRaw = lesson.endTime || getLessonEnd(lesson).toISOString();
    const end = new Date(endRaw);
    const now = new Date();

    const fmt = (d: Date): string => {
      if (timeFormat === '24h')
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    return {
      start,
      end,
      duration: lesson.duration || Math.round((end.getTime() - start.getTime()) / 60000),
      isPast: end < now,
      isNow: start <= now && end > now,
      isUpcoming: start > now,
      isCancelled: lesson.status === 'cancelled',
      price: lesson.price,
      notes: lesson.notes,
      timeRange: `${fmt(start)} – ${fmt(end)}`,
      dateLabel: start.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    };
  }, [lesson, timeFormat, baseInfo]);

  const dateHeaderParts = useMemo(() => {
    const baseTime = info?.timeRange || card.formattedTime || '';
    const timeLine =
      card.isClass && baseTime ? `${t('LESSONS_PAGE.CLASS')} · ${baseTime}` : baseTime;
    if (info?.start) {
      const { month, day } = formatDateBadgeParts(info.start);
      return { month, day, timeLine };
    }
    return {
      month: card.dateBadgeMonth,
      day: card.dateBadgeDay,
      timeLine,
    };
  }, [
    info?.start,
    info?.timeRange,
    card.dateBadgeMonth,
    card.dateBadgeDay,
    card.formattedTime,
    card.isClass,
    t,
  ]);

  const stColor = info?.isCancelled
    ? '#C13515'
    : info?.isNow
      ? C.accent
      : info?.isPast
        ? C.text
        : '#2E7D32';
  const stLabel = info?.isCancelled
    ? t('HOME.CANCELLED')
    : info?.isNow
      ? t('HOME.STARTED')
      : info?.isPast
        ? 'Completed'
        : 'Scheduled';

  const onShare = useCallback(async () => {
    try {
      const title = card.isClass ? card.className || card.lesson?.subject || 'Lesson' : card.otherName;
      const when = info?.dateLabel || card.formattedDate || '';
      await Share.share({
        message: Platform.OS === 'ios' ? `${title}\n${when}` : `${title} - ${when}`,
        title,
      });
    } catch (_err) {
      /* dismissed */
    }
  }, [card, info?.dateLabel]);

  const openMessagesTab = useCallback(() => {
    let n: any = navigation;
    for (let i = 0; i < 12; i += 1) {
      const names = n?.getState?.()?.routeNames;
      if (Array.isArray(names) && names.includes('Messages')) {
        n.navigate('Messages');
        close();
        return;
      }
      n = n?.getParent?.();
      if (!n) break;
    }
  }, [navigation, close]);

  const toggleRecSave = useCallback(async (matId: string) => {
    setRecMaterials(prev => prev.map(m => m._id === matId ? { ...m, isSaved: !m.isSaved } : m));
    try {
      const res = await materialService.toggleSaveMaterial(matId, id);
      if (res.success) {
        setRecMaterials(prev => prev.map(m => m._id === matId ? { ...m, isSaved: res.saved } : m));
      }
    } catch {
      setRecMaterials(prev => prev.map(m => m._id === matId ? { ...m, isSaved: !m.isSaved } : m));
    }
  }, [id]);

  const scoreColor = (v: number) => v >= 80 ? '#2E7D32' : v >= 60 ? '#E07912' : '#C13515';

  const isTutor = useMemo(() => {
    const mockRole = (lesson as any)?._mockViewRole;
    if (mockRole === 'tutor' || mockRole === 'student') return mockRole === 'tutor';
    const tid = String((lesson?.tutorId as any)?._id || lesson?.tutorId || '');
    return !!currentUserId && tid !== '' && tid === currentUserId;
  }, [lesson, currentUserId]);
  const isStudent = !isTutor;

  const aiAnalysis = (lesson as any)?.aiAnalysis;
  const hasAiSummary =
    !!aiAnalysis &&
    aiAnalysis.hasAnalysis &&
    aiAnalysis.status === 'completed' &&
    !!aiAnalysis.overallAssessment?.summary;

  const tf = (lesson as any)?.tutorFeedback;
  const hasTutorFeedback =
    !!tf &&
    tf.status === 'completed' &&
    (
      (Array.isArray(tf.strengths) && tf.strengths.length > 0) ||
      (Array.isArray(tf.areasForImprovement) && tf.areasForImprovement.length > 0) ||
      !!tf.overallNotes
    );

  const tutorNoteText = (lesson as any)?.tutorNote?.text || '';

  const isLessonCompleted = info?.isPast && !info?.isCancelled;
  const isAnalysisGenerating = !!(lesson as any)?.aiAnalysis && (lesson as any).aiAnalysis.status === 'generating';
  const isAnalysisUnavailable =
    isLessonCompleted &&
    !hasAiSummary &&
    !isAnalysisGenerating &&
    !!(lesson as any)?.aiAnalysisEnabledAtTime;

  const awaitingTutorFeedback =
    isStudent &&
    !!isLessonCompleted &&
    !hasTutorFeedback &&
    !tutorNoteText &&
    (
      !!(lesson as any)?.requiresTutorFeedback ||
      (!!tf && tf.status === 'pending' && tf.required !== false)
    );

  const lastCtx = (lesson as any)?.lastSessionContext;
  const hasLastSession = !!lastCtx && !lastCtx.isFirstLesson && !!lastCtx.summary;
  const lastSessionFocus: string[] = lastCtx?.recommendedFocus || [];

  const showRebook =
    !!info?.isCancelled &&
    isStudent &&
    !!(lesson?.tutorId?._id || lesson?.tutorId);

  const showJoinCta =
    !!info && !info.isCancelled && !info.isPast && (info.isNow || info.isUpcoming);
  const showCancelLesson =
    !!info && !info.isCancelled && info.isUpcoming && !info.isNow;
  const showMessageBtn = !!info && !isClass;
  const showStickyFooter = showJoinCta || showMessageBtn || showRebook;

  const joinGate = useMemo(() => getJoinGateState(lesson ?? undefined), [lesson, joinUiTick]);
  const joinPrimaryLabel = useMemo(() => {
    if (!lesson || !showJoinCta) return t('HOME.JOIN_LESSON');
    if (joinGate.canJoin) {
      if (isLessonInProgressSlot(lesson)) return t('HOME.JOIN_NOW');
      return isClass ? t('HOME.JOIN_CLASS') : t('HOME.JOIN_LESSON');
    }
    if (joinGate.sessionEnded) return t('HOME.JOIN_LESSON_ENDED_TITLE');
    return t('HOME.JOIN_IN_TIME', { time: formatTimeUntilLessonStart(lesson) });
  }, [lesson, showJoinCta, joinGate, isClass, t]);

  const notesDistinct =
    !!info?.notes &&
    String(info.notes).trim() !== String(card.cardDescText || '').trim();

  const otherUserBio = useMemo(() => {
    const other = isTutor ? lesson?.studentId : lesson?.tutorId;
    return other?.onboardingData?.bio || other?.onboardingData?.summary || '';
  }, [isTutor, lesson?.studentId, lesson?.tutorId]);

  /** Group class long description — mirrors web "About this class" (classData.description). */
  const aboutThisClassText = useMemo(() => {
    if (!isClass) return '';
    const raw = (lesson as { classData?: { description?: string } } | null)?.classData?.description;
    if (!raw || !String(raw).trim()) return '';
    return stripSimpleHtml(String(raw));
  }, [isClass, lesson]);

  /** Class roster: real `lesson.attendees` or mock preview (same as Up Next / web). */
  const goingAttendees = useMemo(
    () => (isClass ? resolveClassAttendeesForPreview(lesson) : []),
    [isClass, lesson],
  );

  const classGoingStackView = useMemo(() => {
    if (goingAttendees.length === 0) return null;
    const list = goingAttendees.slice(0, 4);
    const more = goingAttendees.length - 4;
    return (
      <View style={st.classGoingStackRow}>
        {list.map((a, i) => (
          <View
            key={`going-${i}`}
            style={[
              st.classGoingStackAv,
              {
                marginLeft: i > 0 ? -10 : 0,
                zIndex: 10 - i,
                borderColor: C.card,
                backgroundColor: isDark ? '#2c2c2e' : '#e8e8e8',
              },
            ]}
          >
            {(a as { picture?: string }).picture ? (
              <View style={st.classGoingStackAvClip}>
                <Image source={{ uri: (a as { picture: string }).picture }} style={st.classGoingStackImg} />
              </View>
            ) : (
              <Text style={[st.classGoingStackIni, { color: C.textSecondary }]}>{attendeeStackInitials(a)}</Text>
            )}
          </View>
        ))}
        {more > 0 ? (
          <Text style={[st.classGoingMore, { color: C.textTertiary, marginLeft: 10 }]}>+{more}</Text>
        ) : null}
      </View>
    );
  }, [goingAttendees, C.card, C.textTertiary, C.textSecondary, isDark]);

  const classGoingTutorId = useMemo(() => {
    const t = lesson ? (lesson as { tutorId?: { _id?: string; auth0Id?: string } | string }).tutorId : undefined;
    if (typeof t === 'string') return t;
    // Prefer auth0Id for messaging (backend resolves both shapes).
    return String(t?.auth0Id || t?._id || '');
  }, [lesson]);

  /**
   * Tutor → confirmed students broadcast. Fall back to seeded mock `auth0Id`s
   * when no real `confirmedStudents` are attached, matching the web flow so the
   * group message can be tested end-to-end against
   * `backend/scripts/seed-mock-class-students.js`.
   */
  const classGoingReceiverIds = useMemo(() => {
    if (!isClass || !isTutor) return [] as string[];
    const confirmed = (lesson as { confirmedStudents?: any[] } | null)?.confirmedStudents || [];
    const fromReal = confirmed
      .map((s: any) => String(s?.auth0Id || s?._id || s?.id || '').trim())
      .filter((id: string) => id && id !== currentUserId);
    if (fromReal.length > 0) return Array.from(new Set(fromReal));
    // No real students → use seeded mock auth0Ids so the UX is still testable.
    return MOCK_CLASS_ATTENDEES_PREVIEW
      .map((m) => String(m.auth0Id || '').trim())
      .filter((id) => !!id && id !== currentUserId);
  }, [isClass, isTutor, lesson, currentUserId]);

  // Same stack as the GOING row: real `lesson.attendees` or `MOCK_CLASS_ATTENDEES_PREVIEW`.
  // Clickable only when we actually have someone to message:
  //  - student → tutor: need `classGoingTutorId`.
  //  - tutor   → students: need at least one recipient (real or seeded mock).
  const canOpenClassGoingMessageModal = useMemo(
    () => {
      if (!isClass || goingAttendees.length === 0) return false;
      if (isStudent) return !!classGoingTutorId;
      if (isTutor) return classGoingReceiverIds.length > 0;
      return false;
    },
    [isClass, isStudent, isTutor, goingAttendees.length, classGoingTutorId, classGoingReceiverIds.length],
  );

  const classNameForGoingMessage = useMemo(
    () =>
      card.isClass
        ? card.className
          || (lesson as { classData?: { name?: string } } | null)?.classData?.name
          || (lesson as { subject?: string } | null)?.subject
          || ''
        : '',
    [card.isClass, card.className, lesson],
  );

  const onGoingMessageRowPress = useCallback(() => {
    if (!canOpenClassGoingMessageModal) return;
    // Always thread the class id through when this is a class, so the
    // backend can route to the stable class-broadcast thread whose
    // membership follows enrollment changes.
    const classIdForRequest = isClass && id ? String(id) : undefined;
    // Student → message the tutor (1:1). Tutor → broadcast to all confirmed
    // students (group thread, or direct DM if there's exactly one).
    if (isStudent) {
      onClassGoingMessageRequest?.({
        attendees: goingAttendees as ClassGoingMessageRequest['attendees'],
        receiverId: classGoingTutorId,
        className: classNameForGoingMessage || undefined,
        classId: classIdForRequest,
      });
    } else if (isTutor) {
      onClassGoingMessageRequest?.({
        attendees: goingAttendees as ClassGoingMessageRequest['attendees'],
        receiverIds: classGoingReceiverIds,
        className: classNameForGoingMessage || undefined,
        classId: classIdForRequest,
      });
    }
  }, [
    canOpenClassGoingMessageModal,
    isStudent,
    isTutor,
    isClass,
    id,
    onClassGoingMessageRequest,
    goingAttendees,
    classGoingTutorId,
    classGoingReceiverIds,
    classNameForGoingMessage,
  ]);

  const paymentStatus = useMemo(() => {
    if (!paymentData) return null;
    const p = paymentData;
    const status = p.status;
    const transferStatus = p.transferStatus;
    const isCancelled = lesson?.status === 'cancelled';
    const isLate = !!lesson?.isLateCancellation;
    const cancellationFee = lesson?.cancellationFeeCharged || 0;
    const refundAmt = p.refundAmount || 0;
    const amount = p.amount || 0;
    const tutorPayout = p.tutorPayout || 0;

    let icon = '';
    let title = '';
    let desc = '';
    let cls: 'refunded' | 'partial' | 'cancelled' | 'paid' | 'on-hold' | 'pending' = 'pending';
    const details: { key: string; value: string }[] = [];

    if (status === 'refunded') {
      cls = 'refunded';
      icon = 'arrow-undo-circle-outline';
      if (isStudent) {
        title = 'Payment refunded';
        desc = `$${refundAmt > 0 ? refundAmt.toFixed(2) : amount.toFixed(2)} was returned to your account.`;
        if (p.refundReason) details.push({ key: 'Reason', value: p.refundReason });
        if (p.refundMethod) details.push({ key: 'Refunded to', value: p.refundMethod === 'wallet' ? 'Wallet credit' : 'Original payment method' });
      } else {
        title = 'Payment reversed';
        desc = 'The payment for this lesson was refunded to the student.';
        if (p.refundReason) details.push({ key: 'Reason', value: p.refundReason });
      }
    } else if (status === 'partially_refunded') {
      cls = 'partial';
      icon = 'swap-horizontal-outline';
      if (isStudent) {
        title = 'Payment reduced';
        desc = `$${refundAmt.toFixed(2)} was refunded to your account.`;
        details.push({ key: 'Original amount', value: `$${amount.toFixed(2)}` });
        details.push({ key: 'Refunded', value: `$${refundAmt.toFixed(2)}` });
        details.push({ key: 'Final charge', value: `$${(amount - refundAmt).toFixed(2)}` });
      } else {
        title = 'Earnings adjusted';
        desc = 'The student received a partial refund. Your earnings were adjusted.';
        if (tutorPayout > 0) details.push({ key: 'Your earnings', value: `$${tutorPayout.toFixed(2)}` });
      }
    } else if (status === 'cancelled' || (isCancelled && status !== 'succeeded')) {
      cls = 'cancelled';
      icon = 'close-circle-outline';
      if (isStudent) {
        if (isLate && cancellationFee > 0) {
          title = 'Cancellation fee applied';
          desc = `A late cancellation fee of $${cancellationFee.toFixed(2)} was charged.`;
          if (amount - cancellationFee > 0) details.push({ key: 'Refunded', value: `$${(amount - cancellationFee).toFixed(2)}` });
          details.push({ key: 'Cancellation fee', value: `$${cancellationFee.toFixed(2)}` });
        } else {
          title = 'No charge applied';
          desc = 'The lesson was cancelled and no payment was charged.';
        }
      } else {
        if (isLate && cancellationFee > 0) {
          title = 'Late cancellation compensation';
          desc = `You earned $${tutorPayout > 0 ? tutorPayout.toFixed(2) : cancellationFee.toFixed(2)} from the late cancellation fee.`;
        } else {
          title = 'No earnings';
          desc = 'This lesson was cancelled. No earnings apply.';
        }
      }
    } else if (transferStatus === 'on_hold' || lesson?.payoutPaused) {
      cls = 'on-hold';
      icon = 'pause-circle-outline';
      title = isStudent ? 'Payment on hold' : 'Earnings on hold';
      desc = isStudent ? 'Your payment is on hold while this lesson is being reviewed.' : 'Your earnings are on hold while this lesson is being reviewed.';
    } else if (status === 'succeeded' || status === 'authorized') {
      const isFinished = lesson?.status === 'completed' || (lesson?.endTime && new Date(lesson.endTime).getTime() < Date.now());
      cls = isFinished ? 'paid' : 'pending';
      icon = isFinished ? 'checkmark-circle-outline' : 'time-outline';
      if (isStudent) {
        title = isFinished ? 'Payment complete' : 'Payment authorized';
        desc = isFinished ? `$${amount.toFixed(2)} was charged.` : `$${amount.toFixed(2)} will be charged after the lesson.`;
      } else {
        title = isFinished ? 'Earnings confirmed' : 'Earnings pending';
        desc = isFinished
          ? (tutorPayout > 0 ? `You earned $${tutorPayout.toFixed(2)} from this lesson.` : 'Your earnings have been confirmed.')
          : (tutorPayout > 0 ? `You'll earn $${tutorPayout.toFixed(2)} after this lesson.` : 'Your earnings will be confirmed after the lesson.');
      }
    } else {
      return null;
    }

    if (p.refundedAt && (status === 'refunded' || status === 'partially_refunded')) {
      details.push({ key: 'Date', value: new Date(p.refundedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) });
    }

    return { icon, title, desc, cls, details };
  }, [paymentData, lesson, isStudent, isTutor]);

  const formattedActualDuration = billingData?.actualDuration != null ? `${billingData.actualDuration} min` : '';
  const formattedActualPrice = billingData?.actualPrice != null ? `$${billingData.actualPrice.toFixed(2)}` : '';

  const paymentMethodInfo = useMemo(() => {
    const method = lesson?.paymentMethod || paymentData?.paymentMethod;
    if (!method || !isStudent) return null;
    const map: Record<string, { label: string; icon: string }> = {
      wallet: { label: 'Wallet', icon: 'wallet-outline' },
      card: { label: 'Credit / Debit card', icon: 'card-outline' },
      apple_pay: { label: 'Apple Pay', icon: 'logo-apple' },
      google_pay: { label: 'Google Pay', icon: 'logo-google' },
    };
    return map[method] || { label: method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' '), icon: 'card-outline' };
  }, [lesson?.paymentMethod, paymentData?.paymentMethod, isStudent]);

  const showClassEnrollmentCol = isClass && isTutor && !!info;
  const showPriceCol = !!info && !showClassEnrollmentCol && info.price !== undefined && info.price > 0;
  const enrollmentQuickVal = `${card.classStudentCount}/${Math.max(1, card.classCapacity || 1)}`;

  return (
    <>
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {showHero ? (
        <StatusBar style={isDark ? 'light' : (classHeroStatusBarLight ? 'light' : 'dark')} />
      ) : null}
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]} />

      {/* Surface — outer wrapper carries the shadow (no overflow clip
          because iOS won't draw shadows through overflow:hidden) and the
          interpolated frame. Inner `surfaceClip` view clips content to the
          rounded corners. */}
      <Animated.View
        style={[
          st.surfaceShadow,
          surfaceStyle,
          surfaceShadowStyle,
        ]}
      >
        <Animated.View
          style={[
            st.surfaceClip,
            {
              backgroundColor: C.card,
              borderWidth: showHero ? 0 : 1,
              borderColor: isDark ? C.border : 'rgba(0,0,0,0.06)',
            },
            surfaceClipStyle,
          ]}
        >

        {/* Header — non–class-cover only. Class back/share live OUTSIDE `surfaceClip` (see below)
            so they are not clipped by rounded corners and are not hidden by `headerStyle` opacity. */}
        {!showHero ? (
        <Animated.View
          style={[
            st.headerOuter,
            {
              backgroundColor: isDark ? '#000' : '#fff',
            },
            headerStyle,
          ]}
        >
          <View style={{ height: insets.top }} />
          <SolidToolbarWithBlur isDark={isDark}>
            <View style={st.headerInner}>
              <TouchableOpacity onPress={close} style={st.headerIconBtn} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
                <Ionicons name="close" size={26} color={C.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onShare} style={st.headerIconBtn} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
                <Ionicons name="share-outline" size={24} color={C.text} />
              </TouchableOpacity>
            </View>
          </SolidToolbarWithBlur>
        </Animated.View>
        ) : null}

        <Animated.View style={[st.body, bodyPadStyle]}>
          {/* BundleDetailScreen pattern: hero pinned behind scroll; fade/blur NATIVE-driven.
              `heroImgStyle` (Reanimated) is only used for the open/close morph (progress) —
              it stays static during scroll, so it can't "unstick" from the card. The inner
              dim/scale/blur layers use RN Animated + useNativeDriver so they move in exact
              lockstep with the ScrollView on iOS. */}
          {showHero ? (
            <Animated.View style={[st.classHeroPinned, heroImgStyle]} pointerEvents="none">
              <RNAnimated.View
                style={[
                  st.classHeroPinnedImageInner,
                  { opacity: classPinnedHeroDimOpacity, transform: [{ scale: classPinnedHeroScale }] },
                ]}
              >
                <Image source={{ uri: heroThumbUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </RNAnimated.View>
              <RNAnimated.View
                style={[StyleSheet.absoluteFill, { opacity: classHeroPinnedBlurCombined }]}
                pointerEvents="none"
              >
                <BlurView intensity={50} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              </RNAnimated.View>
              <RNAnimated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: C.card, opacity: classHeroHeroSurfaceBlend },
                ]}
              />
              {/*
                Top "gradient guard" (Airbnb): whiten the status-bar / sky band before the
                main sheet is fully up so the image never shows a hard line under the nav. */}
              <RNAnimated.View
                pointerEvents="none"
                style={[st.classHeroTopGuard, { opacity: classHeroTopGuardOpacity }]}
              >
                <LinearGradient
                  colors={isDark ? ['rgba(28,28,30,0.97)', 'rgba(28,28,30,0)'] : ['rgba(255,255,255,0.98)', 'rgba(255,255,255,0)']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                />
              </RNAnimated.View>
              <View style={st.classHeroPhotoPill} pointerEvents="none">
                <Text style={st.classHeroPhotoPillText}>{enrollmentQuickVal}</Text>
              </View>
            </Animated.View>
          ) : null}
          {/*
            Solid `C.card` bar sits UNDER the ScrollView (z1 vs z2) so the white card never
            scrolls *under* a second white layer — only the nav buttons sit above the sheet. */}
          {showHero ? (
            <RNAnimated.View
              pointerEvents="none"
              style={[
                st.classHeroToolbarSolidBg,
                st.classHeroToolbarUnderScroll,
                { height: insets.top + 50, backgroundColor: C.card, opacity: classHeroToolbarBarOpacity },
                {
                  borderBottomColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                },
              ]}
            />
          ) : null}
          <RNAnimated.ScrollView
            ref={mainScrollRef as any}
            style={[st.scrollFlex, showHero && st.classHeroScrollLayer]}
            contentContainerStyle={[
              showHero ? st.scrollClassHero : st.scroll,
              /**
               * Just enough room for the last row of content to scroll PAST the sticky footer,
               * so the footer visually floats while content passes under it (Apple/Airbnb feel).
               * Footer height ≈ 12 (pad top) + 48 (button) + 30 (link row) + bottom safe-area.
               * A small buffer (24) leaves a breath between the last scrollable row and the
               * translucent footer edge.
               */
              { paddingBottom: (showStickyFooter ? 90 + Math.max(insets.bottom, 12) + 24 : 40) },
            ]}
            showsVerticalScrollIndicator={false}
            bounces={true}
            scrollEventThrottle={16}
            onScroll={showHero ? onMainScroll : undefined}
            removeClippedSubviews={showHero ? false : undefined}
            nestedScrollEnabled
          >
            {showHero ? <Animated.View style={heroSpacerStyle} /> : null}
            <View
              style={
                showHero
                  ? [st.classHeroContentCard, { backgroundColor: C.card }]
                  : st.classHeroScrollInnerPlain
              }
            >
            {/* Hero: avatar + name */}
            <View style={[st.heroWrap, showHero && st.heroWrapClassSheet]}>
              <Animated.View style={avatarScaleStyle}>
                {isClass ? (
                  <View style={[st.classHeroBlock, showHero && st.classHeroBlockTight]}>
                    {classThumbUri && !showHero ? (
                      <Image source={{ uri: classThumbUri }} style={st.classCoverHero} resizeMode="cover" />
                    ) : null}
                    {card.classAttendees.length > 0 ? (
                      <View style={st.classAvatarRow}>
                        {card.classAttendees.length > 1 ? (
                          <>
                            {card.classAttendees.map((att, i) => (
                              <View
                                key={`${att.name}-${i}`}
                                style={[
                                  st.classStackAv,
                                  {
                                    marginLeft: i === 0 ? 0 : -12,
                                    borderColor: C.card,
                                    zIndex: 4 - i,
                                  },
                                ]}
                              >
                                {att.picture ? (
                                  <Image source={{ uri: att.picture }} style={st.classStackImg} />
                                ) : (
                                  <Text style={st.classStackIni}>{att.initials}</Text>
                                )}
                              </View>
                            ))}
                            {card.classAttendeesOverflow > 0 ? (
                              <Text style={[st.classStackMore, { color: C.textTertiary }]}>+{card.classAttendeesOverflow}</Text>
                            ) : null}
                          </>
                        ) : (
                          <View style={[st.avatar, st.avatarInClassRow, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8' }]}>
                            {card.classAttendees[0].picture ? (
                              <Image source={{ uri: card.classAttendees[0].picture }} style={st.avatarImgFill} />
                            ) : (
                              <Text style={[st.initials, { color: C.textSecondary }]}>{card.classAttendees[0].initials}</Text>
                            )}
                          </View>
                        )}
                      </View>
                    ) : null}
                  </View>
                ) : card.otherPicture && !showHero ? (
                  // Round-clip lives on the wrapping View, NOT on the Image.
                  // Applying `borderRadius + overflow:hidden` directly to an
                  // Image under a scaling parent transform makes iOS
                  // re-rasterise the rounded UIImageView every frame and
                  // blend that bitmap through CoreAnimation's minification
                  // filter — which is exactly what produces the "blur /
                  // overlay" the user sees as the avatar shrinks on close.
                  // Using a static View wrapper lets the clip be a cheap
                  // layer mask that doesn't get re-rasterised with the
                  // animated transform. Matches the class + initials
                  // avatar render paths (which already use this pattern).
                  <View style={st.avatar}>
                    <Image source={{ uri: card.otherPicture }} style={st.avatarImgFill} />
                  </View>
                ) : !card.otherPicture ? (
                  <View style={[st.avatar, { backgroundColor: isDark ? '#3a3a3c' : '#e8e8e8' }]}>
                    <Text style={[st.initials, { color: C.textSecondary }]}>{card.otherInitials}</Text>
                  </View>
                ) : null}
              </Animated.View>

              <Animated.View style={[nameScaleStyle, contentFadeStyle]}>
                <Text style={[st.name, { color: C.text }, showHero && st.nameOnClassHero]} numberOfLines={2}>
                  {card.isClass ? card.className || card.lesson?.subject : card.otherName}
                </Text>
              </Animated.View>

              <Animated.View style={[st.heroDateOuter, metaRevealStyle, contentFadeStyle]}>
                <LessonDateHeaderCenter
                  dateBadgeMonth={dateHeaderParts.month}
                  dateBadgeDay={dateHeaderParts.day}
                  timeLine={dateHeaderParts.timeLine}
                  isDark={isDark}
                  textPrimary={C.text}
                  textSecondary={C.textSecondary}
                />
              </Animated.View>

              {/* Compact info grid — duration, price, status + actual values */}
              {info ? (
                <Animated.View style={[st.quickGrid, { borderColor: isDark ? C.border : '#EBEBEB' }, metaRevealStyle, contentFadeStyle]}>
                  <View style={st.quickCell}>
                    <Text style={[st.goingCaption, { color: C.textTertiary }]} numberOfLines={1}>
                      {t('LESSONS_PAGE.CARD_STAT_DURATION')}
                    </Text>
                    <Text style={[st.quickVal, { color: C.text }]} numberOfLines={1}>
                      {info.duration} min
                    </Text>
                    <View style={st.quickSubSlot}>
                      {formattedActualDuration ? (
                        <Animated.Text style={[st.quickValSub, { color: C.textTertiary }, asyncSubStyle]} numberOfLines={1}>
                          {formattedActualDuration} actual
                        </Animated.Text>
                      ) : null}
                    </View>
                  </View>
                  {showPriceCol ? (
                    <>
                      <View style={[st.quickDivider, { backgroundColor: isDark ? C.border : '#E0E0E0' }]} />
                      <View style={st.quickCell}>
                        <Text style={[st.goingCaption, { color: C.textTertiary }]} numberOfLines={1}>
                          {t('LESSONS_PAGE.CARD_STAT_PRICE')}
                        </Text>
                        <Text style={[st.quickVal, { color: C.text }]} numberOfLines={1}>
                          ${(info.price ?? 0).toFixed(2)}
                        </Text>
                        <View style={st.quickSubSlot}>
                          {formattedActualPrice ? (
                            <Animated.Text style={[st.quickValSub, { color: C.textTertiary }, asyncSubStyle]} numberOfLines={1}>
                              {formattedActualPrice} final
                            </Animated.Text>
                          ) : null}
                        </View>
                      </View>
                    </>
                  ) : showClassEnrollmentCol ? (
                    <>
                      <View style={[st.quickDivider, { backgroundColor: isDark ? C.border : '#E0E0E0' }]} />
                      <View style={st.quickCell}>
                        {classGoingStackView ? (
                          <Pressable
                            onPress={onGoingMessageRowPress}
                            disabled={!canOpenClassGoingMessageModal}
                            style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}
                            accessibilityLabel="Going — message"
                          >
                            <Text style={[st.goingCaption, { color: C.textTertiary }]} numberOfLines={1}>
                              {t('LESSONS_PAGE.GOING')}
                            </Text>
                            {classGoingStackView}
                            <View style={st.quickSubSlot} />
                          </Pressable>
                        ) : (
                          <>
                            <Text style={[st.goingCaption, { color: C.textTertiary }]} numberOfLines={1}>
                              {t('LESSONS_PAGE.CARD_STAT_ENROLLED')}
                            </Text>
                            <Text style={[st.quickVal, { color: C.text }]} numberOfLines={1}>
                              {enrollmentQuickVal}
                            </Text>
                            <View style={st.quickSubSlot} />
                          </>
                        )}
                      </View>
                    </>
                  ) : null}
                  <View style={[st.quickDivider, { backgroundColor: isDark ? C.border : '#E0E0E0' }]} />
                  <View style={st.quickCell}>
                    <Text style={[st.goingCaption, { color: C.textTertiary }]} numberOfLines={1}>
                      {t('LESSONS_PAGE.CARD_STAT_STATUS')}
                    </Text>
                    <Text style={[st.quickVal, { color: stColor }]} numberOfLines={1}>
                      {stLabel}
                    </Text>
                    <View style={st.quickSubSlot} />
                  </View>
                </Animated.View>
              ) : null}
              {isClass && !showClassEnrollmentCol && classGoingStackView ? (
                <Animated.View
                  style={[st.classGoingSection, metaRevealStyle, contentFadeStyle]}
                  pointerEvents="box-none"
                >
                  <Pressable
                    onPress={onGoingMessageRowPress}
                    style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}
                    accessibilityLabel="Going — message"
                  >
                    <Text
                      style={[st.goingCaption, { color: C.textTertiary, marginBottom: 8 }]}
                      numberOfLines={1}
                    >
                      {t('LESSONS_PAGE.GOING')}
                    </Text>
                    {classGoingStackView}
                  </Pressable>
                </Animated.View>
              ) : null}
            </View>

            {/* Expanded detail sections — deferred until open animation settles */}
            {detailMounted ? (
            <Animated.View style={[st.detailColumn, showHero && st.detailColumnClassSheet, detailStyle, contentFadeStyle]}>

              {/* ── About this class (group) ── */}
              {aboutThisClassText ? (
                <View>
                  <Text style={[st.sectionHeading, { color: C.text, marginTop: 0, marginBottom: 10 }]}>
                    {t('LESSONS_PAGE.ABOUT_THIS_CLASS')}
                  </Text>
                  <Text style={[st.noteBody, { color: C.textSecondary, marginTop: 0, marginBottom: 0 }]}>{aboutThisClassText}</Text>
                </View>
              ) : null}

              {/* ── About the other person (1:1 bio) ── */}
              {otherUserBio ? (
                <>
                  {aboutThisClassText ? (
                    <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 20, marginBottom: 4 }]} />
                  ) : null}
                  <Text style={[st.bio, { color: C.textSecondary }]}>{otherUserBio}</Text>
                </>
              ) : null}

              {/* ── Last Session Context (upcoming lessons) ── */}
              {hasLastSession ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 4 }]} />
                  <Text style={[st.sectionHeading, { color: C.text }]}>Last session</Text>
                  <Text style={[st.noteBody, { color: C.textSecondary, marginBottom: lastSessionFocus.length ? 12 : 0 }]}>
                    {lastCtx.summary}
                  </Text>
                  {lastSessionFocus.length > 0 ? (
                    <View style={{ marginBottom: 4 }}>
                      <Text style={[st.focusSubLabel, { color: C.text }]}>Recommended focus</Text>
                      {lastSessionFocus.map((f: string, i: number) => (
                        <View key={i} style={st.focusBulletRow}>
                          <Text style={[st.focusBullet, { color: C.textSecondary }]}>{'\u2022'}</Text>
                          <Text style={[st.focusBulletText, { color: C.textSecondary }]}>{f}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}

              {/* ── Awaiting Tutor Feedback (student) ── */}
              {awaitingTutorFeedback ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 4 }]} />
                  <View style={[st.awaitingBanner, { backgroundColor: isDark ? '#2c1f0f' : '#FFF8E1' }]}>
                    <Ionicons name="time-outline" size={20} color="#E07912" style={{ marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: isDark ? '#FFB74D' : '#E07912', fontSize: 14, fontWeight: '600' }}>Awaiting tutor feedback</Text>
                      <Text style={{ color: isDark ? '#BFA070' : '#C17A26', fontSize: 12, marginTop: 2 }}>Your tutor hasn't submitted feedback yet</Text>
                    </View>
                  </View>
                </>
              ) : null}

              {/* ── Generating Analysis ── */}
              {isAnalysisGenerating && isStudent ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 4 }]} />
                  <View style={[st.generatingCard, { backgroundColor: isDark ? '#1c1c1e' : '#f9f9f9' }]}>
                    <ActivityIndicator size="small" color={C.accent} style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[{ fontSize: 14, fontWeight: '600' }, { color: C.text }]}>Generating analysis</Text>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>Your lesson analysis is being prepared...</Text>
                    </View>
                  </View>
                </>
              ) : null}

              {/* ── Analysis Unavailable ── */}
              {isAnalysisUnavailable && isStudent ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 4 }]} />
                  <View style={[st.generatingCard, { backgroundColor: isDark ? '#1c1c1e' : '#f9f9f9' }]}>
                    <Ionicons name="analytics-outline" size={20} color={C.textTertiary} style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[{ fontSize: 14, fontWeight: '600' }, { color: C.text }]}>Analysis unavailable</Text>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>We couldn't generate an analysis for this lesson</Text>
                    </View>
                  </View>
                </>
              ) : null}

              {/* ── AI Analysis ── */}
              {hasAiSummary ? (
                <View style={st.notesSectionBlock}>
                  {!info ? (
                    <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB' }]} />
                  ) : null}
                  <View style={st.fbHeaderRow}>
                    <Text style={[st.sectionHeading, { color: C.text, marginBottom: 0 }]}>Notes</Text>
                    {aiAnalysis.overallAssessment?.proficiencyLevel ? (
                      <View style={[st.cefrBadge, { backgroundColor: isDark ? '#1a2e1a' : '#E8F5E9' }]}>
                        <Text style={st.cefrText}>{aiAnalysis.overallAssessment.proficiencyLevel}</Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={[st.noteBody, { color: C.textSecondary, marginTop: 12, marginBottom: 16 }]}>
                    {aiAnalysis.overallAssessment.summary}
                  </Text>

                  {(aiAnalysis.grammarAnalysis?.accuracyScore != null ||
                    aiAnalysis.fluencyAnalysis?.overallFluencyScore != null ||
                    aiAnalysis.pronunciationAnalysis?.overallScore != null ||
                    !!aiAnalysis.vocabularyAnalysis?.vocabularyRange) ? (
                    <View style={st.analysisScoresRow}>
                      {aiAnalysis.grammarAnalysis?.accuracyScore != null ? (
                        <View
                          style={[
                            st.analysisScoreCell,
                            { borderColor: isDark ? C.border : 'rgba(0,0,0,0.08)' },
                          ]}
                        >
                          <Text style={[st.analysisScoreNum, { color: scoreColor(aiAnalysis.grammarAnalysis.accuracyScore) }]}>
                            {aiAnalysis.grammarAnalysis.accuracyScore}
                          </Text>
                          <Text style={[st.analysisScoreName, { color: C.textSecondary }]}>Grammar</Text>
                        </View>
                      ) : null}
                      {aiAnalysis.fluencyAnalysis?.overallFluencyScore != null ? (
                        <View
                          style={[
                            st.analysisScoreCell,
                            { borderColor: isDark ? C.border : 'rgba(0,0,0,0.08)' },
                          ]}
                        >
                          <Text style={[st.analysisScoreNum, { color: scoreColor(aiAnalysis.fluencyAnalysis.overallFluencyScore) }]}>
                            {aiAnalysis.fluencyAnalysis.overallFluencyScore}
                          </Text>
                          <Text style={[st.analysisScoreName, { color: C.textSecondary }]}>Fluency</Text>
                        </View>
                      ) : null}
                      {aiAnalysis.pronunciationAnalysis?.overallScore != null ? (
                        <View
                          style={[
                            st.analysisScoreCell,
                            { borderColor: isDark ? C.border : 'rgba(0,0,0,0.08)' },
                          ]}
                        >
                          <Text style={[st.analysisScoreNum, { color: scoreColor(aiAnalysis.pronunciationAnalysis.overallScore) }]}>
                            {aiAnalysis.pronunciationAnalysis.overallScore}
                          </Text>
                          <Text style={[st.analysisScoreName, { color: C.textSecondary }]}>Pronunciation</Text>
                        </View>
                      ) : null}
                      {aiAnalysis.vocabularyAnalysis?.vocabularyRange ? (
                        <View
                          style={[
                            st.analysisScoreCell,
                            { borderColor: isDark ? C.border : 'rgba(0,0,0,0.08)' },
                          ]}
                        >
                          <Text style={[st.analysisScoreWord, { color: C.text }]} numberOfLines={2}>
                            {aiAnalysis.vocabularyAnalysis.vocabularyRange}
                          </Text>
                          <Text style={[st.analysisScoreName, { color: C.textSecondary }]}>Vocabulary</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {Array.isArray(aiAnalysis.topicsDiscussed) && aiAnalysis.topicsDiscussed.length > 0 ? (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={[st.fbSubLabel, { color: C.text }]}>Topics covered</Text>
                      <View style={st.topicPills}>
                        {aiAnalysis.topicsDiscussed.map((topic: string, i: number) => (
                          <View key={i} style={[st.topicPill, { backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }]}>
                            <Text style={[st.topicPillText, { color: C.text }]}>{topic}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {Array.isArray(aiAnalysis.recommendedFocus) && aiAnalysis.recommendedFocus.length > 0 ? (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={[st.fbSubLabel, { color: C.text }]}>Recommended focus</Text>
                      {aiAnalysis.recommendedFocus.map((item: string, i: number) => (
                        <View key={i} style={st.bulletItem}>
                          <Ionicons name="arrow-forward-circle-outline" size={14} color={isDark ? '#93C5FD' : '#1D4ED8'} style={{ marginRight: 8, marginTop: 3 }} />
                          <Text style={[st.bulletText, { color: C.textSecondary }]}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {aiAnalysis.progressionMetrics?.keyImprovements?.length > 0 ? (
                    <View style={st.bulletList}>
                      {aiAnalysis.progressionMetrics.keyImprovements.map((item: string, i: number) => (
                        <View key={i} style={st.bulletItem}>
                          <Ionicons name="trending-up" size={14} color="#2E7D32" style={{ marginRight: 8, marginTop: 2 }} />
                          <Text style={[st.bulletText, { color: C.text }]}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {aiAnalysis.studentSummary ? (
                    <View style={[st.summaryCard, { backgroundColor: isDark ? '#1c1c1e' : '#f9f9f9' }]}>
                      <Ionicons name="bulb-outline" size={16} color={isDark ? '#FFD60A' : '#E07912'} style={{ marginRight: 10, marginTop: 1 }} />
                      <Text style={[st.summaryText, { color: C.textSecondary }]}>{aiAnalysis.studentSummary}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* ── Tutor Feedback ── */}
              {hasTutorFeedback ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: hasAiSummary ? 16 : 0 }]} />
                  <View style={st.fbHeaderRow}>
                    <Text style={[st.sectionHeading, { color: C.text, marginBottom: 0 }]}>Tutor feedback</Text>
                    {tf.estimatedCefrLevel ? (
                      <View style={[st.cefrBadge, { backgroundColor: isDark ? '#1a2e1a' : '#E8F5E9' }]}>
                        <Text style={st.cefrText}>{tf.estimatedCefrLevel}</Text>
                      </View>
                    ) : null}
                  </View>

                  {tf.overallNotes ? (
                    <Text style={[st.noteBody, { color: C.textSecondary, marginTop: 12, marginBottom: 12 }]}>
                      {tf.overallNotes}
                    </Text>
                  ) : null}

                  {Array.isArray(tf.strengths) && tf.strengths.length > 0 ? (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={[st.fbSubLabel, { color: C.text }]}>Strengths</Text>
                      {tf.strengths.map((s: string, i: number) => (
                        <View key={i} style={st.bulletItem}>
                          <View style={[st.fbDot, { backgroundColor: '#2E7D32' }]} />
                          <Text style={[st.bulletText, { color: C.textSecondary }]}>{s}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {Array.isArray(tf.areasForImprovement) && tf.areasForImprovement.length > 0 ? (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={[st.fbSubLabel, { color: C.text }]}>Areas for improvement</Text>
                      {tf.areasForImprovement.map((s: string, i: number) => (
                        <View key={i} style={st.bulletItem}>
                          <View style={[st.fbDot, { backgroundColor: '#E07912' }]} />
                          <Text style={[st.bulletText, { color: C.textSecondary }]}>{s}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}

              {/* ── Tutor Note ── */}
              {tutorNoteText && !hasTutorFeedback ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: hasAiSummary ? 16 : 0 }]} />
                  <Text style={[st.sectionHeading, { color: C.text }]}>Tutor note</Text>
                  <Text style={[st.noteBody, { color: C.textSecondary }]}>{tutorNoteText}</Text>
                </>
              ) : null}

              {/* ── Payment method + trial badge ── */}
              {info && (paymentMethodInfo || card.isTrial) ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB' }]} />
                  <View style={st.detailGrid}>
                    {paymentMethodInfo ? (
                      <View style={st.detailGridItem}>
                        <Ionicons name={paymentMethodInfo.icon as any} size={18} color={C.textTertiary} style={st.detailGridIcon} />
                        <View>
                          <Text style={[st.detailGridPrimary, { color: C.text }]}>{paymentMethodInfo.label}</Text>
                          <Text style={[st.detailGridSecondary, { color: C.textSecondary }]}>Payment method</Text>
                        </View>
                      </View>
                    ) : null}
                    {card.isTrial ? (
                      <View style={st.detailGridItem}>
                        <View style={[st.trialPill, { marginBottom: 0 }]}>
                          <Ionicons name="star" size={10} color="#fff" />
                          <Text style={st.trialPillText}>{t('LESSONS_PAGE.TRIAL_BADGE')}</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}

              {/* ── Notes fallback (no AI analysis) ── */}
              {!hasAiSummary && info?.notes ? (
                <>
                  <Text style={[st.sectionHeading, { color: C.text, marginTop: 28 }]}>Notes</Text>
                  <Text style={[st.noteBody, { color: C.textSecondary }]}>{info.notes}</Text>
                </>
              ) : null}

              {/* ── Cancellation ── */}
              {info && info.isCancelled ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 16 }]} />
                  <Text style={[st.sectionHeading, { color: C.text }]}>Cancellation</Text>
                  {lesson?.cancelledBy ? (
                    <View style={st.kvRow}>
                      <Text style={[st.kvKey, { color: C.textSecondary }]}>Cancelled by</Text>
                      <Text style={[st.kvVal, { color: C.text }]}>
                        {lesson.cancelledBy === 'tutor' ? 'Tutor' : lesson.cancelledBy === 'student' ? 'Student' : lesson.cancelledBy === 'system' ? 'System' : 'Unknown'}
                      </Text>
                    </View>
                  ) : null}
                  {lesson?.cancelReason ? (
                    <View style={st.kvRow}>
                      <Text style={[st.kvKey, { color: C.textSecondary }]}>Reason</Text>
                      <Text style={[st.kvVal, { color: C.text }]}>{lesson.cancelReason}</Text>
                    </View>
                  ) : null}
                  {lesson?.cancelledAt ? (
                    <View style={st.kvRow}>
                      <Text style={[st.kvKey, { color: C.textSecondary }]}>Date</Text>
                      <Text style={[st.kvVal, { color: C.text }]}>
                        {new Date(lesson.cancelledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                  ) : null}
                  {lesson?.isLateCancellation ? (
                    <View style={[st.warningBanner, { backgroundColor: '#FFF3E0', marginTop: 8 }]}>
                      <Ionicons name="warning-outline" size={16} color="#E07912" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#E07912', fontSize: 13, fontWeight: '500', flex: 1 }}>Late cancellation - fee may apply</Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              {/* ── Payment Status ── */}
              {paymentStatus ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 16 }]} />
                  <Text style={[st.sectionHeading, { color: C.text }]}>Payment status</Text>
                  <View style={[st.paymentCard, { backgroundColor: isDark ? '#1c1c1e' : '#f9f9f9' }]}>
                    <View style={st.paymentHeader}>
                      <View style={[st.paymentIconWrap, {
                        backgroundColor: paymentStatus.cls === 'paid' ? '#E8F5E9' : paymentStatus.cls === 'refunded' ? '#FFF3E0' : paymentStatus.cls === 'cancelled' ? '#FFEBEE' : paymentStatus.cls === 'on-hold' ? '#FFF8E1' : '#E3F2FD',
                      }]}>
                        <Ionicons name={paymentStatus.icon as any} size={20} color={
                          paymentStatus.cls === 'paid' ? '#2E7D32' : paymentStatus.cls === 'refunded' ? '#E07912' : paymentStatus.cls === 'cancelled' ? '#C13515' : paymentStatus.cls === 'on-hold' ? '#F5A623' : '#1976D2'
                        } />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[st.paymentTitle, { color: C.text }]}>{paymentStatus.title}</Text>
                        <Text style={[st.paymentDesc, { color: C.textSecondary }]}>{paymentStatus.desc}</Text>
                      </View>
                    </View>
                    {paymentStatus.details.length > 0 ? (
                      <View style={[st.paymentDetails, { borderTopColor: isDark ? C.border : '#EBEBEB' }]}>
                        {paymentStatus.details.map((d, i) => (
                          <View key={i} style={st.kvRow}>
                            <Text style={[st.kvKey, { color: C.textSecondary }]}>{d.key}</Text>
                            <Text style={[st.kvVal, { color: C.text }]}>{d.value}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}

              {/* ── Tip ── */}
              {lesson?.tip && lesson.tip.amount && lesson.tip.amount > 0 ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 16 }]} />
                  <Text style={[st.sectionHeading, { color: C.text }]}>
                    {isTutor ? t('LESSONS_PAGE.TIP_RECEIVED') : t('LESSONS_PAGE.TIP_SENT')}
                  </Text>
                  <View style={[st.tipBanner, { backgroundColor: isDark ? '#1a2e1a' : '#E8F5E9' }]}>
                    <Ionicons name="heart" size={18} color="#2E7D32" style={{ marginRight: 10 }} />
                    <Text style={{ color: '#2E7D32', fontSize: 15, fontWeight: '600' }}>${lesson.tip.amount.toFixed(2)}</Text>
                  </View>
                </>
              ) : null}

              {/* ── Issue ── */}
              {lesson?.issueReported ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 16 }]} />
                  <View style={st.issueRow}>
                    <Ionicons name="flag" size={18} color="#C13515" style={{ marginRight: 10 }} />
                    <Text style={{ color: '#C13515', fontSize: 14, fontWeight: '500', flex: 1 }}>
                      {lesson.investigationResolvedAt ? 'Issue resolved' : t('LESSONS_PAGE.ISSUE_REPORTED')}
                    </Text>
                  </View>
                </>
              ) : null}

              {/* ── Feedback status (tutor needs to leave) ── */}
              {lesson?.tutorFeedback && lesson.tutorFeedback.status === 'pending' && lesson.tutorFeedback.required !== false && isTutor ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 16 }]} />
                  <TouchableOpacity
                    style={[st.feedbackBanner, { backgroundColor: isDark ? '#2c1f0f' : '#FFF3E0' }]}
                    activeOpacity={0.75}
                    onPress={() => {
                      const id = lesson?._id;
                      if (!id) return;
                      const root = getRootNavigation(navigation);
                      root?.navigate?.('PostLessonTutor', { lessonId: id });
                    }}
                  >
                    <Ionicons name="clipboard-outline" size={20} color="#E07912" style={{ marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: isDark ? '#FFB74D' : '#E07912', fontSize: 14, fontWeight: '600' }}>Feedback outstanding</Text>
                      <Text style={{ color: isDark ? '#BFA070' : '#C17A26', fontSize: 12, marginTop: 2 }}>Leave feedback while the lesson is fresh</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={isDark ? '#BFA070' : '#C17A26'} />
                  </TouchableOpacity>
                </>
              ) : null}

              {/* ── Your Feedback (tutor already submitted) ── */}
              {isTutor && hasTutorFeedback ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 16 }]} />
                  <View style={st.fbHeaderRow}>
                    <Text style={[st.sectionHeading, { color: C.text, marginBottom: 0 }]}>Your feedback</Text>
                    {tf.estimatedCefrLevel ? (
                      <View style={[st.cefrBadge, { backgroundColor: isDark ? '#1a2e1a' : '#E8F5E9' }]}>
                        <Text style={st.cefrText}>{tf.estimatedCefrLevel}</Text>
                      </View>
                    ) : null}
                  </View>
                  {tf.overallNotes ? (
                    <Text style={[st.noteBody, { color: C.textSecondary, marginTop: 12, marginBottom: 8 }]}>{tf.overallNotes}</Text>
                  ) : null}
                  {Array.isArray(tf.strengths) && tf.strengths.length > 0 ? (
                    <View style={{ marginTop: 8, marginBottom: 8 }}>
                      <Text style={[st.fbSubLabel, { color: C.text }]}>Strengths</Text>
                      {tf.strengths.map((s: string, i: number) => (
                        <View key={i} style={st.bulletItem}>
                          <View style={[st.fbDot, { backgroundColor: '#2E7D32' }]} />
                          <Text style={[st.bulletText, { color: C.textSecondary }]}>{s}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {Array.isArray(tf.areasForImprovement) && tf.areasForImprovement.length > 0 ? (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={[st.fbSubLabel, { color: C.text }]}>Areas for improvement</Text>
                      {tf.areasForImprovement.map((s: string, i: number) => (
                        <View key={i} style={st.bulletItem}>
                          <View style={[st.fbDot, { backgroundColor: '#E07912' }]} />
                          <Text style={[st.bulletText, { color: C.textSecondary }]}>{s}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}

              {/* ── Tutor Note (tutor view, standalone) ── */}
              {isTutor && tutorNoteText && !hasTutorFeedback ? (
                <>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB', marginTop: 16 }]} />
                  <Text style={[st.sectionHeading, { color: C.text }]}>Your note</Text>
                  <Text style={[st.noteBody, { color: C.textSecondary }]}>{tutorNoteText}</Text>
                </>
              ) : null}

              {/* ── Recommended Materials (student only) ── */}
              {isStudent && recMaterials.length > 0 ? (
                <View style={st.recSection}>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB' }]} />
                  <Text style={[st.sectionHeading, { color: C.text }]}>Practice these areas</Text>
                  <Text style={[st.recSubtitle, { color: C.textSecondary }]}>Based on your recent lessons</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={st.recScroll}
                  >
                    {recMaterials.map((mat) => (
                      <TouchableOpacity
                        key={mat._id}
                        style={[st.recCard, { backgroundColor: isDark ? '#1c1c1e' : '#fff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}
                        activeOpacity={0.85}
                        onPress={() => {
                          const root = getRootNavigation(navigation);
                          root?.navigate?.('MaterialDetail', { materialId: mat._id });
                        }}
                      >
                        {mat.thumbnailUrl ? (
                          <Image source={{ uri: mat.thumbnailUrl }} style={st.recThumb} />
                        ) : (
                          <View style={[st.recThumbEmpty, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f0' }]}>
                            <Ionicons name={mat.materialType === 'video_quiz' ? 'videocam' : mat.materialType === 'reading' ? 'book' : 'headset'} size={24} color={isDark ? '#555' : '#bbb'} />
                          </View>
                        )}
                        <View style={st.recBody}>
                          <Text style={[st.recType, { color: C.textSecondary }]}>
                            {mat.materialType === 'video_quiz' ? 'VIDEO QUIZ' : mat.materialType === 'reading' ? 'READING' : 'LISTENING'}
                          </Text>
                          <Text style={[st.recTitle, { color: C.text }]} numberOfLines={2}>{mat.title}</Text>
                          {mat.tutorId?.firstName ? (
                            <View style={st.recTutorRow}>
                              <Text style={[st.recTutor, { color: C.textSecondary }]}>
                                {mat.tutorId.firstName} {(mat.tutorId.lastName || '').charAt(0)}.
                              </Text>
                              {mat._isCurrentTutor ? (
                                <View style={[st.recTutorBadge, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f0' }]}>
                                  <Text style={[st.recTutorBadgeText, { color: isDark ? '#aaa' : '#555' }]}>Your tutor</Text>
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                          {mat._matchedStruggles && mat._matchedStruggles.length > 0 ? (
                            <View style={st.recStruggles}>
                              {mat._matchedStruggles.slice(0, 2).map((s, i) => (
                                <View key={i} style={[st.recStrugglePill, { backgroundColor: isDark ? 'rgba(30,64,175,0.2)' : '#EFF6FF' }]}>
                                  <Text style={[st.recStruggleText, { color: isDark ? '#93C5FD' : '#1E40AF' }]} numberOfLines={1}>{s}</Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={[
                            st.recSaveBtn,
                            mat.isSaved && st.recSaveBtnActive,
                            { borderColor: mat.isSaved ? (isDark ? '#fff' : '#111') : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)') },
                            mat.isSaved && { backgroundColor: isDark ? '#fff' : '#111' },
                          ]}
                          activeOpacity={0.7}
                          onPress={() => {
                            toggleRecSave(mat._id);
                          }}
                        >
                          <Ionicons
                            name={mat.isSaved ? 'bookmark' : 'bookmark-outline'}
                            size={14}
                            color={mat.isSaved ? (isDark ? '#000' : '#fff') : (isDark ? '#8e8e93' : '#666')}
                          />
                          <Text style={[st.recSaveBtnText, { color: mat.isSaved ? (isDark ? '#000' : '#fff') : (isDark ? '#8e8e93' : '#666') }]}>
                            {mat.isSaved ? 'Saved' : 'Save'}
                          </Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {isStudent && recLoading && recMaterials.length === 0 ? (
                <View style={st.recSection}>
                  <View style={[st.hairline, { backgroundColor: isDark ? C.border : '#EBEBEB' }]} />
                  <View style={st.recLoadingRow}>
                    <ActivityIndicator size="small" color={C.textSecondary} />
                    <Text style={[st.recLoadingText, { color: C.textSecondary }]}>Finding recommendations…</Text>
                  </View>
                </View>
              ) : null}

            </Animated.View>
            ) : null}
            </View>
          </RNAnimated.ScrollView>

          {showHero ? (
            <View
              style={[st.classHeroButtonsOverlay, { paddingTop: insets.top + 8, paddingHorizontal: 20 }]}
              pointerEvents="box-none"
            >
              <TouchableOpacity
                onPress={close}
                style={st.classHeroHeaderHit}
                activeOpacity={0.85}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <View style={st.classHeroIconCrossfade}>
                  <RNAnimated.View style={[st.classHeroIconLayer, { opacity: classHeroPillsOpacity }]}>
                    <View
                      style={[
                        st.classHeroBackBtn,
                        {
                          backgroundColor: isDark ? 'rgba(44,44,46,0.78)' : 'rgba(244, 242, 248, 0.96)',
                          borderColor: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.14)',
                        },
                      ]}
                    >
                      <Ionicons
                        name="arrow-back"
                        size={20}
                        color={isDark ? 'rgba(255,255,255,0.95)' : 'rgba(20,20,20,0.9)'}
                      />
                    </View>
                  </RNAnimated.View>
                  <RNAnimated.View style={[st.classHeroIconLayer, { opacity: classHeroBarIconOpacity }]}>
                    <Ionicons name="arrow-back" size={24} color={C.text} />
                  </RNAnimated.View>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onShare}
                style={st.classHeroHeaderHit}
                activeOpacity={0.85}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Share"
              >
                <View style={st.classHeroIconCrossfade}>
                  <RNAnimated.View style={[st.classHeroIconLayer, { opacity: classHeroPillsOpacity }]}>
                    <View
                      style={[
                        st.classHeroShareBtn,
                        { backgroundColor: isDark ? 'rgba(50,50,55,0.72)' : 'rgba(255,255,255,0.96)' },
                      ]}
                    >
                      <Ionicons
                        name="share-outline"
                        size={20}
                        color={isDark ? 'rgba(255,255,255,0.95)' : 'rgba(20,20,20,0.88)'}
                      />
                    </View>
                  </RNAnimated.View>
                  <RNAnimated.View style={[st.classHeroIconLayer, { opacity: classHeroBarIconOpacity }]}>
                    <Ionicons name="share-outline" size={24} color={C.text} />
                  </RNAnimated.View>
                </View>
              </TouchableOpacity>
            </View>
          ) : null}

          {showStickyFooter ? (
            <Animated.View
              style={[
                st.stickyFooter,
                {
                  // Translucent card color so the BlurView shows scrolling content through it.
                  backgroundColor: isDark ? 'rgba(28,28,30,0.78)' : 'rgba(255,255,255,0.82)',
                  borderTopColor: isDark ? C.border : '#EBEBEB',
                  paddingBottom: Math.max(insets.bottom, 12),
                },
                footerFadeStyle,
              ]}
            >
              <BlurView
                intensity={40}
                tint={isDark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
              <View style={st.stickyRow}>
                {showJoinCta ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[
                      st.stickyBtn,
                      st.stickyBtnFlex,
                      { backgroundColor: C.joinCtaBackground },
                    ]}
                    activeOpacity={joinGate.canJoin ? 0.88 : 1}
                    onPress={() => {
                      const lid = lesson?._id;
                      if (!lid) return;
                      const gate = getJoinGateState(lesson);
                      if (!gate.canJoin) {
                        if (gate.sessionEnded) {
                          Alert.alert(t('HOME.JOIN_LESSON_ENDED_TITLE'), t('HOME.JOIN_LESSON_ENDED_MSG'), [
                            { text: t('COMMON.OK') },
                          ]);
                          return;
                        }
                        Alert.alert(
                          t('HOME.JOIN_NOT_READY_TITLE'),
                          t('HOME.JOIN_NOT_READY_MSG', {
                            session: t(isClass ? 'HOME.JOIN_SESSION_CLASS' : 'HOME.JOIN_SESSION_LESSON'),
                            time: formatTimeUntilLessonStart(lesson),
                          }),
                          [{ text: t('COMMON.OK') }],
                        );
                        return;
                      }
                      const root = getRootNavigation(navigation);
                      root?.navigate?.('PreCall', { lessonId: lid, isClass });
                    }}
                  >
                    <Ionicons
                      name="videocam"
                      size={18}
                      color="#ffffff"
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[st.stickyBtnText, { color: '#ffffff' }]}
                    >
                      {joinPrimaryLabel}
                    </Text>
                  </TouchableOpacity>
                ) : showRebook ? (
                  <TouchableOpacity
                    style={[st.stickyBtn, st.stickyBtnFlex]}
                    activeOpacity={0.88}
                    onPress={() => {
                      const tutId = lesson?.tutorId?._id || lesson?.tutorId;
                      if (!tutId) return;
                      const root = getRootNavigation(navigation);
                      root?.navigate?.('BookLesson', { tutorId: tutId });
                    }}
                  >
                    <Ionicons name="refresh" size={18} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={st.stickyBtnText}>Rebook</Text>
                  </TouchableOpacity>
                ) : null}

                {showMessageBtn ? (
                  <TouchableOpacity
                    style={[
                      st.stickyBtnOutline,
                      (showJoinCta || showRebook) ? st.stickyBtnFlex : st.stickyBtnFull,
                    ]}
                    activeOpacity={0.88}
                    onPress={openMessagesTab}
                  >
                    <Text style={st.stickyBtnOutlineText}>Message</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {showCancelLesson ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => { /* cancel/reschedule flow */ }}
                  style={st.footerLink}
                >
                  <Text style={st.footerLinkText}>Reschedule or cancel</Text>
                </TouchableOpacity>
              ) : null}
            </Animated.View>
          ) : null}
        </Animated.View>
        </Animated.View>
      </Animated.View>

    </View>
    </>
  );
}

const st = StyleSheet.create({
  /** Outer shadow-casting wrapper for the morphing surface. No overflow
   *  hidden here — iOS can't draw shadows through a view that's clipping
   *  its subviews. `shadowOpacity` is driven by `surfaceShadowStyle` and
   *  fades to 0 at full-screen. */
  surfaceShadow: {
    position: 'absolute',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 16,
  },
  /** Inner clipping view — holds the actual card background + content.
   *  Matches the outer wrapper's rounded corners via `surfaceClipStyle`. */
  surfaceClip: {
    flex: 1,
    overflow: 'hidden',
  },

  /** Inline hero image for class — inside scroll, full-width, card slides over with negative margin. */
  classHeroInlineImg: {
    width: '100%',
    height: CLASS_HERO_H,
    overflow: 'hidden',
  },
  /**
   * Pinned behind scroll (BundleDetailScreen `heroPinned` pattern).
   * No `zIndex` — source order alone layers this BELOW the ScrollView (correct) and
   * BELOW the sticky footer (also correct). Previously this + `scrollClassHeroLayer`
   * zIndex: 1 pushed the ScrollView above the sticky footer too, which hid the CTA
   * behind the card until you scrolled far enough to reveal it through the
   * transparent content-bottom.
   */
  classHeroPinned: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  classHeroPinnedImageInner: {
    flex: 1,
    width: '100%',
  },
  classHeroScrollInnerPlain: { width: '100%' },

  /**
   * Full-width sheet that peeks over the hero. Intentionally matches BundleDetailScreen's `card`:
   * rounded top corners WITHOUT `overflow: 'hidden'`.
   *
   * `minHeight: SH` is critical — the pinned class hero sits BEHIND the scroll view (not inside
   * the card), and the ScrollView itself is transparent. If the card's content is shorter than
   * the hero, the hero shows through below the last child as a visible band in the middle of the
   * sheet (the "0/6" ghost band bug). Forcing the card to always extend past the hero guarantees
   * its background covers the hero entirely once it has scrolled under.
   */
  classHeroContentCard: {
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    paddingTop: 20,
    paddingHorizontal: 0,
    minHeight: SH,
  },
  /** Full-width bar under the ScrollView so the sheet paints over it, not under it. */
  /**
   * Strip sits ABOVE the scroll view (zIndex 3). Its opacity stays at 0 until the pinned hero
   * is fully `C.card` paper; only then does it blend to 1 over a very short window so it reads
   * as "appearing right as the card top reaches the toolbar area." Because both are the same
   * white, painting over the card does not read as a separate layer.
   */
  classHeroToolbarUnderScroll: {
    zIndex: 3,
    ...Platform.select({ default: { elevation: 3 } }),
  },
  classHeroScrollLayer: {
    zIndex: 2,
    ...Platform.select({ default: { elevation: 2 } }),
  },
  /** Back/share only; above the scroll layer AND the toolbar strip so they stay tappable. */
  classHeroButtonsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    ...Platform.select({ default: { elevation: 4 } }),
  },
  classHeroTopGuard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 168,
  },
  classHeroToolbarSolidBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  classHeroHeaderHit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  classHeroIconCrossfade: {
    width: 40,
    height: 40,
    position: 'relative',
  },
  classHeroIconLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Airbnb-style floating chrome on class cover: back = pale pill + hairline border;
   * share = frosted white + soft shadow (no heavy border).
   */
  classHeroBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  classHeroShareBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.14,
        shadowRadius: 5,
      },
      default: { elevation: 4 },
    }),
  },
  classHeroPhotoPill: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    backgroundColor: 'rgba(0,0,0,0.52)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  classHeroPhotoPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  /** ScrollView contentContainerStyle for class hero (no paddingHorizontal — card handles it). */
  scrollClassHero: {
    alignItems: 'stretch',
  },

  headerOuter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  headerInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    minHeight: 44,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDateOuter: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
    marginTop: 16,
  },

  body: { flex: 1 },

  scrollFlex: { flex: 1 },
  scroll: { alignItems: 'stretch', paddingHorizontal: 24 },

  heroWrap: { alignItems: 'center', width: '100%' },
  heroWrapClassSheet: { paddingHorizontal: 24 },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  /** Single attendee in class row — no extra margin (row handles spacing). */
  avatarInClassRow: { marginBottom: 0 },
  avatarImgFill: { width: '100%', height: '100%' },
  classHeroBlock: { alignItems: 'center', width: '100%' },
  /** Pull class title + avatars closer to the hero thumbnail. */
  classHeroBlockTight: { marginTop: -10 },
  classCoverHero: {
    width: '100%',
    maxWidth: 400,
    aspectRatio: 16 / 9,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: '#e8e8ea',
  },
  classAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  classStackAv: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 3,
  },
  classStackImg: { width: '100%', height: '100%' },
  classStackIni: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 48,
    backgroundColor: '#222',
    color: '#fff',
  },
  classStackMore: { marginLeft: 10, fontSize: 14, fontWeight: '600' },
  initials: { fontSize: 26, fontWeight: '600' },
  name: { fontSize: 24, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3, marginTop: 4 },
  nameOnClassHero: { marginTop: 0 },

  quickGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 16,
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  /** flex-start so value/label/sub rows line up across columns when sub-slots differ (actual/final lines). */
  quickCell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 4 },
  quickVal: { width: '100%', fontSize: 15, fontWeight: '600', textAlign: 'center', letterSpacing: -0.25 },
  /** Fixed third row so billing sub-lines don’t grow the row and push value rows down */
  quickSubSlot: {
    minHeight: 15,
    marginTop: 3,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  quickValSub: { fontSize: 10, textAlign: 'center', fontWeight: '500' },
  /** Full row height so dividers align with the stat block when sub-lines grow the row */
  quickDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  /** Top row in each quick-stat column — matches GOING (caption above value / avatars). */
  goingCaption: {
    width: '100%',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  classGoingSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 10,
  },
  classGoingStackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      default: { elevation: 3 },
    }),
  },
  classGoingStackAv: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  classGoingStackAvClip: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  classGoingStackImg: { width: '100%', height: '100%' },
  classGoingStackIni: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  classGoingMore: { fontSize: 14, fontWeight: '700' },

  detailColumn: { width: '100%', paddingTop: 0 },
  detailColumnClassSheet: { paddingHorizontal: 24 },
  /** Space above Notes (AI + body) from hero stats grid, bio, or other blocks */
  notesSectionBlock: {
    marginTop: 28,
  },
  bio: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 22,
    paddingHorizontal: 8,
    maxWidth: 400,
    alignSelf: 'center',
  },
  statsRowAirbnb: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    marginBottom: 20,
    width: '100%',
  },
  statCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  statCellVal: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' },
  statCellLbl: { fontSize: 12, marginTop: 4, textAlign: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 4 },
  hairline: { height: StyleSheet.hairlineWidth, width: '100%', marginBottom: 20 },

  statusPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
    justifyContent: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontSize: 12, fontWeight: '600' },
  trialPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#FF5A1F',
    marginRight: 8,
    marginBottom: 8,
  },
  trialPillText: { fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.5, marginLeft: 4 },

  sectionHeading: {
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailRowIcon: { marginRight: 14, marginTop: 2 },
  detailRowText: { flex: 1 },
  detailPrimary: { fontSize: 16, fontWeight: '500' },
  detailSecondary: { fontSize: 14, marginTop: 4 },

  noteBody: { fontSize: 15, lineHeight: 22 },
  bulletList: { marginBottom: 12 },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  bulletText: { fontSize: 14, lineHeight: 20, flex: 1 },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  summaryText: { fontSize: 13, lineHeight: 19, flex: 1 },
  fbHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  fbSubLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  fbDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 10,
    marginTop: 7,
  },
  cefrBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cefrText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E7D32',
    letterSpacing: 0.5,
  },
  analysisScoresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  analysisScoreCell: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 100,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  analysisScoreNum: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
  },
  analysisScoreWord: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  analysisScoreName: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  topicPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  topicPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  topicPillText: {
    fontSize: 12,
    fontWeight: '500',
  },
  awaitingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    marginBottom: 8,
  },
  generatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    marginBottom: 8,
  },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  issueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    marginTop: 4,
  },

  detailSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  detailGridItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '50%',
    paddingVertical: 8,
    paddingRight: 8,
  },
  detailGridIcon: { marginRight: 10, marginTop: 2 },
  detailGridPrimary: { fontSize: 14, fontWeight: '500' },
  detailGridSecondary: { fontSize: 12, marginTop: 2 },

  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  kvKey: { fontSize: 13 },
  kvVal: { fontSize: 13, fontWeight: '500' },

  paymentCard: { borderRadius: 14, padding: 16, marginBottom: 8 },
  paymentHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  paymentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  paymentTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  paymentDesc: { fontSize: 13, lineHeight: 18 },
  paymentDetails: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 10 },

  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 4,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  stickyRow: {
    flexDirection: 'row',
    gap: 10,
  },
  stickyBtn: {
    backgroundColor: '#111',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  stickyBtnFlex: { flex: 1 },
  stickyBtnFull: { width: '100%' },
  stickyBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  stickyBtnOutline: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  stickyBtnOutlineText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  footerLink: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  footerLinkText: {
    color: '#717171',
    fontSize: 13,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  recSection: {
    marginTop: 20,
    width: '100%',
  },
  recSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: -4,
    marginBottom: 12,
  },
  recScroll: {
    gap: 10,
    paddingRight: 4,
  },
  recCard: {
    width: 200,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  recThumb: {
    width: '100%',
    height: 100,
  },
  recThumbEmpty: {
    width: '100%',
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recBody: {
    padding: 10,
    paddingBottom: 6,
    gap: 2,
  },
  recType: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  recTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  recTutorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  recTutor: {
    fontSize: 12,
    fontWeight: '400',
  },
  recTutorBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  recTutorBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  recStruggles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  recStrugglePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recStruggleText: {
    fontSize: 10,
    fontWeight: '500',
  },
  recSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginHorizontal: 10,
    marginBottom: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  recSaveBtnActive: {},
  recSaveBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },
  recLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  recLoadingText: {
    fontSize: 13,
    fontWeight: '400',
  },
  focusSubLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  focusBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 3,
    paddingLeft: 4,
  },
  focusBullet: {
    fontSize: 14,
    lineHeight: 20,
    marginRight: 8,
  },
  focusBulletText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
});
