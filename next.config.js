/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/ru',
        destination: '/',
        permanent: true,
      },
    ];
  },
};
module.exports = nextConfig;
