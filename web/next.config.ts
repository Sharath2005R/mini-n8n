import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@apollo/client"],
  reactStrictMode: false,
};

export default nextConfig;
