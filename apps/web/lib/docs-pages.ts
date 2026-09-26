import { getAllDocs } from "fromsrc";

export const DOCS_DIR = "docs";

export function isSafePathSegments(segments: readonly string[]): boolean {
  return segments.every(
    (segment) =>
      segment !== ".." && !segment.includes("/") && !segment.includes("\\")
  );
}

export function docsHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export async function publicDocs() {
  const docs = await getAllDocs(DOCS_DIR);
  return [...docs].toSorted((a, b) => (a.order ?? 99) - (b.order ?? 99));
}
