import type { MetadataRoute } from "next";
import { getAllLessons, isFreeLevel, LEVELS, levelToSlug } from "@/lib/lessons";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://frenchproperly.com";
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/lessons`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/practice`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/refund`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  const levelRoutes: MetadataRoute.Sitemap = LEVELS.map((level) => {
    const slug = levelToSlug(level);
    const free = isFreeLevel(level);
    return {
      url: `${baseUrl}/lessons/${slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: free ? 0.8 : 0.7,
    };
  });

  const lessonRoutes: MetadataRoute.Sitemap = getAllLessons().map((lesson) => {
    const free = isFreeLevel(lesson.level);
    return {
      url: `${baseUrl}/lessons/${levelToSlug(lesson.level)}/${lesson.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: free ? 0.8 : 0.6,
    };
  });

  return [...staticRoutes, ...levelRoutes, ...lessonRoutes];
}
