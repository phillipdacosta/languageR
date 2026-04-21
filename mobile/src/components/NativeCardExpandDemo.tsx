import React, { useMemo } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BarnabiCardExpandView, {
  CardItem,
} from '../../modules/barnabi-card-expand';
import { ProcessedLessonCard } from '../utils/lessonCardModel';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Dev-only modal that showcases the native shared-element card expand.
 *
 * This is deliberately isolated from the production Lessons flow:
 *   - It does not change how `<LessonsScreen>` normally behaves.
 *   - It opens as a fullscreen modal, uses the real lesson data from the
 *     parent screen, but renders everything via the native module
 *     (SwiftUI matchedGeometryEffect on iOS, Jetpack Compose
 *     SharedTransitionLayout on Android).
 *   - The detail page inside the native view is a prototype placeholder —
 *     that's intentional. The point of this demo is to verify the MOTION
 *     feels right, not the detail content. If the motion passes the "does
 *     it feel like Airbnb?" bar, Scope 3 takes the next step: replace the
 *     placeholder with the existing lesson detail content hosted inside
 *     the native morph.
 *
 * Visibility: mounted by `LessonsScreen` only when `__DEV__ === true`.
 * Gatekeeping happens at the caller, not here, so this file stays
 * dependency-free for any future usage in a different context.
 */
export type NativeCardExpandDemoProps = {
  visible: boolean;
  lessons: ProcessedLessonCard[];
  onClose: () => void;
};

export default function NativeCardExpandDemo({
  visible,
  lessons,
  onClose,
}: NativeCardExpandDemoProps) {
  const { colors, isDark } = useTheme();

  // We only translate what the native view needs: id, title, subtitle,
  // image, badge. Everything else about a ProcessedLessonCard (status
  // filters, cancellation flags, role metadata) is irrelevant for the
  // motion prototype. Keeping the mapped shape minimal also keeps the JS→
  // native serialization cost negligible during list updates.
  const items: CardItem[] = useMemo(
    () =>
      lessons.slice(0, 20).map((pl) => ({
        id: pl.id,
        title: pl.isClass && pl.className ? pl.className : pl.otherName || 'Lesson',
        subtitle: pl.formattedTime
          ? `${pl.formattedDate} · ${pl.formattedTime}`
          : pl.formattedDate,
        imageUrl:
          pl.isClass && pl.classCoverUrl
            ? pl.classCoverUrl
            : pl.otherPicture || undefined,
        badge: pl.statusLabel?.toUpperCase(),
        // Accent mirrors the iOS system blue / Android primary. If the
        // host app changes its brand color, we'd pipe it through here.
        accentColor: '#0A84FF',
      })),
    [lessons]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Close native card expand demo"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Native prototype</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {Platform.OS === 'ios'
                ? 'SwiftUI · matchedGeometryEffect'
                : 'Compose · SharedTransitionLayout'}
            </Text>
          </View>
        </View>

        {/* The native view takes over from here. It owns its own list,
            detail, and all morph animations. Events are advisory —
            fire-and-forget telemetry for future wiring; currently we just
            log them in __DEV__ so we can see the timing of open/close
            callbacks relative to frame pacing. */}
        <BarnabiCardExpandView
          items={items}
          colorScheme={isDark ? 'dark' : 'light'}
          tintColor="#0A84FF"
          onOpenDetail={(e) => {
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.log('[NativeCardExpandDemo] onOpenDetail', e.nativeEvent.id);
            }
          }}
          onCloseDetail={() => {
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.log('[NativeCardExpandDemo] onCloseDetail');
            }
          }}
          style={styles.nativeView}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  nativeView: { flex: 1 },
});
