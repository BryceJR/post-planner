import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the AI connector's Allow page never shows inside another site's frame,
  // so nobody can trick a click on Allow
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
