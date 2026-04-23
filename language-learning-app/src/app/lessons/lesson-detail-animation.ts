import { createAnimation, Animation } from '@ionic/angular';

export interface CardRect {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: number;
}

/**
 * Ionic modal enter animation using clip-path inset.
 * The modal content is always at full-screen layout — clip-path reveals it
 * from the card position outward, so avatar/text are never distorted.
 */
export function cardExpandEnter(baseEl: HTMLElement, opts?: { cardRect?: CardRect }): Animation {
  const root = baseEl as HTMLElement;
  const wrapper = root.querySelector('.modal-wrapper') as HTMLElement;
  const backdrop = root.querySelector('ion-backdrop') as HTMLElement;

  if (!wrapper || !backdrop) {
    return createAnimation().addElement(root).duration(300).fromTo('opacity', '0', '1');
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = opts?.cardRect ?? { top: vh * 0.3, left: vw * 0.1, width: vw * 0.8, height: 200, borderRadius: 28 };

  const insetTop = rect.top;
  const insetRight = vw - rect.left - rect.width;
  const insetBottom = vh - rect.top - rect.height;
  const insetLeft = rect.left;

  const fromClip = `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px round ${rect.borderRadius}px)`;
  const toClip = 'inset(0px 0px 0px 0px round 0px)';

  const wrapperAnimation = createAnimation()
    .addElement(wrapper)
    .duration(440)
    .easing('cubic-bezier(0.32, 0.72, 0, 1)')
    .fromTo('clip-path', fromClip, toClip)
    .fromTo('opacity', '0.92', '1');

  const backdropAnimation = createAnimation()
    .addElement(backdrop)
    .duration(440)
    .fromTo('opacity', '0', '0.32');

  return createAnimation()
    .addElement(root)
    .addAnimation([wrapperAnimation, backdropAnimation]);
}

/**
 * Ionic modal leave animation — reverse clip-path from full to card rect.
 */
export function cardExpandLeave(baseEl: HTMLElement, opts?: { cardRect?: CardRect }): Animation {
  const root = baseEl as HTMLElement;
  const wrapper = root.querySelector('.modal-wrapper') as HTMLElement;
  const backdrop = root.querySelector('ion-backdrop') as HTMLElement;

  if (!wrapper || !backdrop) {
    return createAnimation().addElement(root).duration(200).fromTo('opacity', '1', '0');
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = opts?.cardRect ?? { top: vh * 0.3, left: vw * 0.1, width: vw * 0.8, height: 200, borderRadius: 28 };

  const insetTop = rect.top;
  const insetRight = vw - rect.left - rect.width;
  const insetBottom = vh - rect.top - rect.height;
  const insetLeft = rect.left;

  const fromClip = 'inset(0px 0px 0px 0px round 0px)';
  const toClip = `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px round ${rect.borderRadius}px)`;

  const wrapperAnimation = createAnimation()
    .addElement(wrapper)
    .duration(360)
    .easing('cubic-bezier(0.32, 0.72, 0, 1)')
    .fromTo('clip-path', fromClip, toClip)
    .fromTo('opacity', '1', '0.92');

  const backdropAnimation = createAnimation()
    .addElement(backdrop)
    .duration(360)
    .fromTo('opacity', '0.32', '0');

  return createAnimation()
    .addElement(root)
    .addAnimation([wrapperAnimation, backdropAnimation]);
}
