import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { HomeTabBarOverlayProvider, useHomeTabBarOverlay } from '../contexts/HomeTabBarOverlayContext';
import { getTabBarStyle } from './tabBarStyles';
import SlidingTabBar from './SlidingTabBar';

import HomeScreen from '../screens/HomeScreen';
import CalendarScreen from '../screens/CalendarScreen';
import AvailabilitySetupScreen from '../screens/AvailabilitySetupScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import LessonsScreen from '../screens/LessonsScreen';
import MessagesScreen from '../screens/MessagesScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();
const CalendarStack = createNativeStackNavigator();
const LessonsStack = createNativeStackNavigator();

function CalendarStackNavigator() {
  return (
    <CalendarStack.Navigator screenOptions={{ headerShown: false }}>
      <CalendarStack.Screen name="CalendarMain" component={CalendarScreen} />
      <CalendarStack.Screen name="AvailabilitySetup" component={AvailabilitySetupScreen} />
      <CalendarStack.Screen name="EventDetail" component={EventDetailScreen} />
    </CalendarStack.Navigator>
  );
}

function LessonsStackNavigator() {
  return (
    <LessonsStack.Navigator screenOptions={{ headerShown: false }}>
      <LessonsStack.Screen name="LessonsMain" component={LessonsScreen} />
      <LessonsStack.Screen name="LessonDetail" component={EventDetailScreen} />
    </LessonsStack.Navigator>
  );
}

function TabNavigatorInner() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { homeOverlayCoversTabBar, lessonOverlayCoversTabBar } = useHomeTabBarOverlay();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: getTabBarStyle(colors),
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
      }}
      tabBar={(props) => (
        <SlidingTabBar {...props} homeOverlayCoversTabBar={homeOverlayCoversTabBar} lessonOverlayCoversTabBar={lessonOverlayCoversTabBar} />
      )}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: t('TABS.HOME'),
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarStackNavigator}
        options={{
          tabBarLabel: t('TABS.CALENDAR'),
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Lessons"
        component={LessonsStackNavigator}
        options={{
          tabBarLabel: t('TABS.LESSONS'),
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'school' : 'school-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        options={{
          tabBarLabel: t('TABS.MESSAGES'),
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: t('TABS.PROFILE'),
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function TabNavigator() {
  return (
    <HomeTabBarOverlayProvider>
      <TabNavigatorInner />
    </HomeTabBarOverlayProvider>
  );
}
