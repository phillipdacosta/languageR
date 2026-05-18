import React, { useMemo, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Linking,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { CalendarLesson, CalendarClass } from '../types/calendar';
import { getRootNavigation } from '../utils/navigationRoot';
import { LessonDateHeaderCenter, formatDateBadgeParts } from '../components/LessonDateHeaderCenter';
import { SolidToolbarWithBlur } from '../components/SolidToolbarWithBlur';
import type { Lesson } from '../services/lessons';
import { isGroupClassLesson } from '../utils/lessonCardModel';
import {
  getJoinGateState,
  formatTimeUntilLessonStart,
  isLessonInProgressSlot,
} from '../services/lessons';
import { getLessonPrep, type LessonPrep } from '../services/learningPlan';

function formatDisplayName(person: any): string {
  if (!person) return '';
  if (person.firstName) return `${person.firstName} ${(person.lastName || '').charAt(0)}.`.trim();
  if (person.name) {
    const parts = person.name.split(' ');
    return parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0];
  }
  return '';
}

export default function EventDetailScreen() {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const parent = navigation.getParent?.();
    if (parent) {
      parent.setOptions({ tabBarStyle: { display: 'none' } });
      return () => {
        parent.setOptions({ tabBarStyle: undefined });
      };
    }
  }, [navigation, colors]);
  const timeFormat = user?.profile?.calendarTimeFormat || '12h';

  const lesson: CalendarLesson | undefined = route.params?.lesson;
  const calendarClass: CalendarClass | undefined = route.params?.calendarClass;
  const fromLessons = !!route.params?.fromLessons;
  const isClass = !!calendarClass || isGroupClassLesson(lesson as Lesson | undefined);
  const item = lesson || calendarClass;

  const [joinUiTick, setJoinUiTick] = useState(0);
  useEffect(() => {
    if (!item) return;
    const tid = setInterval(() => setJoinUiTick(n => n + 1), 10000);
    return () => clearInterval(tid);
  }, [(item as any)?._id]);

  // ── Pre-lesson briefing (tutor only) ──────────────────────
  // Fetches mastery + recent errors + corrected excerpts for the
  // student so the tutor walks into the lesson prepared.
  const [prep, setPrep] = useState<LessonPrep | null>(null);
  const isTutorViewer = user?.userType === 'tutor';
  const briefingStudentId = lesson
    ? (typeof lesson.studentId === 'string'
        ? lesson.studentId
        : (lesson.studentId as any)?._id)
    : null;
  const briefingLanguage = lesson?.language || lesson?.subject || null;
  useEffect(() => {
    let cancelled = false;
    if (!isTutorViewer || !briefingStudentId || !briefingLanguage) {
      setPrep(null);
      return;
    }
    (async () => {
      try {
        const res = await getLessonPrep(briefingStudentId, briefingLanguage);
        if (!cancelled && res.success && res.prep) {
          setPrep(res.prep);
        }
      } catch (err) {
        console.warn('[EventDetail] lesson-prep fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isTutorViewer, briefingStudentId, briefingLanguage]);

  const briefingHasContent = useMemo(() => {
    if (!prep) return false;
    return !!(
      prep.agenda?.length ||
      prep.latestAnalysis?.topErrors?.length ||
      prep.latestAnalysis?.persistentChallenges?.length ||
      prep.latestAnalysis?.correctedExcerpts?.length ||
      (prep.plan?.currentPhase?.masteryAverage !== null &&
        prep.plan?.currentPhase?.masteryAverage !== undefined)
    );
  }, [prep]);

  const masteryAvg = prep?.plan?.currentPhase?.masteryAverage ?? null;
  const masteryLabel = masteryAvg !== null ? `Mastery ${masteryAvg}/100` : '';
  const masteryPercent = masteryAvg !== null ? Math.max(0, Math.min(100, masteryAvg)) : 0;

  // Compact phase pill + first-pairing badge for the briefing header.
  // Mirrors the web tutor briefing so tutors get the same at-a-glance
  // context regardless of platform.
  const phasePillTitle = prep?.plan?.currentPhase?.title || '';
  const phasePillIndex =
    prep?.plan && prep.plan.totalPhases
      ? `${(prep.plan.currentPhaseIndex ?? 0) + 1}/${prep.plan.totalPhases}`
      : '';
  const isFirstPairing = !!prep?.firstTimePairing;
  const isStudentEdited = !!prep?.plan?.currentPhase?.studentEditedAt;

  const proficiencyChange = prep?.latestAnalysis?.proficiencyChange ?? null;
  const trendIcon: 'arrow-up' | 'remove' | 'arrow-down' | null =
    proficiencyChange === 'improved' ? 'arrow-up'
    : proficiencyChange === 'declined' ? 'arrow-down'
    : proficiencyChange === 'maintained' ? 'remove'
    : null;
  const trendLabel =
    proficiencyChange === 'improved' ? t('EVENT_DETAILS.BRIEFING.TREND_UP')
    : proficiencyChange === 'declined' ? t('EVENT_DETAILS.BRIEFING.TREND_DOWN')
    : proficiencyChange === 'maintained' ? t('EVENT_DETAILS.BRIEFING.TREND_FLAT')
    : '';

  const lessonForJoinGate = useMemo((): Lesson | null => {
    if (!item) return null;
    const anyItem = item as any;
    return {
      _id: anyItem._id,
      startTime: anyItem.startTime,
      endTime: anyItem.endTime,
      duration: anyItem.duration || 30,
      status: anyItem.status || 'scheduled',
      ...(isClass ? { isClass: true as const } : {}),
    } as Lesson;
  }, [item, isClass]);

  const formatTime = (d: Date): string => {
    if (timeFormat === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const details = useMemo(() => {
    if (!item) return null;
    const start = new Date((item as any).startTime);
    const end = new Date((item as any).endTime || start.getTime() + ((item as any).duration || 30) * 60000);
    const now = new Date();
    const isPast = end < now;
    const isNow = start <= now && end > now;
    const isUpcoming = start > now;

    if (lesson) {
      const student = lesson.studentId;
      return {
        title: formatDisplayName(student) || t('TUTOR_CALENDAR.STUDENT'),
        avatar: student?.picture,
        subject: lesson.subject || lesson.language || '',
        start,
        end,
        duration: lesson.duration || Math.round((end.getTime() - start.getTime()) / 60000),
        status: lesson.status,
        isTrialLesson: lesson.isTrialLesson,
        isCancelled: lesson.status === 'cancelled',
        isReschedule: lesson.rescheduleProposal?.status === 'pending',
        isPast,
        isNow,
        isUpcoming,
        price: lesson.price,
        notes: lesson.notes,
        type: 'lesson' as const,
      };
    }

    const cls = calendarClass!;
    return {
      title: cls.title,
      avatar: cls.thumbnail,
      subject: cls.language || '',
      start,
      end,
      duration: cls.duration || Math.round((end.getTime() - start.getTime()) / 60000),
      status: cls.status,
      isTrialLesson: false,
      isCancelled: cls.status === 'cancelled',
      isReschedule: false,
      isPast,
      isNow,
      isUpcoming,
      price: cls.price,
      notes: cls.description,
      type: 'class' as const,
      attendeeCount: cls.attendees?.length || 0,
      maxStudents: cls.maxStudents,
    };
  }, [item, lesson, calendarClass, t]);

  const joinGate = useMemo(() => getJoinGateState(lessonForJoinGate), [lessonForJoinGate, joinUiTick]);
  const joinPrimaryLabel = useMemo(() => {
    if (!lessonForJoinGate) return t('HOME.JOIN_LESSON');
    if (joinGate.canJoin) {
      if (isLessonInProgressSlot(lessonForJoinGate)) return t('HOME.JOIN_NOW');
      return isClass ? t('HOME.JOIN_CLASS') : t('HOME.JOIN_LESSON');
    }
    if (joinGate.sessionEnded) return t('HOME.JOIN_LESSON_ENDED_TITLE');
    return t('HOME.JOIN_IN_TIME', { time: formatTimeUntilLessonStart(lessonForJoinGate) });
  }, [lessonForJoinGate, joinGate, isClass, t]);

  if (!details) {
    return (
      <View
        style={[
          st.safe,
          {
            backgroundColor: colors.surface,
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <SolidToolbarWithBlur isDark={isDark}>
          <View style={st.eventHeaderInner}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
              <Text style={[st.backText, { color: colors.text }]}>
                {fromLessons ? t('TABS.LESSONS') : t('TABS.CALENDAR')}
              </Text>
            </TouchableOpacity>
          </View>
        </SolidToolbarWithBlur>
        <View style={st.center}><Text style={{ color: colors.textSecondary }}>{t('COMMON.LOADING')}</Text></View>
      </View>
    );
  }

  const C = colors;
  const statusColor = details.isCancelled ? '#C13515' : details.isNow ? C.accent : details.isPast ? C.textTertiary : '#2E7D32';
  const statusLabel = details.isCancelled ? t('HOME.CANCELLED') : details.isNow ? t('HOME.STARTED') : details.isPast ? t('HOME.STATUS_COMPLETED') || 'Completed' : t('HOME.STATUS_SCHEDULED') || 'Scheduled';

  const { month: headerMonth, day: headerDay } = formatDateBadgeParts(details.start);
  const headerTimeRange = `${formatTime(details.start)} – ${formatTime(details.end)}`;
  const headerWeekday = details.start
    .toLocaleDateString(undefined, { weekday: 'short' })
    .replace(/\./g, '')
    .toUpperCase();
  const headerDurationLine = '';
  const headerIsToday = details.start.toDateString() === new Date().toDateString();
  const headerTimeLine = headerTimeRange;

  const classCoverMode =
    isClass && !!details.avatar && typeof details.avatar === 'string';
  const screenW = Dimensions.get('window').width;
  const classExtendBelowToolbar = Math.min(340, Math.round(screenW * 0.78));
  const classSheetOverlap = 76;
  const classToolbarChromeH = insets.top + 52;
  const classCoverImageHeight = classToolbarChromeH + classExtendBelowToolbar;

  const heroBadges = (
    <View style={st.heroBadges}>
      {details.isTrialLesson && (
        <View style={[st.badge, { backgroundColor: '#FFF8E1' }]}>
          <Text style={[st.badgeText, { color: '#F5A623' }]}>{t('HOME.STATUS_TRIAL')}</Text>
        </View>
      )}
      {isClass && (
        <View style={[st.badge, { backgroundColor: '#E8F5E9' }]}>
          <Text style={[st.badgeText, { color: '#2E7D32' }]}>{t('HOME.CLASSES')}</Text>
        </View>
      )}
      {details.isReschedule && (
        <View style={[st.badge, { backgroundColor: '#FFF3E0' }]}>
          <Text style={[st.badgeText, { color: '#E07912' }]}>{t('HOME.RESCHEDULE')}</Text>
        </View>
      )}
    </View>
  );

  const headerToolbarSolid = (
    <SolidToolbarWithBlur isDark={isDark}>
      <View style={st.eventHeaderInner}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
          <Text style={[st.backText, { color: C.text }]}>
            {fromLessons ? t('TABS.LESSONS') : t('TABS.CALENDAR')}
          </Text>
        </TouchableOpacity>
        <View style={[st.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <View style={[st.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[st.statusText, { color: statusColor }]} numberOfLines={1}>
            {statusLabel}
          </Text>
        </View>
      </View>
    </SolidToolbarWithBlur>
  );

  const headerToolbarOverCover = (
    <View
      style={[
        st.classToolbarWrap,
        { paddingTop: insets.top, marginLeft: -insets.left, width: screenW },
      ]}
      pointerEvents="box-none"
    >
      <BlurView intensity={70} tint="dark" style={st.classToolbarBlur}>
        <View style={st.eventHeaderInner}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
            <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.95)" />
            <Text style={[st.backText, { color: 'rgba(255,255,255,0.95)' }]}>
              {fromLessons ? t('TABS.LESSONS') : t('TABS.CALENDAR')}
            </Text>
          </TouchableOpacity>
          <View style={[st.statusBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <View style={[st.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[st.statusText, { color: '#fff' }]} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
        </View>
      </BlurView>
    </View>
  );

  return (
    <View
      style={[
        st.safe,
        {
          backgroundColor: C.surface,
          paddingTop: classCoverMode ? 0 : insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {!classCoverMode ? headerToolbarSolid : null}

      {classCoverMode ? (
        <Image
          source={{ uri: details.avatar as string }}
          style={[
            st.classCoverImage,
            {
              height: classCoverImageHeight,
              width: screenW,
              marginLeft: -insets.left,
            },
          ]}
          resizeMode="cover"
          accessibilityRole="image"
        />
      ) : null}

      <ScrollView
        style={[st.scroll, classCoverMode && st.scrollTransparent]}
        contentContainerStyle={[
          classCoverMode
            ? {
                paddingTop: classCoverImageHeight - classSheetOverlap,
                paddingBottom: 40,
                paddingHorizontal: 0,
              }
            : st.scrollContent,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {classCoverMode ? (
          <View
            style={[
              st.classMetaSheet,
              {
                backgroundColor: C.surface,
                marginTop: -classSheetOverlap,
                paddingBottom: 8,
              },
            ]}
          >
            <Text style={[st.heroTitle, { color: C.text, marginTop: 0 }]}>{details.title}</Text>
            <View style={st.heroDateOuter}>
              <LessonDateHeaderCenter
                dateBadgeMonth={headerMonth}
                dateBadgeDay={headerDay}
                weekdayShort={headerWeekday}
                timeRange={headerTimeRange}
                durationLine={headerDurationLine}
                isToday={headerIsToday}
                timeLine={headerTimeLine}
                isDark={isDark}
                textPrimary={C.text}
                textSecondary={C.textSecondary}
              />
            </View>
            {!!details.subject && (
              <Text style={[st.heroSubject, { color: C.textSecondary }]}>{details.subject}</Text>
            )}
            {heroBadges}
          </View>
        ) : (
          <View
            style={[
              isClass ? st.heroClassFlat : st.heroCard,
              isClass ? { backgroundColor: C.card } : { backgroundColor: C.card, borderColor: C.border },
            ]}
          >
            {details.avatar ? (
              <Image source={{ uri: details.avatar as string }} style={st.heroAvatar} />
            ) : (
              <View style={[st.heroAvatar, { backgroundColor: C.inputBg }]}>
                <Ionicons name={isClass ? 'people' : 'person'} size={28} color={C.textTertiary} />
              </View>
            )}
            <Text style={[st.heroTitle, { color: C.text }]}>{details.title}</Text>
            <View style={st.heroDateOuter}>
              <LessonDateHeaderCenter
                dateBadgeMonth={headerMonth}
                dateBadgeDay={headerDay}
                weekdayShort={headerWeekday}
                timeRange={headerTimeRange}
                durationLine={headerDurationLine}
                isToday={headerIsToday}
                timeLine={headerTimeLine}
                isDark={isDark}
                textPrimary={C.text}
                textSecondary={C.textSecondary}
              />
            </View>
            {!!details.subject && (
              <Text style={[st.heroSubject, { color: C.textSecondary }]}>{details.subject}</Text>
            )}
            {heroBadges}
          </View>
        )}

        <View style={classCoverMode ? { paddingHorizontal: 16 } : undefined}>
        {/* Pre-lesson briefing — tutor-only, hidden when no useful data */}
        {isTutorViewer && briefingHasContent && prep && (
          <View style={[st.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st.briefingEyebrow, { color: C.textSecondary }]}>
              {t('EVENT_DETAILS.BRIEFING.EYEBROW')}
            </Text>
            <Text style={[st.sectionTitle, { color: C.text, marginTop: 2 }]}>
              {t('EVENT_DETAILS.BRIEFING.TITLE')}
            </Text>

            {/* Phase pill + first-pairing badge + student-edited cue */}
            {(phasePillTitle || isFirstPairing || isStudentEdited) ? (
              <View style={st.briefingPillRow}>
                {!!phasePillTitle && (
                  <View style={[st.phasePill, { backgroundColor: C.surface, borderColor: C.border }]}>
                    <Ionicons name="map-outline" size={12} color={C.text} />
                    {!!phasePillIndex && (
                      <Text style={[st.phasePillIndex, { color: C.textSecondary }]}>
                        {phasePillIndex}
                      </Text>
                    )}
                    <Text
                      style={[st.phasePillLabel, { color: C.text }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {phasePillTitle}
                    </Text>
                  </View>
                )}
                {isFirstPairing && (
                  <View style={[st.firstPairingPill, { backgroundColor: C.text }]}>
                    <Ionicons name="sparkles-outline" size={12} color={C.card} />
                    <Text style={[st.firstPairingPillText, { color: C.card }]}>
                      {t('EVENT_DETAILS.BRIEFING.FIRST_PAIRING')}
                    </Text>
                  </View>
                )}
                {isStudentEdited && (
                  <View style={[st.studentEditedPill, { borderColor: C.textSecondary, backgroundColor: C.card }]}>
                    <Ionicons name="create-outline" size={12} color={C.text} />
                    <Text style={[st.studentEditedPillText, { color: C.text }]}>
                      {t('EVENT_DETAILS.BRIEFING.STUDENT_EDITED')}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* Mastery + trend chip row */}
            {(masteryLabel || trendLabel) ? (
              <View style={st.briefingStatRow}>
                {!!masteryLabel && (
                  <View style={st.briefingStat}>
                    <Text style={[st.briefingStatLabel, { color: C.text }]}>{masteryLabel}</Text>
                    <View style={[st.briefingBar, { backgroundColor: C.borderLight }]}>
                      <View
                        style={[
                          st.briefingBarFill,
                          { width: `${masteryPercent}%`, backgroundColor: C.text },
                        ]}
                      />
                    </View>
                  </View>
                )}
                {!!trendLabel && (
                  <View style={[st.briefingTrend, { backgroundColor: C.surface }]}>
                    {trendIcon && (
                      <Ionicons
                        name={`${trendIcon}-outline` as any}
                        size={14}
                        color={C.textSecondary}
                      />
                    )}
                    <Text style={[st.briefingTrendText, { color: C.textSecondary }]}>
                      {trendLabel}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* Suggested mini-agenda */}
            {prep.agenda?.length ? (
              <View style={{ marginTop: 16 }}>
                <Text style={[st.briefingBlockTitle, { color: C.textSecondary }]}>
                  {t('EVENT_DETAILS.BRIEFING.AGENDA_TITLE')}
                </Text>
                {prep.agenda.map((item, idx) => (
                  <View key={`agenda-${idx}`} style={st.briefingBullet}>
                    <View style={[st.briefingBulletDot, { backgroundColor: C.text }]} />
                    <Text style={[st.briefingBulletText, { color: C.text }]}>{item}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Top errors */}
            {prep.latestAnalysis?.topErrors?.length ? (
              <View style={{ marginTop: 16 }}>
                <Text style={[st.briefingBlockTitle, { color: C.textSecondary }]}>
                  {t('EVENT_DETAILS.BRIEFING.TOP_ERRORS_TITLE')}
                </Text>
                {prep.latestAnalysis.topErrors.map((err, idx) => (
                  <View key={`err-${idx}`} style={st.briefingBullet}>
                    <Text style={[st.briefingBulletNum, { color: C.text }]}>{idx + 1}.</Text>
                    <Text style={[st.briefingBulletText, { color: C.text }]}>
                      <Text style={{ fontWeight: '700' }}>{err.issue}</Text>
                      {err.impact ? (
                        <Text style={{ color: C.textSecondary }}>{`  ·  ${err.impact} impact`}</Text>
                      ) : null}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Persistent challenges */}
            {prep.latestAnalysis?.persistentChallenges?.length ? (
              <View style={{ marginTop: 16 }}>
                <Text style={[st.briefingBlockTitle, { color: C.textSecondary }]}>
                  {t('EVENT_DETAILS.BRIEFING.PERSISTENT_TITLE')}
                </Text>
                <View style={st.briefingTagRow}>
                  {prep.latestAnalysis.persistentChallenges.map((c, idx) => (
                    <View
                      key={`pc-${idx}`}
                      style={[st.briefingTag, { backgroundColor: C.surface }]}
                    >
                      <Text style={[st.briefingTagText, { color: C.textSecondary }]}>
                        {c}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Recent corrected excerpts */}
            {prep.latestAnalysis?.correctedExcerpts?.length ? (
              <View style={{ marginTop: 16 }}>
                <Text style={[st.briefingBlockTitle, { color: C.textSecondary }]}>
                  {t('EVENT_DETAILS.BRIEFING.EXCERPTS_TITLE')}
                </Text>
                {prep.latestAnalysis.correctedExcerpts.map((ex, idx) => (
                  <View
                    key={`ex-${idx}`}
                    style={[
                      st.briefingExcerpt,
                      { backgroundColor: C.surface, borderColor: C.border },
                    ]}
                  >
                    <View style={st.briefingExcerptLine}>
                      <Text style={[st.briefingExcerptTag, { color: C.textTertiary }]}>
                        {t('EVENT_DETAILS.BRIEFING.SAID')}
                      </Text>
                      <Text
                        style={[
                          st.briefingExcerptOriginal,
                          { color: C.textSecondary },
                        ]}
                      >
                        {ex.original}
                      </Text>
                    </View>
                    <View style={st.briefingExcerptLine}>
                      <Text style={[st.briefingExcerptTag, { color: C.textTertiary }]}>
                        {t('EVENT_DETAILS.BRIEFING.SHOULD_BE')}
                      </Text>
                      <Text
                        style={[st.briefingExcerptCorrected, { color: C.text }]}
                      >
                        {ex.corrected}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Other tutors' recent notes — anonymized first names */}
            {prep.otherTutorNotes && prep.otherTutorNotes.length > 0 ? (
              <View style={{ marginTop: 16 }}>
                <Text style={[st.briefingBlockTitle, { color: C.textSecondary }]}>
                  {t('EVENT_DETAILS.BRIEFING.OTHER_NOTES_TITLE')}
                </Text>
                {prep.otherTutorNotes.map((n, idx) => (
                  <View key={`otn-${idx}`} style={st.briefingOtherNoteRow}>
                    <Text style={[st.briefingOtherNoteAuthor, { color: C.text }]}>
                      {n.tutorFirstName}:
                    </Text>
                    <Text style={[st.briefingOtherNoteText, { color: C.textSecondary }]}>
                      {n.text}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}

        {/* Schedule */}
        <View style={[st.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[st.sectionTitle, { color: C.text }]}>{t('TUTOR_CALENDAR.SCHEDULE')}</Text>
          <View style={st.infoRow}>
            <Ionicons name="calendar-outline" size={18} color={C.textSecondary} />
            <Text style={[st.infoText, { color: C.text }]}>
              {details.start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>
          <View style={st.infoRow}>
            <Ionicons name="time-outline" size={18} color={C.textSecondary} />
            <Text style={[st.infoText, { color: C.text }]}>
              {formatTime(details.start)} – {formatTime(details.end)}
            </Text>
          </View>
          {details.price !== undefined && details.price > 0 && (
            <View style={st.infoRow}>
              <Ionicons name="card-outline" size={18} color={C.textSecondary} />
              <Text style={[st.infoText, { color: C.text }]}>${details.price.toFixed(2)}</Text>
            </View>
          )}
        </View>

        {/* Class Attendees */}
        {isClass && (details as any).attendeeCount !== undefined && (
          <View style={[st.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st.sectionTitle, { color: C.text }]}>{t('TUTOR_CALENDAR.ATTENDEES')}</Text>
            <View style={st.infoRow}>
              <Ionicons name="people-outline" size={18} color={C.textSecondary} />
              <Text style={[st.infoText, { color: C.text }]}>
                {(details as any).attendeeCount} / {(details as any).maxStudents} {t('TUTOR_CALENDAR.ENROLLED')}
              </Text>
            </View>
          </View>
        )}

        {/* Notes */}
        {!!details.notes && (
          <View style={[st.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st.sectionTitle, { color: C.text }]}>{t('TUTOR_CALENDAR.NOTES')}</Text>
            <Text style={[st.notesText, { color: C.textSecondary }]}>{details.notes}</Text>
          </View>
        )}

        {/* Actions */}
        {!details.isPast && !details.isCancelled && (
          <View style={st.actionsSection}>
            {(details.isNow || details.isUpcoming) && (
              <TouchableOpacity
                accessibilityRole="button"
                style={[
                  st.actionBtn,
                  { backgroundColor: C.joinCtaBackground },
                ]}
                activeOpacity={joinGate.canJoin ? 0.85 : 1}
                onPress={() => {
                  const id = (item as any)._id;
                  const gate = getJoinGateState(lessonForJoinGate);
                  if (!gate.canJoin) {
                    if (gate.sessionEnded) {
                      Alert.alert(t('HOME.JOIN_LESSON_ENDED_TITLE'), t('HOME.JOIN_LESSON_ENDED_MSG'), [
                        { text: t('COMMON.OK') },
                      ]);
                      return;
                    }
                    if (lessonForJoinGate) {
                      Alert.alert(
                        t('HOME.JOIN_NOT_READY_TITLE'),
                        t('HOME.JOIN_NOT_READY_MSG', {
                          session: t(isClass ? 'HOME.JOIN_SESSION_CLASS' : 'HOME.JOIN_SESSION_LESSON'),
                          time: formatTimeUntilLessonStart(lessonForJoinGate),
                        }),
                        [{ text: t('COMMON.OK') }],
                      );
                    }
                    return;
                  }
                  const root = getRootNavigation(navigation);
                  root?.navigate?.('PreCall', { lessonId: id, isClass });
                }}
              >
                <Ionicons
                  name="videocam"
                  size={18}
                  color="#ffffff"
                />
                <Text
                  style={[st.actionBtnText, { color: '#ffffff' }]}
                >
                  {joinPrimaryLabel}
                </Text>
              </TouchableOpacity>
            )}
            {details.isUpcoming && (
              <>
                <TouchableOpacity style={[st.actionBtnOutline, { borderColor: C.border }]} activeOpacity={0.7}>
                  <Ionicons name="swap-horizontal" size={18} color={C.text} />
                  <Text style={[st.actionBtnOutlineText, { color: C.text }]}>{t('HOME.RESCHEDULE')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.actionBtnOutline, { borderColor: '#FFCDD2' }]} activeOpacity={0.7}>
                  <Ionicons name="close-circle-outline" size={18} color={C.danger} />
                  <Text style={[st.actionBtnOutlineText, { color: C.danger }]}>{t('HOME.CANCEL_LESSON')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {classCoverMode ? headerToolbarOverCover : null}
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  eventHeaderInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 16, fontWeight: '600' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  heroDateOuter: { alignItems: 'center', width: '100%', marginTop: 4, marginBottom: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  scrollTransparent: { backgroundColor: 'transparent' },

  /** Full-bleed class cover (drawn under toolbar + scroll) */
  classCoverImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    zIndex: 0,
  },
  classToolbarWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  classToolbarBlur: {
    overflow: 'hidden',
  },
  /** Borderless sheet overlapping the cover */
  classMetaSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 22,
    alignItems: 'center',
  },

  heroCard: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', marginBottom: 12 },
  /** Class without full-bleed cover: same hero content, no bordered “card” */
  heroClassFlat: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  heroAvatar: { width: 64, height: 64, borderRadius: 32, marginBottom: 12, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  heroSubject: { fontSize: 14, marginBottom: 8 },
  heroBadges: { flexDirection: 'row', gap: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },

  section: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  infoText: { fontSize: 14 },
  notesText: { fontSize: 14, lineHeight: 20 },

  actionsSection: { gap: 10, marginTop: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 12 },
  actionBtnText: { fontSize: 16, fontWeight: '600' },
  actionBtnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, borderWidth: 1.5 },
  actionBtnOutlineText: { fontSize: 15, fontWeight: '600' },

  // Pre-lesson briefing (tutor-only)
  briefingEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  briefingPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  briefingOtherNoteRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    alignItems: 'flex-start',
  },
  briefingOtherNoteAuthor: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 0,
  },
  briefingOtherNoteText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  phasePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 240,
  },
  phasePillIndex: {
    fontSize: 11,
    fontWeight: '800',
  },
  phasePillLabel: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  firstPairingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  firstPairingPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  studentEditedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  studentEditedPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  briefingStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 12,
  },
  briefingStat: {
    flex: 1,
    minWidth: 180,
  },
  briefingStatLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  briefingBar: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    width: '100%',
  },
  briefingBarFill: {
    height: 4,
    borderRadius: 999,
  },
  briefingTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  briefingTrendText: {
    fontSize: 12,
    fontWeight: '700',
  },
  briefingBlockTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  briefingBullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  briefingBulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
  },
  briefingBulletNum: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 18,
  },
  briefingBulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  briefingTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  briefingTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  briefingTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  briefingExcerpt: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginBottom: 8,
  },
  briefingExcerptLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  briefingExcerptTag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    width: 56,
    marginTop: 2,
  },
  briefingExcerptOriginal: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: 'line-through',
  },
  briefingExcerptCorrected: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
