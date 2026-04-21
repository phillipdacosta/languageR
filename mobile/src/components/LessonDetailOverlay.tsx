import React, { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Share,
  Platform,
  ActivityIndicator,
  Alert,
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
import { LessonDateHeaderCenter, formatDateBadgeParts } from './LessonDateHeaderCenter';
import { SolidToolbarWithBlur, TOOLBAR_TOTAL_CHROME_HEIGHT, TOOLBAR_SOLID_MIN_HEIGHT } from './SolidToolbarWithBlur';

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
}

const { width: SW, height: SH } = Dimensions.get('window');

/** Height of the full-bleed class thumbnail hero at the top of the sheet. */
const CLASS_HERO_H = 260;
/** How far the content card overlaps the class hero (same as Bundle). */
const CLASS_CARD_OVERLAP = 80;

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

export default function LessonDetailOverlay({ card, cardRect, thumbnailTargetRect, onCloseStart, onCloseEnd, onBeginReveal }: Props) {
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

  const [detail, setDetail] = useState<LessonDetailResponse | null>(cached?.detail ?? null);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(cached?.payment ?? null);
  const [billingData, setBillingData] = useState<BillingData | null>(cached?.billing ?? null);
  const [detailMounted, setDetailMounted] = useState(false);
  const [recMaterials, setRecMaterials] = useState<RecommendedMaterial[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [joinUiTick, setJoinUiTick] = useState(0);

  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => setJoinUiTick(x => x + 1), 10000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    progress.value = withSpring(1, MORPH_SPRING);
    // Defer below-the-fold sections until ~50% into the morph so their initial
    // mount cost doesn't land on the first ~200ms where the surface is
    // growing fastest. The `detailStyle` opacity band [0.5, 0.9] takes over
    // from there to fade them in as the morph settles.
    const timer = setTimeout(() => setDetailMounted(true), 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!id) return;
    fetchAndCacheLessonDetail(id, card.lesson, currentUserId).then((fresh) => {
      if (fresh.detail) setDetail(fresh.detail);
      if (fresh.payment) setPaymentData(fresh.payment);
      if (fresh.billing) setBillingData(fresh.billing);
      if (!cached) {
        asyncFade.value = withTiming(1, ASYNC_FADE_IN);
      }
    });
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
      if (mockRecs.length) setRecMaterials(mockRecs as any);
      return;
    }

    const lang = card.lesson?.language;
    if (!lang) return;
    setRecLoading(true);
    const tutId = card.lesson?.tutorId?._id || (typeof card.lesson?.tutorId === 'string' ? card.lesson.tutorId : undefined);
    materialService.getRecommendedMaterials(lang, { lessonId: id, tutorId: tutId }).then((res) => {
      if (res.success && res.materials?.length) setRecMaterials(res.materials);
      setRecLoading(false);
    }).catch(() => setRecLoading(false));
  }, [id, currentUserId, card.lesson?.tutorId, card.lesson?.language]);

  const close = () => {
    onCloseStart();
    // Flip the `closing` gate so content fades stop fading OUT and the
    // surface tail fade kicks in. Gate is UI-thread-visible via shared value.
    closing.value = 1;
    // Single spring, identical config to the open — same physics in reverse.
    // Content, header, footer, hero all fade during specific progress BANDS
    // (see `useAnimatedStyle` blocks below), so a single target value here is
    // all we need. The spring's natural deceleration near `0` is what gives
    // the "velvet landing" feel — no easing curves required.
    progress.value = withSpring(0, MORPH_SPRING, (fin) => {
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

  // Shadow is strong while the rectangle reads as a "raised card" and
  // smoothly attenuates to zero as it reaches full-screen (a drop shadow on
  // a screen-sized view looks like a dark gutter at the bottom edge — we
  // don't want that). Peak strength during [0, 0.7], fades out by 1.
  const surfaceShadowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(progress.value, [0, 0.7, 1], [0.22, 0.22, 0], Extrapolation.CLAMP),
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

  // ── Body padding ── reclaims header space once surface is mostly open.
  const bodyPadStyle = useAnimatedStyle(() => ({
    paddingTop: interpolate(progress.value, [0, 0.5, 1], [0, BODY_PAD_OPEN, BODY_PAD_OPEN], Extrapolation.CLAMP),
  }));

  // ── Content fade (close only) ──
  // Tight close timing (progress 1 → 0 over ~420ms):
  //
  //   [1.00 → 0.60]  ~40%  body stays visible, card shrinks with content
  //   [0.60 → 0.35]  ~25%  body fades out FAST (~100ms window in spring time)
  //   [0.35 → 0.00]  ~35%  surface + card CROSS-FADE (no empty-white frame)
  //                        surface fades 1 → 0, card fades 0 → 1 in sync
  //
  // IMPORTANT: this is applied to the avatar's SIBLINGS (name, date header,
  // stats grid, detail sections) — never to the avatar itself. The avatar
  // is the one element that's a true "shared element" between the card and
  // the detail; it scales continuously from small→big and back, and must
  // never flash to 0. Previously we applied this fade to the whole body
  // wrapper, which included the avatar, causing the visible "flash" the
  // user noticed during close.
  const contentFadeStyle = useAnimatedStyle(() => ({
    opacity: closing.value > 0
      ? interpolate(progress.value, [0.35, 0.6], [0, 1], Extrapolation.CLAMP)
      : 1,
  }));

  // Trigger the parent's card fade-in the moment the body content has
  // finished fading out — synchronized with the start of the surface fade.
  // `prev` guard makes sure we only fire ONCE per close.
  useAnimatedReaction(
    () => closing.value > 0 && progress.value <= 0.35,
    (curr, prev) => {
      if (curr && !prev && onBeginReveal) {
        runOnJS(onBeginReveal)();
      }
    },
  );

  // ── Avatar: LEADS the surface growth + LANDS before the cross-fade ──
  //
  // OPEN (progress 0 → 1):
  //   Avatar reaches full detail scale by progress=0.65, then stays put.
  //   The surface spends the remaining 35% of the morph settling around it.
  //   Creates the "avatar pulls the page with it" feel.
  //
  // CLOSE (progress 1 → 0):
  //   [1.00 → 0.65]  avatar stays at full detail size; page shrinks around
  //   [0.65 → 0.35]  avatar rapidly shrinks to START (card-matching) size
  //                  and lands pixel-perfect on the source card's avatar
  //                  position via AVATAR_START_TRANSLATE_Y
  //   [0.35 → 0.00]  avatar holds at start size/position and fades out
  //                  IN LOCKSTEP with the surface (both opacity 1→0).
  //                  Since the source card's avatar is fading 0→1 in the
  //                  exact same pixels, this reads as a single dissolving
  //                  avatar — not two ghosts overlapping at different sizes
  //                  (which is what we saw when the avatar's shrink band
  //                  extended all the way down to progress=0).
  const AVATAR_LEAD_END = 0.65;
  const AVATAR_LAND_BY = 0.35; // avatar reaches card-position at this progress
  // `bpoAtLand` = value of bodyPadStyle.paddingTop AT progress=AVATAR_LAND_BY.
  // Needed to keep the locked→released translateY transition continuous.
  // bodyPadStyle interpolates p [0, 0.5, 1] → [0, BPO, BPO], so at LAND_BY
  // (which is <0.5) it's linearly (LAND_BY/0.5)*BPO.
  const BPO_AT_LAND = (AVATAR_LAND_BY / 0.5) * BODY_PAD_OPEN;
  const LOCKED_TY_AT_LAND =
    AVATAR_LAND_BY * cardRect.y + AVATAR_START_TRANSLATE_Y - BPO_AT_LAND;

  const avatarScaleStyle = useAnimatedStyle(() => {
    const p = progress.value;

    if (showHero) {
      return { transform: [{ translateY: 0 }, { scale: 1 }] };
    }

    const scale = interpolate(
      p,
      [AVATAR_LAND_BY, AVATAR_LEAD_END],
      [AVATAR_START_SCALE, 1],
      Extrapolation.CLAMP,
    );

    // During [0, AVATAR_LAND_BY] we LOCK the avatar's absolute screen-Y to
    // the source card's avatar position. Without this, the avatar drifts
    // because the surface top (`cardRect.y → 0`) and the body paddingTop
    // (`0 → BODY_PAD_OPEN`) both change as progress moves, so "start
    // scale" at different progress values lands at different screen
    // positions. The compound of those two shifts is exactly cancelled by
    // this formula, derived from:
    //   wanted_abs_y = cardRect.y + 68 (constant, matches card avatar)
    //   actual_abs_y = surfaceTop(p) + bpo(p) + 60 + translateY
    //               = (1-p)*cardRect.y + bpo(p) + 60 + translateY
    //   → translateY = p*cardRect.y + 8 - bpo(p)
    const bpo = interpolate(
      p,
      [0, 0.5, 1],
      [0, BODY_PAD_OPEN, BODY_PAD_OPEN],
      Extrapolation.CLAMP,
    );
    const lockedTy = p * cardRect.y + AVATAR_START_TRANSLATE_Y - bpo;

    let ty: number;
    if (p <= AVATAR_LAND_BY) {
      // Locked to card avatar position — absolute screen Y is constant
      // here, so the cross-fade with the source card's avatar happens
      // pixel-on-pixel with no ghosting.
      ty = lockedTy;
    } else if (p <= AVATAR_LEAD_END) {
      // Released: smoothly transition from the locked value to 0 (natural
      // layout position) over the scale-up band.
      ty = interpolate(
        p,
        [AVATAR_LAND_BY, AVATAR_LEAD_END],
        [LOCKED_TY_AT_LAND, 0],
        Extrapolation.CLAMP,
      );
    } else {
      ty = 0;
    }

    return {
      transform: [{ translateY: ty }, { scale }],
    };
  });

  // ── Name: cascades a beat after the avatar ──
  // Same principle: lands by AVATAR_LAND_BY so it's pixel-aligned with the
  // card's name when the cross-fade begins, then already fades with
  // `contentFadeStyle` during [0.35, 0.6]. The transform band stops at
  // 0.35 so there's no residual motion while the content is crossfading.
  const NAME_LEAD_END = 0.75;
  const nameScaleStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: showHero
          ? 0
          : interpolate(progress.value, [AVATAR_LAND_BY, NAME_LEAD_END], [NAME_START_TRANSLATE_Y, 0], Extrapolation.CLAMP),
      },
      {
        scale: showHero
          ? 1
          : interpolate(progress.value, [AVATAR_LAND_BY, NAME_LEAD_END], [NAME_START_SCALE, 1], Extrapolation.CLAMP),
      },
    ],
  }));

  // ── Stats grid + date header ── appear once the card is mostly open.
  // These are "new" elements not present on the card, so they need a
  // dedicated fade rather than a naked scale.
  //
  // One-way: on open, fade in during [0.35, 0.7]. On close, stay at 1 so the
  // card doesn't look empty mid-close — the surface tail fade handles the
  // final handoff to the real card underneath. Previously this faded back
  // OUT during close, leaving a blank card from progress 0.35 → 0.
  const metaFadeStyle = useAnimatedStyle(() => ({
    opacity: closing.value > 0
      ? 1
      : interpolate(progress.value, [0.35, 0.7], [0, 1], Extrapolation.CLAMP),
  }));

  // ── Detail sections (bio, AI, payments, etc.) ── all below-the-fold
  // content. Fade in LATE on open. On close, clipping by the shrinking
  // surface handles disappearance (no symmetric fade-out needed). Multiplied
  // by `asyncFade` so sections with network-pending data stay invisible
  // until ready.
  const detailStyle = useAnimatedStyle(() => {
    const morphOp = closing.value > 0
      ? 1
      : interpolate(progress.value, [0.5, 0.9], [0, 1], Extrapolation.CLAMP);
    return { opacity: morphOp * asyncFade.value };
  });

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

  const heroImgStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [thumbWidth, SW], Extrapolation.CLAMP),
    height: interpolate(progress.value, [0, 1], [thumbHeight, CLASS_HERO_H], Extrapolation.CLAMP),
    marginTop: interpolate(progress.value, [0, 1], [thumbInsetTop, 0], Extrapolation.CLAMP),
    borderRadius: interpolate(progress.value, [0, 1], [16, 0], Extrapolation.CLAMP),
  }));

  // ── Class content card overlap ──
  // When open, the content card pulls up -80 over the hero image (Bundle-style
  // overlap). When closed, we need 0 overlap so the content sits cleanly
  // beneath the (now small, inset) thumb — matching the card's vertical flow.
  const heroOverlapStyle = useAnimatedStyle(() => ({
    marginTop: interpolate(progress.value, [0, 1], [0, -CLASS_CARD_OVERLAP], Extrapolation.CLAMP),
  }));

  // ── Async sub-values (network-ready billing lines) ──
  const asyncSubStyle = useAnimatedStyle(() => ({
    opacity: asyncFade.value,
  }));

  const lesson = useMemo(() => {
    const base = card.lesson;
    if (!detail?.lesson) return base;
    return { ...base, ...detail.lesson, tutorId: detail.lesson.tutorId || base?.tutorId, studentId: detail.lesson.studentId || base?.studentId };
  }, [card.lesson, detail?.lesson]);
  const isClass = isClassMode;
  const classThumbUri = classThumbForMode;

  /** Scroll parallax for hero (Bundle-style). Must be created unconditionally (hooks rule). */
  const classScrollY = useRef(new RNAnimated.Value(0)).current; // retained for potential future use
  const heroThumbUri = classThumbUri;

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
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
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
            { backgroundColor: C.card, borderWidth: 1, borderColor: isDark ? C.border : 'rgba(0,0,0,0.06)' },
            surfaceClipStyle,
          ]}
        >

        {/* Header — solid from top edge through safe area + toolbar + blur */}
        <Animated.View
          style={[
            st.headerOuter,
            { backgroundColor: isDark ? '#000' : '#fff' },
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

        <Animated.View style={[st.body, bodyPadStyle]}>
          <RNAnimated.ScrollView
            style={st.scrollFlex}
            contentContainerStyle={[
              showHero ? st.scrollClassHero : st.scroll,
              { paddingBottom: SH - BODY_PAD_OPEN - insets.bottom + (showStickyFooter ? 100 : 0) },
            ]}
            showsVerticalScrollIndicator={false}
            bounces={true}
          >
            {/* Hero image — animates between the card's thumbnail rect (close)
                and full-bleed 260h (open). Centered so it lands exactly over
                the source card's thumb at progress=0. */}
            {showHero && (
              <Animated.View style={[st.classHeroInlineImg, { alignSelf: 'center' }, heroImgStyle]}>
                <Image source={{ uri: heroThumbUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </Animated.View>
            )}
            <Animated.View
              style={showHero
                ? [st.classHeroContentCard, { backgroundColor: C.card }, heroOverlapStyle]
                : undefined}
            >
              {showHero && (
                <View style={st.classHeroDragHandle}>
                  <View style={[st.classHeroDragPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.18)' }]} />
                </View>
              )}
            {/* Hero: avatar + name */}
            <View style={st.heroWrap}>
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
                  <Image source={{ uri: card.otherPicture }} style={st.avatar} />
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

              <Animated.View style={[st.heroDateOuter, metaFadeStyle, contentFadeStyle]}>
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
                <Animated.View style={[st.quickGrid, { borderColor: isDark ? C.border : '#EBEBEB' }, metaFadeStyle, contentFadeStyle]}>
                  <View style={st.quickCell}>
                    <Text style={[st.quickVal, { color: C.text }]} numberOfLines={1}>{info.duration} min</Text>
                    <Text style={[st.quickLbl, { color: C.textSecondary }]} numberOfLines={1}>{t('LESSONS_PAGE.CARD_STAT_DURATION')}</Text>
                    <View style={st.quickSubSlot}>
                      {formattedActualDuration ? (
                        <Animated.Text style={[st.quickValSub, { color: C.textTertiary }, asyncSubStyle]} numberOfLines={1}>{formattedActualDuration} actual</Animated.Text>
                      ) : null}
                    </View>
                  </View>
                  {showPriceCol ? (
                    <>
                      <View style={[st.quickDivider, { backgroundColor: isDark ? C.border : '#E0E0E0' }]} />
                      <View style={st.quickCell}>
                        <Text style={[st.quickVal, { color: C.text }]} numberOfLines={1}>
                          ${(info.price ?? 0).toFixed(2)}
                        </Text>
                        <Text style={[st.quickLbl, { color: C.textSecondary }]} numberOfLines={1}>{t('LESSONS_PAGE.CARD_STAT_PRICE')}</Text>
                        <View style={st.quickSubSlot}>
                          {formattedActualPrice ? (
                            <Animated.Text style={[st.quickValSub, { color: C.textTertiary }, asyncSubStyle]} numberOfLines={1}>{formattedActualPrice} final</Animated.Text>
                          ) : null}
                        </View>
                      </View>
                    </>
                  ) : showClassEnrollmentCol ? (
                    <>
                      <View style={[st.quickDivider, { backgroundColor: isDark ? C.border : '#E0E0E0' }]} />
                      <View style={st.quickCell}>
                        <Text style={[st.quickVal, { color: C.text }]} numberOfLines={1}>
                          {enrollmentQuickVal}
                        </Text>
                        <Text style={[st.quickLbl, { color: C.textSecondary }]} numberOfLines={1}>
                          {t('LESSONS_PAGE.CARD_STAT_ENROLLED')}
                        </Text>
                        <View style={st.quickSubSlot} />
                      </View>
                    </>
                  ) : null}
                  <View style={[st.quickDivider, { backgroundColor: isDark ? C.border : '#E0E0E0' }]} />
                  <View style={st.quickCell}>
                    <Text style={[st.quickVal, { color: stColor }]} numberOfLines={1}>
                      {stLabel}
                    </Text>
                    <Text style={[st.quickLbl, { color: C.textSecondary }]} numberOfLines={1}>{t('LESSONS_PAGE.CARD_STAT_STATUS')}</Text>
                    <View style={st.quickSubSlot} />
                  </View>
                </Animated.View>
              ) : null}
            </View>

            {/* Expanded detail sections — deferred until open animation settles */}
            {detailMounted ? (
            <Animated.View style={[st.detailColumn, detailStyle, contentFadeStyle]}>

              {/* ── About / Bio ── */}
              {otherUserBio ? (
                <Text style={[st.bio, { color: C.textSecondary }]}>{otherUserBio}</Text>
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
            </Animated.View>{/* /classHeroContentCard wrapper */}
          </RNAnimated.ScrollView>

          {showStickyFooter ? (
            <Animated.View
              style={[
                st.stickyFooter,
                {
                  backgroundColor: C.card,
                  borderTopColor: isDark ? C.border : '#EBEBEB',
                  paddingBottom: Math.max(insets.bottom, 12),
                },
                footerFadeStyle,
              ]}
            >
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

  /** Content card that slides up over the class hero image (negative margin = overlap). */
  classHeroContentCard: {
    marginTop: -CLASS_CARD_OVERLAP,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 0,
    paddingHorizontal: 24,
    overflow: 'hidden',
  },
  classHeroDragHandle: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  classHeroDragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },

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
  quickLbl: { width: '100%', fontSize: 10, textAlign: 'center', marginTop: 4, fontWeight: '500' },
  /** Fixed third row so billing sub-lines don’t grow the row and push status down */
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

  detailColumn: { width: '100%', paddingTop: 0 },
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
