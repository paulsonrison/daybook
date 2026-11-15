import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Daybook',
    short_name: 'Daybook',
    description: 'Newspaper agency workspace with offline field entries',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f6f3',
    theme_color: '#087f73',
    icons: [
      {
        src: '/pwa/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [{ name: 'Field workspace', url: '/field.html' }],
  };
}
