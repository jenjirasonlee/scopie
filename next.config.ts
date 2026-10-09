import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // proxy.ts buffers request bodies; content uploads can be up to 50 MB (lib/content/files.ts).
    proxyClientMaxBodySize: '55mb',
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
