import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './App'
import './index.css'

// Apply stored theme preference before first paint. :root is the dark
// baseline; dark keeps `.dark` on <html> for Tailwind `dark:` utilities,
// light is the explicit `.light` override.
const storedTheme = localStorage.getItem('ductum-theme') ?? 'dark'
document.documentElement.classList.add(storedTheme === 'light' ? 'light' : 'dark')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
