import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["nodemailer", "docx"],
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;
