export type RootStackParamList = {
  Main: undefined;
  Login: undefined;
  Onboarding: undefined;
  PreCall: { lessonId: string; isClass?: boolean };
  VideoCall: {
    lessonId: string;
    isClass?: boolean;
    micOn?: boolean;
    videoOn?: boolean;
  };
  PostLessonStudent: { lessonId: string };
  PostLessonTutor: { lessonId: string; fromVideoCall?: boolean };
};
