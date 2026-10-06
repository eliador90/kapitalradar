import type { NextConfig } from "next";

const config: NextConfig = {
  // Private preview (eng delta A13): nothing is indexed, gate page included.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
  poweredByHeader: false,
};

export default config;
