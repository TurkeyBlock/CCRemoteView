'use client'
import { useState, useCallback, useEffect } from 'react'

export type Theme = 'neutral' | 'organic'

const STORAGE_KEY = 'cc-theme'

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  if (t === 'organic') {
    document.documentElement.setAttribute('data-palette', 'clay')
  } else {
    document.documentElement.removeAttribute('data-palette')
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('neutral')

  useEffect(() => {
    const active = (document.documentElement.getAttribute('data-theme') as Theme | null) ?? 'neutral'
    setThemeState(active === 'organic' ? 'organic' : 'neutral')
  }, [])

  const setTheme = useCallback((t: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, t) } catch { /* ignore */ }
    applyTheme(t)
    setThemeState(t)
  }, [])

  const toggle = useCallback(() => {
    setTheme(theme === 'organic' ? 'neutral' : 'organic')
  }, [theme, setTheme])

  return { theme, toggle }
}
