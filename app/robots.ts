import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: [
          "*",
          "Googlebot",
          "Google-Extended",
          "OAI-SearchBot",
          "ChatGPT-User",
          "PerplexityBot",
        ],
        allow: "/",
        disallow: ["/api/", "/checkout/", "/sign-in"],
      },
    ],
    sitemap: "https://frenchproperly.com/sitemap.xml",
  };
}
