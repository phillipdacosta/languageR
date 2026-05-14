import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import {
  LANGUAGE_PICKER_OPEN_KEY,
  LANGUAGE_SELECT_RETURN_CONTEXT,
  SIGNUP_INTERFACE_LANG_COMPLETED_KEY,
  SIGNUP_LANGUAGE_COMPLETED_LS_KEY,
} from './language-select-flow.storage';

/**
 * Route guard for /signup-language. The standalone language picker is now
 * optional — when the initial interface-language selection has already
 * been resolved (manual confirm or browser auto-detect via
 * LanguageService.initializeLanguage), this guard redirects to /role-select
 * *before* the page module activates so the user doesn't see a flash of
 * the language UI.
 *
 * The picker is still shown when the user explicitly opts in to changing
 * language. Two signals force the picker:
 *   - LANGUAGE_SELECT_RETURN_CONTEXT  (set by onboarding's "edit language")
 *   - LANGUAGE_PICKER_OPEN_KEY        (set by role-select "Back")
 *
 * The session flag SIGNUP_INTERFACE_LANG_COMPLETED_KEY is set on the redirect
 * path so onboarding's existing logic continues to bypass the in-wizard
 * language step.
 */
@Injectable({ providedIn: 'root' })
export class SignupLanguageGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(): boolean | UrlTree {
    if (typeof window === 'undefined') {
      return true;
    }

    const hasReturnCtx = !!sessionStorage.getItem(LANGUAGE_SELECT_RETURN_CONTEXT);
    const forceOpen = sessionStorage.getItem(LANGUAGE_PICKER_OPEN_KEY) === '1';
    if (forceOpen) {
      sessionStorage.removeItem(LANGUAGE_PICKER_OPEN_KEY);
    }

    if (hasReturnCtx || forceOpen) {
      return true;
    }

    const completed = localStorage.getItem(SIGNUP_LANGUAGE_COMPLETED_LS_KEY) === '1';
    if (!completed) {
      return true;
    }

    sessionStorage.setItem(SIGNUP_INTERFACE_LANG_COMPLETED_KEY, '1');
    return this.router.createUrlTree(['/role-select']);
  }
}
