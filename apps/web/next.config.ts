import type { NextConfig } from "next";

const config: NextConfig = {
  reactCompiler: true,
  outputFileTracingIncludes: {
    "/*": ["./docs/**/*"],
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/index.md", destination: "/api/docs-md" },
        { source: "/:path*.md", destination: "/api/docs-md/:path*" },
      ],
    };
  },
};

export default config;
