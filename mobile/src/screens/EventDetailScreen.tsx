import React, { useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { CalendarLesson, CalendarClass } from '../types/calendar';

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

  useEffect(() => {
    const parent = navigation.getParent?.();
    if (parent) {
      parent.setOptions({ tabBarStyle: { display: 'none' } });
      return () => {
        parent.setOptions({
          tabBarStyle: {
            display: 'flex',
            backgroundColor: colors.tabBar,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.tabBarBorder,
            height: 88, paddingTop: 8,
            shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 5,
          },
        });
      };
    }
  }, [navigation, colors]);
  const timeFormat = user?.profile?.calendarTimeFormat || '12h';

  const lesson: CalendarLesson | undefined = route.params?.lesson;
  const calendarClass: CalendarClass | undefined = route.params?.calendarClass;
  const isClass = !!calendarClass;
  const item = lesson || calendarClass;

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

  if (!details) {
    return (
      <SafeAreaView style={[st.safe, { backgroundColor: colors.surface }]} edges={['top']}>
        <View style={st.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[st.backText, { color: colors.text }]}>{t('TABS.CALENDAR')}</Text>
          </TouchableOpacity>
        </View>
        <View style={st.center}><Text style={{ color: colors.textSecondary }}>{t('COMMON.LOADING')}</Text></View>
      </SafeAreaView>
    );
  }

  const C = colors;
  const statusColor = details.isCancelled ? '#C13515' : details.isNow ? C.accent : details.isPast ? C.textTertiary : '#2E7D32';
  const statusLabel = details.isCancelled ? t('HOME.CANCELLED') : details.isNow ? t('HOME.STARTED') : details.isPast ? t('HOME.STATUS_COMPLETED') || 'Completed' : t('HOME.STATUS_SCHEDULED') || 'Scheduled';

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: C.surface }]} edges={['top']}>
      {/* Header */}
      <View style={[st.headerRow, { borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
          <Text style={[st.backText, { color: C.text }]}>{t('TABS.CALENDAR')}</Text>
        </TouchableOpacity>
        <View style={[st.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <View style={[st.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[st.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={[st.heroCard, { backgroundColor: C.card, borderColor: C.border }]}>
          {details.avatar ? (
            <Image source={{ uri: details.avatar }} style={st.heroAvatar} />
          ) : (
            <View style={[st.heroAvatar, { backgroundColor: C.inputBg }]}>
              <Ionicons name={isClass ? 'people' : 'person'} size={28} color={C.textTertiary} />
            </View>
          )}
          <Text style={[st.heroTitle, { color: C.text }]}>{details.title}</Text>
          {!!details.subject && <Text style={[st.heroSubject, { color: C.textSecondary }]}>{details.subject}</Text>}

          <View style={st.heroBadges}>
            {details.isTrialLesson && (
              <View style={[st.badge, { backgroundColor: '#FFF8E1' }]}><Text style={[st.badgeText, { color: '#F5A623' }]}>{t('HOME.STATUS_TRIAL')}</Text></View>
            )}
            {isClass && (
              <View style={[st.badge, { backgroundColor: '#E8F5E9' }]}><Text style={[st.badgeText, { color: '#2E7D32' }]}>{t('HOME.CLASSES')}</Text></View>
            )}
            {details.isReschedule && (
              <View style={[st.badge, { backgroundColor: '#FFF3E0' }]}><Text style={[st.badgeText, { color: '#E07912' }]}>{t('HOME.RESCHEDULE')}</Text></View>
            )}
          </View>
        </View>

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
              {formatTime(details.start)} – {formatTime(details.end)} ({details.duration} {t('HOME.MINS')})
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
              <TouchableOpacity style={[st.actionBtn, { backgroundColor: C.accent }]} activeOpacity={0.85}>
                <Ionicons name="videocam" size={18} color={C.background} />
                <Text style={[st.actionBtnText, { color: C.background }]}>{details.isNow ? t('HOME.JOIN_NOW') : t('HOME.JOIN_LESSON')}</Text>
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

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 16, fontWeight: '600' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  heroCard: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', marginBottom: 12 },
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
});
