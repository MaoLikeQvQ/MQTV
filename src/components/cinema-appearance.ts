'use client';

import { useEffect, useState } from 'react';

/** 首页与播放页共用原有主题偏好。 */
export function useCinemaAppearance() {
  const [appearance, setAppearance] = useState('dark');
  useEffect(() => {
    function read() {
      try { setAppearance(localStorage.getItem('libretv-home-appearance') === 'light' ? 'light' : 'dark'); } catch { /* 使用默认深色 */ }
    }
    read();
    function sync(event: StorageEvent) { if (event.key === 'libretv-home-appearance') read(); }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function toggleAppearance() {
    const next = appearance === 'dark' ? 'light' : 'dark';
    setAppearance(next);
    try { localStorage.setItem('libretv-home-appearance', next); } catch { /* 当前页面仍可切换 */ }
  }
  return { appearance, toggleAppearance };
}
