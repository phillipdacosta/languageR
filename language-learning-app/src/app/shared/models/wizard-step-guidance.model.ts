export type WizardGuidanceIconModifier =
  | 'face'
  | 'light'
  | 'secure'
  | 'recent'
  | 'trust'
  | 'id'
  | 'star'
  | 'weekly'
  | 'video'
  | 'tos'
  | 'cert'
  | 'payout'
  | 'quick';

export interface WizardGuidanceItem {
  titleKey: string;
  descKey: string;
  icon: string;
  iconModifier: WizardGuidanceIconModifier;
}
