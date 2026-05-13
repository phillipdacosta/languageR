/** Context when opening signup-language from welcome or the student wizard. */
export const LANGUAGE_SELECT_RETURN_CONTEXT = 'languageSelectReturnContext';

export type LanguageSelectReturnPayload = {
  phase: 'welcome' | 'done';
  showPreview: boolean;
};

/** signup-language sets this before navigating back to onboarding after a return-path confirm. */
export const ONBOARDING_AFTER_LANGUAGE_RESTORE = 'onboardingAfterLanguageRestore';

/**
 * Session flag: user finished the standalone /signup-language step and continued
 * toward role-select. Used so student/tutor onboarding do not show the interface
 * language picker again.
 */
export const SIGNUP_INTERFACE_LANG_COMPLETED_KEY = 'signupInterfaceLangCompleted';
