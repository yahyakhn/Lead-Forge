import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["crawlee", "puppeteer", "playwright"],
}

export default nextConfig