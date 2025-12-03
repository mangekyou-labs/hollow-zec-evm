import type { NextConfig } from "next";

const CopyPlugin = require("copy-webpack-plugin");
const path = require("path");

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
