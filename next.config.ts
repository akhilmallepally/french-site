import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Old lesson URLs from before the level folders. Redirects run before
  // routing, so these win over the /lessons/[level] route.
  async redirects() {
    return [
      { source: "/lessons/01-greetings", destination: "/lessons/a1/greetings", permanent: true },
      { source: "/lessons/02-articles", destination: "/lessons/a1/definite-articles", permanent: true },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
