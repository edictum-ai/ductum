import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return (localStorage.getItem('ductum-theme') as Theme) ?? 'dark'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    const root = document.documentElement
    // :root is the dark baseline. Dark keeps the `.dark` class on <html> so
    // Tailwind `dark:` literal utilities still fire; light is the explicit
    // `.light` override. The two classes are mutually exclusive.
    if (theme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }
    localStorage.setItem('ductum-theme', theme)
  }, [theme])

  function toggle() {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  return { theme, toggle }
}
