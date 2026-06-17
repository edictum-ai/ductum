import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

import { RouteLoading } from './RouteLoading'

export function LazyRouteOutlet() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Outlet />
    </Suspense>
  )
}
