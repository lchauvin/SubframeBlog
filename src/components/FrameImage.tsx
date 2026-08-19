import type { CSSProperties } from "react";
import type { VariantImages } from "@/server/db/queries";

/**
 * Plain <picture>/<img>, not next/image: the design specifies exact frame
 * padding and object-fit, and the derivative pyramid already did the resizing.
 */
export function FrameImage({
  images,
  alt,
  style,
  className,
  sizes,
  priority,
}: {
  images: VariantImages;
  alt: string;
  style?: CSSProperties;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const fallback = images.jpeg ?? images.webp;
  if (!fallback) {
    return (
      <div
        className={className}
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 120,
          color: "var(--color-neutral-600)",
          font: "400 9.5px/1 var(--font-mono)",
          letterSpacing: ".14em",
          textTransform: "uppercase",
          ...style,
        }}
      >
        No image
      </div>
    );
  }

  return (
    <picture>
      {images.webp ? <source srcSet={images.webp.src} type="image/webp" sizes={sizes} /> : null}
      <img
        src={fallback.src}
        width={fallback.width}
        height={fallback.height}
        alt={alt}
        className={className}
        sizes={sizes}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : undefined}
        style={style}
      />
    </picture>
  );
}
