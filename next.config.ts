import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA || "local" },
};
export default config;
