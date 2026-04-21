import { Platform, type ViewStyle } from 'react-native';

export type CardShadowTier = 'raised' | 'subtle';

/**
 * Shadow overrides for elevated cards on dark backgrounds (#000 / grouped grays).
 * Base styles should set `shadowColor: '#000'`; spread this on top for dark mode.
 */
export function cardShadowDark(tier: CardShadowTier = 'raised'): ViewStyle {
  if (Platform.OS === 'ios') {
    return tier === 'raised'
      ? {
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.4,
          shadowRadius: 20,
        }
      : {
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.26,
          shadowRadius: 12,
        };
  }
  return {
    elevation: tier === 'raised' ? 9 : 5,
    shadowColor: '#000',
  };
}
