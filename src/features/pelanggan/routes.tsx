import type { RouteObject } from 'react-router'

export const pelangganRoutes: RouteObject[] = [
  { path: 'pelanggan', lazy: () => import('./PelangganPage').then((m) => ({ Component: m.PelangganPage })) },
]
