import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const DEV_API_PROXY_URL = process.env.NEXT_DEV_API_PROXY_URL || "http://127.0.0.1:8080";

const createNextConfig = (phase: string): NextConfig => ({
  reactCompiler: true,
  ...(phase === PHASE_DEVELOPMENT_SERVER ? {
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${DEV_API_PROXY_URL}/api/:path*`,
        },
        {
          source: "/v1/:path*",
          destination: `${DEV_API_PROXY_URL}/v1/:path*`,
        },
      ];
    },
  } : {
    output: "export",
    assetPrefix: "./",
  }),
});

export default createNextConfig;

