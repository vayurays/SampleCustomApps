import { useEffect, useState } from 'react';

export function useVayuTheme() {
  const [theme, setTheme] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTheme = params.get('theme');
    if (urlTheme === 'dark' || urlTheme === 'light') return urlTheme;
    // Fallback to system preference if testing standalone in debug
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Listen for THEME_CHANGED messages from the parent WebClient iframe
      if (event.data?.type === 'THEME_CHANGED') {
        setTheme(event.data.theme);
      }
    };
    
    // Set the initial data-theme attribute on the root html element
    document.documentElement.setAttribute('data-theme', theme);

    // Listen to parent iframe messages
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [theme]); // Add theme as a dependency to update DOM when state changes

  return theme;
}
