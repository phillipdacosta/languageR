import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { UserService } from './user.service';
import { Notification } from './notification.service';

@Injectable({
  providedIn: 'root'
})
export class NotificationTranslationService {

  constructor(
    private translateService: TranslateService,
    private userService: UserService
  ) {}

  private get userTz(): string {
    const user = this.userService.getCurrentUserValue();
    return user?.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  private get lang(): string {
    return this.translateService.currentLang || this.translateService.defaultLang || 'en';
  }

  getTranslatedMessage(n: Notification): string {
    const d = n.data || {};
    const t = (key: string, params?: any) => this.translateService.instant(key, params);
    const lang = this.lang;
    const tz = this.userTz;

    const fmtDate = (raw: string | Date | undefined): string => {
      if (!raw) return '';
      const date = new Date(raw as string);
      if (isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: tz }).format(date);
    };

    const fmtTime = (raw: string | Date | undefined): string => {
      if (!raw) return '';
      const date = new Date(raw as string);
      if (isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(date);
    };

    const fmtMoney = (val: any): string => {
      const num = parseFloat(val);
      return isNaN(num) ? '0.00' : num.toFixed(2);
    };

    try {
      switch (n.type) {
        case 'lesson_created': {
          if (d.conversationId) {
            return t('NOTIFICATIONS.MSG.LESSON_CREATED_TRIAL_TIPS', {
              studentName: d.studentName, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
            });
          }
          if (d.tutorName || d.tutorId) {
            const key = d.isTrialLesson ? 'NOTIFICATIONS.MSG.LESSON_CREATED_STUDENT_TRIAL' : 'NOTIFICATIONS.MSG.LESSON_CREATED_STUDENT';
            return t(key, { language: d.language, tutorName: d.tutorName, date: fmtDate(d.startTime), time: fmtTime(d.startTime) });
          }
          return t('NOTIFICATIONS.MSG.LESSON_CREATED_TUTOR', {
            studentName: d.studentName, language: d.language, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });
        }

        case 'lesson_cancelled': {
          let msg: string;
          if (d.cancelledByName || d.cancellerName) {
            msg = t('NOTIFICATIONS.MSG.LESSON_CANCELLED_BY', {
              cancellerName: d.cancelledByName || d.cancellerName,
              subject: d.lessonSubject || t('NOTIFICATIONS.MSG.LESSON_GENERIC'),
              date: fmtDate(d.startTime), time: fmtTime(d.startTime)
            });
          } else {
            msg = t('NOTIFICATIONS.MSG.LESSON_CANCELLED_AUTO', { date: fmtDate(d.startTime), time: fmtTime(d.startTime) });
          }
          const reasonText = d.cancelReasonText || d.cancelReason;
          if (reasonText && reasonText !== 'tutor_cancelled' && reasonText !== 'student_cancelled' && reasonText !== 'other') {
            msg += t('NOTIFICATIONS.MSG.LESSON_CANCELLED_REASON', { reason: reasonText });
          }
          return msg;
        }

        case 'lesson_rescheduled':
        case 'reschedule_proposed':
          return t('NOTIFICATIONS.MSG.RESCHEDULE_PROPOSED', {
            proposerName: d.proposerName || d.rescheduledByName || '', date: fmtDate(d.startTime || d.newStartTime), time: fmtTime(d.startTime || d.newStartTime)
          });

        case 'reschedule_accepted':
          return t('NOTIFICATIONS.MSG.RESCHEDULE_ACCEPTED');

        case 'reschedule_rejected':
          return t('NOTIFICATIONS.MSG.RESCHEDULE_REJECTED');

        case 'lesson_reminder':
          return t('NOTIFICATIONS.MSG.LESSON_REMINDER');

        case 'lesson_completed':
          return t('NOTIFICATIONS.MSG.LESSON_COMPLETED', { tutorName: d.tutorName || '' });

        case 'lesson_analysis_ready':
          return t('NOTIFICATIONS.MSG.LESSON_ANALYSIS_READY', { tutorName: d.tutorName || '' });

        case 'class_invitation':
          if (d.endTime) {
            return t('NOTIFICATIONS.MSG.CLASS_INVITATION_JOIN', {
              tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), startTime: fmtTime(d.startTime), endTime: fmtTime(d.endTime)
            });
          }
          return t('NOTIFICATIONS.MSG.CLASS_INVITATION', {
            tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'class_accepted':
          return t('NOTIFICATIONS.MSG.CLASS_ACCEPTED', {
            studentName: d.studentName, className: d.className, date: fmtDate(d.startTime || d.date)
          });

        case 'class_removed':
          return t('NOTIFICATIONS.MSG.CLASS_REMOVED', {
            tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'invitation_cancelled':
          return t('NOTIFICATIONS.MSG.INVITATION_CANCELLED', {
            tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'class_auto_cancelled':
          if (d.minStudents) {
            return t('NOTIFICATIONS.MSG.CLASS_AUTO_CANCELLED_TUTOR', {
              className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime), minStudents: d.minStudents
            });
          }
          return t('NOTIFICATIONS.MSG.CLASS_AUTO_CANCELLED_STUDENT', {
            className: d.className, tutorName: d.tutorName, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'class_invitation_cancelled':
          return t('NOTIFICATIONS.MSG.CLASS_INVITATION_CANCELLED', {
            className: d.className, tutorName: d.tutorName, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'potential_student':
          if (d.triggerType === 'book_clicked') {
            return t('NOTIFICATIONS.MSG.POTENTIAL_STUDENT_BOOK', { studentName: d.studentName });
          }
          return t('NOTIFICATIONS.MSG.POTENTIAL_STUDENT_SAVED', { studentName: d.studentName });

        case 'message':
          if (d.tutorName) return t('NOTIFICATIONS.MSG.TUTOR_NOTE');
          return n.message;

        case 'payment_received':
          if (d.paypalEmail) {
            return t('NOTIFICATIONS.MSG.PAYMENT_PAYPAL', { amount: fmtMoney(d.amount), date: fmtDate(d.lessonDate), email: d.paypalEmail });
          }
          if (d.paymentCount) {
            const lessonText = d.paymentCount === 1 ? t('NOTIFICATIONS.MSG.LESSON_SINGULAR') : t('NOTIFICATIONS.MSG.LESSON_PLURAL');
            return t('NOTIFICATIONS.MSG.PAYMENT_AVAILABLE', { amount: fmtMoney(d.amount), count: d.paymentCount, lessonText });
          }
          return t('NOTIFICATIONS.MSG.PAYMENT_EARNED', { amount: fmtMoney(d.amount), studentName: d.studentName || '', date: fmtDate(d.lessonDate || d.startTime) });

        case 'lesson_refunded':
          return t('NOTIFICATIONS.MSG.LESSON_REFUNDED', { tutorName: d.tutorName || '' });

        case 'lesson_partial_refund':
          return t('NOTIFICATIONS.MSG.PARTIAL_REFUND', { amount: fmtMoney(d.amount), tutorName: d.tutorName || '' });

        case 'payment_cancelled':
          return t('NOTIFICATIONS.MSG.PAYMENT_CANCELLED', { studentName: d.studentName || '' });

        case 'payment_reduced':
          return t('NOTIFICATIONS.MSG.PAYMENT_REDUCED', { studentName: d.studentName || '', amount: fmtMoney(d.adjustedAmount || d.amount) });

        case 'investigation_resolved':
          return t('NOTIFICATIONS.MSG.INVESTIGATION_RESOLVED', { studentName: d.studentName || '' });

        case 'dispute_submitted':
          return t('NOTIFICATIONS.MSG.DISPUTE_SUBMITTED', { tutorName: d.tutorName || '', studentName: d.studentName || '' });

        case 'tip_received':
          if (d.stripeFee && d.stripeFee > 0) {
            return t('NOTIFICATIONS.MSG.TIP_RECEIVED_WITH_FEE', {
              netAmount: fmtMoney(d.tutorReceived || d.amount), studentName: d.from || '', date: fmtDate(d.lessonDate),
              grossAmount: fmtMoney(d.amount), fee: fmtMoney(d.stripeFee)
            });
          }
          return t('NOTIFICATIONS.MSG.TIP_RECEIVED', { amount: fmtMoney(d.amount), studentName: d.from || '', date: fmtDate(d.lessonDate) });

        case 'tip_sent':
          return t('NOTIFICATIONS.MSG.TIP_SENT', { amount: fmtMoney(d.amount), tutorName: d.to || '', date: fmtDate(d.lessonDate) });

        case 'withdrawal_initiated':
          return t('NOTIFICATIONS.MSG.WITHDRAWAL_INITIATED', { amount: fmtMoney(d.amount), method: d.method || '' });

        case 'tutor_video_approved':
          return d.isFirstTimeApproval ? t('NOTIFICATIONS.MSG.VIDEO_APPROVED_FIRST') : t('NOTIFICATIONS.MSG.VIDEO_APPROVED');

        case 'tutor_video_rejected':
          return t('NOTIFICATIONS.MSG.VIDEO_REJECTED');

        case 'feedback_required':
          return t('NOTIFICATIONS.MSG.FEEDBACK_REQUIRED', { studentName: d.studentName || '' });

        case 'feedback_received':
          return t('NOTIFICATIONS.MSG.FEEDBACK_RECEIVED', { tutorName: d.tutorName || '' });

        case 'feedback_reminder':
          return t('NOTIFICATIONS.MSG.FEEDBACK_REMINDER', { studentName: d.studentName || '' });

        case 'progress_milestone':
          if (d.milestone === 'first' || d.milestoneNumber === undefined) {
            return t('NOTIFICATIONS.MSG.PROGRESS_MILESTONE_FIRST', { language: d.language || '' });
          }
          return t('NOTIFICATIONS.MSG.PROGRESS_MILESTONE', { language: d.language || '', number: d.milestoneNumber, total: d.totalLessons });

        case 'credential_approved':
          return t('NOTIFICATIONS.MSG.CREDENTIAL_APPROVED');

        case 'credential_rejected':
          return t('NOTIFICATIONS.MSG.CREDENTIAL_REJECTED');

        case 'office_hours_booking':
          return t('NOTIFICATIONS.MSG.OFFICE_HOURS_BOOKING');

        case 'office_hours_starting':
          return t('NOTIFICATIONS.MSG.OFFICE_HOURS_STARTING');

        case 'tutor_note_saved' as any:
          return t('NOTIFICATIONS.MSG.TUTOR_NOTE_SAVED', {
            studentName: d.studentName || '',
            date: fmtDate(d.lessonDate),
            time: fmtTime(d.lessonDate)
          });

        case 'payout_paused' as any:
          return t('NOTIFICATIONS.MSG.PAYOUT_PAUSED', { studentName: d.studentName || '' });

        default:
          return n.message;
      }
    } catch {
      return n.message;
    }
  }

  getTranslatedTitle(notification: Notification): string {
    const t = (key: string) => this.translateService.instant(key);
    const titleKeyMap: { [key: string]: string } = {
      'lesson_created': 'NOTIFICATIONS.TITLE_TYPE.LESSON_CREATED',
      'lesson_cancelled': 'NOTIFICATIONS.TITLE_TYPE.LESSON_CANCELLED',
      'lesson_rescheduled': 'NOTIFICATIONS.TITLE_TYPE.LESSON_RESCHEDULED',
      'reschedule_proposed': 'NOTIFICATIONS.TITLE_TYPE.RESCHEDULE_PROPOSED',
      'reschedule_accepted': 'NOTIFICATIONS.TITLE_TYPE.RESCHEDULE_ACCEPTED',
      'reschedule_rejected': 'NOTIFICATIONS.TITLE_TYPE.RESCHEDULE_REJECTED',
      'lesson_reminder': 'NOTIFICATIONS.TITLE_TYPE.LESSON_REMINDER',
      'lesson_completed': 'NOTIFICATIONS.TITLE_TYPE.LESSON_COMPLETED',
      'lesson_analysis_ready': 'NOTIFICATIONS.TITLE_TYPE.LESSON_ANALYSIS_READY',
      'class_invitation': 'NOTIFICATIONS.TITLE_TYPE.CLASS_INVITATION',
      'class_accepted': 'NOTIFICATIONS.TITLE_TYPE.CLASS_ACCEPTED',
      'class_removed': 'NOTIFICATIONS.TITLE_TYPE.CLASS_REMOVED',
      'class_auto_cancelled': 'NOTIFICATIONS.TITLE_TYPE.CLASS_CANCELLED',
      'class_invitation_cancelled': 'NOTIFICATIONS.TITLE_TYPE.CLASS_CANCELLED',
      'invitation_cancelled': 'NOTIFICATIONS.TITLE_TYPE.INVITATION_CANCELLED',
      'message': 'NOTIFICATIONS.TITLE_TYPE.MESSAGE',
      'potential_student': 'NOTIFICATIONS.TITLE_TYPE.POTENTIAL_STUDENT',
      'payment_received': 'NOTIFICATIONS.TITLE_TYPE.PAYMENT_RECEIVED',
      'lesson_refunded': 'NOTIFICATIONS.TITLE_TYPE.LESSON_REFUNDED',
      'lesson_partial_refund': 'NOTIFICATIONS.TITLE_TYPE.PARTIAL_REFUND',
      'payment_cancelled': 'NOTIFICATIONS.TITLE_TYPE.PAYMENT_CANCELLED',
      'payment_reduced': 'NOTIFICATIONS.TITLE_TYPE.PAYMENT_REDUCED',
      'investigation_resolved': 'NOTIFICATIONS.TITLE_TYPE.INVESTIGATION_RESOLVED',
      'dispute_submitted': 'NOTIFICATIONS.TITLE_TYPE.DISPUTE_SUBMITTED',
      'tip_received': 'NOTIFICATIONS.TITLE_TYPE.TIP_RECEIVED',
      'tip_sent': 'NOTIFICATIONS.TITLE_TYPE.TIP_SENT',
      'withdrawal_initiated': 'NOTIFICATIONS.TITLE_TYPE.WITHDRAWAL_INITIATED',
      'tutor_video_approved': 'NOTIFICATIONS.TITLE_TYPE.VIDEO_APPROVED',
      'tutor_video_rejected': 'NOTIFICATIONS.TITLE_TYPE.VIDEO_REJECTED',
      'feedback_required': 'NOTIFICATIONS.TITLE_TYPE.FEEDBACK_REQUIRED',
      'feedback_received': 'NOTIFICATIONS.TITLE_TYPE.FEEDBACK_RECEIVED',
      'feedback_reminder': 'NOTIFICATIONS.TITLE_TYPE.FEEDBACK_REMINDER',
      'progress_milestone': 'NOTIFICATIONS.TITLE_TYPE.PROGRESS_MILESTONE',
      'credential_approved': 'NOTIFICATIONS.TITLE_TYPE.CREDENTIAL_APPROVED',
      'credential_rejected': 'NOTIFICATIONS.TITLE_TYPE.CREDENTIAL_REJECTED',
      'office_hours_booking': 'NOTIFICATIONS.TITLE_TYPE.OFFICE_HOURS_BOOKING',
      'office_hours_starting': 'NOTIFICATIONS.TITLE_TYPE.OFFICE_HOURS_STARTING',
      'tutor_note_saved': 'NOTIFICATIONS.TITLE_TYPE.TUTOR_NOTE',
    };

    const key = titleKeyMap[notification.type];
    if (key) {
      return t(key);
    }
    return t('NOTIFICATIONS.TITLE_TYPE.DEFAULT');
  }
}
