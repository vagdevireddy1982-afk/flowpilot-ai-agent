import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` serves client bundles only to origins it recognises. The e2e
  // suite and local smoke checks address the server by IP, so allow the
  // loopback hosts through in development.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
