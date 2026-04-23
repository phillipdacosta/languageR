import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { OnboardingFormProvider } from './OnboardingFormContext';
import StudentOnboardingStack from './student/StudentOnboardingStack';
import TutorOnboardingStack from './tutor/TutorOnboardingStack';

export default function OnboardingNavigator() {
  const { user } = useAuth();
  const isTutor = user?.userType === 'tutor';

  return (
    <OnboardingFormProvider user={user}>
      {isTutor ? <TutorOnboardingStack /> : <StudentOnboardingStack />}
    </OnboardingFormProvider>
  );
}
