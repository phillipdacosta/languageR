import { Notification } from '../services/notification.service';

export type NotificationNavTarget =
  | { kind: 'route'; commands: any[]; queryParams?: Record<string, string | null> }
  | { kind: 'class_invitation'; classId: string }
  | { kind: 'earnings' }
  | { kind: 'tutor_approval'; stepId: string };

function asString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function lessonIdFrom(notification: Notification): string | null {
  const data = notification.data || {};
  return asString(data.lessonId) || asString(data.relatedLesson);
}

function classIdFrom(notification: Notification): string | null {
  return asString(notification.data?.classId);
}

function messagePeerIdFrom(notification: Notification): string | null {
  const data = notification.data || {};
  const relatedUserId = asString((notification as Notification & { relatedUserId?: string }).relatedUserId);

  return (
    asString(data.studentAuth0Id) ||
    asString(data.tutorAuth0Id) ||
    asString(data.senderAuth0Id) ||
    asString(data.userId) ||
    asString(data.studentId) ||
    asString(data.tutorId) ||
    relatedUserId
  );
}

/** Map admin credential review payload → approval wizard step id. */
export function credentialTypeToApprovalStep(credentialType: string | null): string {
  if (credentialType === 'governmentId') {
    return 'identity';
  }
  return 'qualifications';
}

export function getNotificationNavigationTarget(
  notification: Notification
): NotificationNavTarget | null {
  const type = notification.type;
  const data = notification.data || {};

  if (asString(data.actionRoute)) {
    return { kind: 'route', commands: [asString(data.actionRoute)!] };
  }

  switch (type) {
    case 'lesson_created':
    case 'lesson_reminder':
    case 'lesson_cancelled':
    case 'lesson_rescheduled':
    case 'office_hours_booking':
    case 'office_hours_starting':
    case 'office_hours_accepted':
    case 'reschedule_proposed':
    case 'reschedule_accepted':
    case 'reschedule_rejected':
    case 'lesson_refunded':
    case 'lesson_partial_refund':
    case 'tip_sent':
    case 'tip_received': {
      const lessonId = lessonIdFrom(notification);
      if (lessonId) {
        return { kind: 'route', commands: ['/tabs/lessons', lessonId] };
      }
      return { kind: 'route', commands: ['/tabs/lessons'] };
    }

    case 'class_invitation': {
      const classId = classIdFrom(notification);
      if (classId) {
        return { kind: 'class_invitation', classId };
      }
      return { kind: 'route', commands: ['/tabs/lessons'] };
    }

    case 'class_accepted':
    case 'class_cancelled':
    case 'class_auto_cancelled':
    case 'class_invitation_cancelled':
    case 'invitation_cancelled':
    case 'class_removed': {
      const classId = classIdFrom(notification);
      if (classId) {
        return { kind: 'route', commands: ['/tabs/lessons', classId] };
      }
      return { kind: 'route', commands: ['/tabs/lessons'] };
    }

    case 'message':
    case 'potential_student': {
      const lessonId = lessonIdFrom(notification);
      if (type === 'message' && lessonId && asString(data.tutorName)) {
        return { kind: 'route', commands: ['/post-lesson-student', lessonId] };
      }

      const peerId = messagePeerIdFrom(notification);
      if (peerId) {
        return {
          kind: 'route',
          commands: ['/tabs/messages'],
          queryParams: { userId: peerId },
        };
      }
      return { kind: 'route', commands: ['/tabs/messages'] };
    }

    case 'lesson_analysis_ready': {
      const lessonId = lessonIdFrom(notification);
      return lessonId ? { kind: 'route', commands: ['/lesson-analysis', lessonId] } : null;
    }

    case 'lesson_completed': {
      const lessonId = lessonIdFrom(notification);
      if (!lessonId) {
        return null;
      }
      if (data.action === 'view_analysis') {
        return { kind: 'route', commands: ['/post-lesson-student', lessonId] };
      }
      return { kind: 'route', commands: ['/lesson-analysis', lessonId] };
    }

    case 'feedback_reminder':
    case 'feedback_required':
    case 'tutor_note_saved': {
      const lessonId = lessonIdFrom(notification);
      return lessonId
        ? { kind: 'route', commands: ['/post-lesson-tutor', lessonId] }
        : { kind: 'route', commands: ['/tabs/lessons'] };
    }

    case 'feedback_received': {
      const lessonId = lessonIdFrom(notification);
      return lessonId ? { kind: 'route', commands: ['/post-lesson-student', lessonId] } : null;
    }

    case 'payment_received':
    case 'withdrawal_initiated':
    case 'payment_cancelled':
    case 'payment_reduced':
    case 'investigation_resolved':
    case 'dispute_submitted':
    case 'payout_paused':
      return { kind: 'earnings' };

    case 'tutor_video_approved':
      return { kind: 'route', commands: ['/tabs/availability-setup'] };

    case 'tutor_photo_approved':
      return { kind: 'route', commands: ['/tabs/availability-setup'] };

    case 'tutor_video_rejected':
      return { kind: 'tutor_approval', stepId: 'video' };

    case 'tutor_photo_rejected':
      return { kind: 'tutor_approval', stepId: 'photo' };

    case 'credential_approved': {
      if (asBool(data.tutorApproved)) {
        return { kind: 'route', commands: ['/tabs/availability-setup'] };
      }
      return {
        kind: 'tutor_approval',
        stepId: credentialTypeToApprovalStep(asString(data.credentialType)),
      };
    }

    case 'credential_rejected':
      return {
        kind: 'tutor_approval',
        stepId: credentialTypeToApprovalStep(asString(data.credentialType)),
      };

    case 'stripe_account_updated':
      return {
        kind: 'route',
        commands: ['/tabs/profile'],
        queryParams: { section: 'payments' },
      };

    case 'material_approved':
    case 'material_rejected': {
      const materialId = asString(data.materialId);
      return materialId
        ? { kind: 'route', commands: ['/tabs/home/material', materialId] }
        : { kind: 'route', commands: ['/tabs/home'] };
    }

    case 'material_shared': {
      const materialId = asString(data.materialId);
      return materialId
        ? {
            kind: 'route',
            commands: ['/material', materialId],
            queryParams: { from: 'notification' },
          }
        : null;
    }

    case 'progress_milestone':
    case 'learning_plan_ready':
      return { kind: 'route', commands: ['/tabs/progress'] };

    default:
      return null;
  }
}
