import type { RouteObject } from 'react-router'

export const pesananRoutes: RouteObject[] = [
  { path: 'pesanan', lazy: () => import('./PesananPage').then((m) => ({ Component: m.PesananPage })) },
  // ?customer=<id> starts the form with that customer chosen
  { path: 'pesanan/baru', lazy: () => import('./NewOrderPage').then((m) => ({ Component: m.NewOrderPage })) },
  { path: 'pesanan/:id', lazy: () => import('./OrderDetailPage').then((m) => ({ Component: m.OrderDetailPage })) },
]
