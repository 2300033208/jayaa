import { useState } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { SessionProvider } from './providers/SessionProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { routes } from './routes'

export function App() {
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <ErrorBoundary region="Application">
      <ThemeProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
