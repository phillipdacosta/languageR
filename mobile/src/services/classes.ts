import { api } from './api';

export interface MyClassRecord {
  _id: string;
  name?: string;
  startTime: string;
  endTime?: string;
  status: string;
  duration?: number;
  price?: number;
  capacity?: number;
  confirmedStudents?: any[];
  tutorId?: any;
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
