/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Webpack configuration for Office.js
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Treat Office.js as external - loaded from CDN
      config.externals = {
        ...config.externals,
        'office-js': 'Office',
      };
    }
    return config;
  },

  // Headers for Office add-in security
  async headers() {
    return [
      {
        source: '/taskpane/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOW-FROM https://www.office.com',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://www.office.com https://outlook.office.com https://outlook.office365.com;",
          },
        ],
      },
    ];
  },

  // Experimental features
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
