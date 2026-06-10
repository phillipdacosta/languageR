const RETURN_URL_KEY = 'returnUrl';

const BLOCKED_RETURN_PATHS = new Set(['/login', '/callback', '/']);

/** Remember where the user was headed so post-login navigation can resume deep links. */
export function persistReturnUrl(url: string | null | undefined): void {
  if (!url || BLOCKED_RETURN_PATHS.has(url)) {
    return;
  }
  if (!url.startsWith('/')) {
    return;
  }
  localStorage.setItem(RETURN_URL_KEY, url);
}
