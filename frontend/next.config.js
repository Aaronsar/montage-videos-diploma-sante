/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "https://montage-videos-diploma-sante-production.up.railway.app/api/:path*",
      },
      {
        source: "/storage/:path*",
        destination: "https://montage-videos-diploma-sante-production.up.railway.app/storage/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
