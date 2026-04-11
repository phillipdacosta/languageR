import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Value = {
  homeOverlayCoversTabBar: boolean;
  setHomeOverlayCoversTabBar: (covers: boolean) => void;
  lessonOverlayCoversTabBar: boolean;
  setLessonOverlayCoversTabBar: (covers: boolean) => void;
};

const HomeTabBarOverlayContext = createContext<Value | null>(null);

export function HomeTabBarOverlayProvider({ children }: { children: React.ReactNode }) {
  const [homeOverlayCoversTabBar, setHome] = useState(false);
  const [lessonOverlayCoversTabBar, setLesson] = useState(false);

  const setHomeOverlayCoversTabBar = useCallback((covers: boolean) => {
    setHome(covers);
  }, []);
  const setLessonOverlayCoversTabBar = useCallback((covers: boolean) => {
    setLesson(covers);
  }, []);

  const value = useMemo(
    () => ({
      homeOverlayCoversTabBar,
      setHomeOverlayCoversTabBar,
      lessonOverlayCoversTabBar,
      setLessonOverlayCoversTabBar,
    }),
    [homeOverlayCoversTabBar, setHomeOverlayCoversTabBar, lessonOverlayCoversTabBar, setLessonOverlayCoversTabBar],
  );

  return (
    <HomeTabBarOverlayContext.Provider value={value}>
      {children}
    </HomeTabBarOverlayContext.Provider>
  );
}

export function useHomeTabBarOverlay() {
  const ctx = useContext(HomeTabBarOverlayContext);
  if (!ctx) {
    throw new Error('useHomeTabBarOverlay must be used within HomeTabBarOverlayProvider');
  }
  return ctx;
}
