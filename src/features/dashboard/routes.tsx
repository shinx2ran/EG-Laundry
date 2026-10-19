import type { RouteObject } from 'react-router'

export const dashboardRoutes: RouteObject[] = [
  { path: 'dashboard', lazy: () => import('./DashboardPage').then((m) => ({ Component: m.DashboardPage })) },
]
