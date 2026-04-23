import { StyleSheet } from 'react-native';

export interface TabBarThemeColors {
  tabBar: string;
  tabBarBorder: string;
}

/** Shared with TabNavigator and screens that temporarily hide the tab bar. */
export function getTabBarStyle(colors: TabBarThemeColors) {
  return {
    backgroundColor: colors.tabBar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.tabBarBorder,
    height: 88,
    paddingTop: 8,
    shadowColor: '#000' as const,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 5,
  };
}
