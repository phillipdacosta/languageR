/**
 * Walks up to the root navigator (e.g. to open PreCall on the root stack).
 */
export function getRootNavigation(navigation: { getParent?: () => any }): any {
  let current: any = navigation;
  let parent = current?.getParent?.();
  while (parent) {
    current = parent;
    parent = current.getParent?.();
  }
  return current;
}
