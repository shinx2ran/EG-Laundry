import type { RouteObject } from 'react-router'

export const laporanRoutes: RouteObject[] = [
  { path: 'laporan', lazy: () => import('./LaporanPage').then((m) => ({ Component: m.LaporanPage })) },
]
