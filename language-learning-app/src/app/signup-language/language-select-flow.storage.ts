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

/**
 * Persistent flag (localStorage): the initial interface-language selection
 * has been resolved — either the user picked one manually, or a supported
 * language was auto-detected from the browser. When set, /signup-language
 * auto-redirects to /role-select unless a force-open flag or return-context
 * is present so the user explicitly wants to change language.
 */
export const SIGNUP_LANGUAGE_COMPLETED_LS_KEY = 'signupLanguageCompleted';

/**
 * Transient flag (sessionStorage): the user explicitly requested the language
 * picker even though the initial selection is already complete (e.g. tapped
 * "Back" on role-select). signup-language reads and clears this so the
 * picker shows once.
 */
export const LANGUAGE_PICKER_OPEN_KEY = 'languagePickerOpen';
