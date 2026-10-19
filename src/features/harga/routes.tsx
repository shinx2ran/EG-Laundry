import type { RouteObject } from 'react-router'

export const hargaRoutes: RouteObject[] = [
  { path: 'harga', lazy: () => import('./HargaPage').then((m) => ({ Component: m.HargaPage })) },
]
