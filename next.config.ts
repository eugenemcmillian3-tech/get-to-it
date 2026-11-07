import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Phase 31 accepts a bounded 10 MB project archive through a server action.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
