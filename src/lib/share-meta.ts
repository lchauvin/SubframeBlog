import type { Metadata } from "next";
import { headers } from "next/headers";

import type { ImageSet, VariantImages } from "@/server/db/queries";
import { pickImage } from "@/server/db/queries";

/**
 * Public origin for Open Graph / Twitter URLs.
 *
 * Crawlers need an absolute image URL. Prefer ASTROBLOG_SITE_URL so a reverse
 * proxy's internal Host cannot leak into previews; fall back to the request.
 */
export async function siteOrigin(): Promise<URL | undefined> {
  const configured = process.env.ASTROBLOG_SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured.endsWith("/") ? configured : `${configured}/`);
    } catch {
      return undefined;
    }
  }

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return undefined;
    const forwarded = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto =
      forwarded || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
    return new URL(`${proto}://${host}/`);
  } catch {
    return undefined;
  }
}

function shareImage(images: ImageSet | undefined, alt: string) {
  if (!images) return undefined;
  const variant: VariantImages = pickImage(images, "article");
  const ref = variant.jpeg ?? variant.webp;
  if (!ref) return undefined;
  return {
    url: ref.src,
    width: ref.width,
    height: ref.height,
    alt,
    type: variant.jpeg ? "image/jpeg" : "image/webp",
  };
}

export function shareMetadata({
  title,
  description,
  images,
  path,
  origin,
  siteName,
  type = "website",
}: {
  title: string;
  description: string;
  images?: ImageSet;
  path: string;
  origin?: URL;
  siteName?: string;
  type?: "website" | "article";
}): Metadata {
  const image = shareImage(images, title);
  const url = origin ? new URL(path.replace(/^\//, ""), origin).toString() : undefined;

  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      type,
      title,
      description,
      siteName,
      url,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image.url] : undefined,
    },
  };
}
