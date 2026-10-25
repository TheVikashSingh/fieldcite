import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't write an AGENTS.md into the repo on `next dev`.
  agentRules: false,
  async headers() {
    return [
      {
        // Reports are private (SPEC F-2): not indexed, and the share token in the URL is never
        // sent as a referrer to the cited pages a report links to.
        source: "/r/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Sign-in links carry a one-time token in the URL: keep it out of indexes and away from
        // other sites. "same-origin" (not "no-referrer") so the confirm POST still carries an
        // Origin header for its same-origin check.
        source: "/auth/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
