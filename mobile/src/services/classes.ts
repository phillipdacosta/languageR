import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api } from './api';

export interface ClassInvitedStudentRow {
  studentId: string | { _id: string; name?: string; email?: string; picture?: string; firstName?: string; lastName?: string };
  status?: 'pending' | 'accepted' | 'declined' | string;
  invitedAt?: string;
}

export interface MyClassRecord {
  _id: string;
  name?: string;
  description?: string;
  startTime: string;
  endTime?: string;
  status?: string;
  duration?: number;
  price?: number;
  capacity?: number;
  thumbnail?: string;
  isPublic?: boolean;
  level?: string;
  minStudents?: number;
  flexibleMinimum?: boolean;
  recurrence?: { type?: string; count?: number };
  invitationStats?: { total?: number; accepted?: number; pending?: number; declined?: number };
  invitedStudents?: ClassInvitedStudentRow[];
  confirmedStudents?: any[];
  tutorId?: any;
  hubDraftForm?: unknown;
  updatedAt?: string;
  useSuggestedPricing?: boolean;
  suggestedPrice?: number;
}

interface MyClassesResponse {
  success?: boolean;
  classes?: MyClassRecord[];
}

export async function getMyClasses(): Promise<MyClassRecord[]> {
  try {
    const data = await api.get<MyClassesResponse>('/classes/my-classes');
    return data.classes || [];
  } catch {
    return [];
  }
}

/** Tutor hub list (same source as web schedule-class hub). */
export async function getClassesForTutor(tutorId: string): Promise<MyClassRecord[]> {
  if (!tutorId) return [];
  const data = await api.get<MyClassesResponse>(`/classes/tutor/${encodeURIComponent(tutorId)}`);
  return data.classes || [];
}

export type ClassRecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';

export interface CreateClassPayload {
  name: string;
  description?: string;
  capacity: number;
  level?: string;
  duration?: number;
  isPublic: boolean;
  thumbnail?: string | null;
  price?: number;
  useSuggestedPricing?: boolean;
  suggestedPrice?: number;
  /** Required for published classes; omitted for `status: 'draft'` (server uses placeholders). */
  startTime?: string;
  endTime?: string;
  recurrence?: { type: ClassRecurrenceType; count: number };
  invitedStudentIds?: string[];
  status?: 'draft';
  hubDraftForm?: unknown;
  minStudents?: number;
  flexibleMinimum?: boolean;
  cancelReasonId?: string;
  cancelReasonText?: string;
}

export interface CreateClassResponse {
  success: boolean;
  classes?: MyClassRecord[];
  /** Present for single draft create (`POST` with `status: 'draft'`). */
  class?: MyClassRecord;
  message?: string;
}

export async function createClass(payload: CreateClassPayload): Promise<CreateClassResponse> {
  return api.post<CreateClassResponse>('/classes', payload);
}

export async function updateClass(classId: string, body: Record<string, unknown>): Promise<{ success: boolean; message?: string }> {
  return api.patch<{ success: boolean; message?: string }>(`/classes/${encodeURIComponent(classId)}`, body);
}

export async function getClass(classId: string): Promise<MyClassRecord> {
  const data = await api.get<{ success: boolean; class: MyClassRecord }>(`/classes/${encodeURIComponent(classId)}`);
  return data.class;
}

export async function cancelClass(
  classId: string,
  opts?: { reasonId?: string; reasonText?: string },
): Promise<{ success: boolean; message?: string }> {
  const params = new URLSearchParams();
  if (opts?.reasonId) params.set('reasonId', opts.reasonId);
  if (opts?.reasonText) params.set('reasonText', opts.reasonText);
  const q = params.toString();
  const path = `/classes/${encodeURIComponent(classId)}${q ? `?${q}` : ''}`;
  return api.delete<{ success: boolean; message?: string }>(path);
}

/** Tutor: hide a past or cancelled class from hub only. */
export async function hideClassFromHub(classId: string): Promise<{ success: boolean; message?: string }> {
  return api.post<{ success: boolean; message?: string }>(
    `/classes/${encodeURIComponent(classId)}/hide-from-hub`,
    {},
  );
}

export async function inviteStudentsToClass(
  classId: string,
  studentIds: string[],
): Promise<{ success: boolean; message?: string; newInvitationsCount?: number }> {
  return api.post(`/classes/${encodeURIComponent(classId)}/invite`, { studentIds });
}

export async function removeStudentFromClass(
  classId: string,
  studentId: string,
): Promise<{ success: boolean; message?: string }> {
  return api.delete(`/classes/${encodeURIComponent(classId)}/student/${encodeURIComponent(studentId)}`);
}

/** Student: un-enroll from a class they accepted (while status is still `scheduled`). */
export async function leaveClass(classId: string): Promise<{ success: boolean; message?: string }> {
  return api.post<{ success: boolean; message?: string }>(
    `/classes/${encodeURIComponent(classId)}/unenroll`,
    {},
  );
}

export async function uploadClassThumbnail(localUri: string): Promise<string> {
  const processed = await manipulateAsync(localUri, [], { compress: 0.82, format: SaveFormat.JPEG });
  const formData = new FormData();
  formData.append('thumbnail', { uri: processed.uri, name: 'class-cover.jpg', type: 'image/jpeg' } as any);
  const data = await api.upload<{ success: boolean; imageUrl: string }>('/classes/upload-thumbnail', formData);
  return data.imageUrl;
}
