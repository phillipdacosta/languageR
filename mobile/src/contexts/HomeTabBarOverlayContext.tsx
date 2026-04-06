import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Value = {
  homeOverlayCoversTabBar: boolean;
  setHomeOverlayCoversTabBar: (covers: boolean) => void;
};

const HomeTabBarOverlayContext = createContext<Value | null>(null);

export function HomeTabBarOverlayProvider({ children }: { children: React.ReactNode }) {
  const [homeOverlayCoversTabBar, setState] = useState(false);
  const setHomeOverlayCoversTabBar = useCallback((covers: boolean) => {
    setState(covers);
  }, []);

  const value = useMemo(
    () => ({ homeOverlayCoversTabBar, setHomeOverlayCoversTabBar }),
    [homeOverlayCoversTabBar, setHomeOverlayCoversTabBar],
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
