import type { RouteObject } from 'react-router'

export const pesananRoutes: RouteObject[] = [
  { path: 'pesanan', lazy: () => import('./PesananPage').then((m) => ({ Component: m.PesananPage })) },
]
