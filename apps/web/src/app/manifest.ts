import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'KitStak',
    short_name: 'KitStak',
    description: 'CRM, WMS, Projects and Pulse on one stack.',
    start_url: '/',
    display: 'browser',
    background_color: '#0a1628',
    theme_color: '#0a1628',
    icons: [{ src: '/brand/kitstak-icon-512.png', sizes: '512x512', type: 'image/png' }],
  };
}
