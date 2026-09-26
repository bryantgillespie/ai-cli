import { extractHeadings, getDoc } from "fromsrc";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { docsHref, isSafePathSegments } from "@/lib/docs-pages";
import { description as siteDescription, siteName } from "@/lib/site";

import { Mdx } from "../mdx";
import { Outline } from "../outline";

interface Props {
  params: Promise<{ slug?: string[] }>;
}

function metaDescription(text: string | undefined): string {
  if (text && text.length >= 50) {
    return text;
  }
  if (!text) {
    return siteDescription;
  }
  const combined = `${text} ${siteDescription}`;
  return combined.length >= 50 ? combined : siteDescription;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const path = slug ?? [];
  if (!isSafePathSegments(path)) {
    return {};
  }
  const doc = await getDoc("docs", path);
  if (!doc) {
    return {};
  }
  const href = docsHref(doc.slug === "index" ? "" : doc.slug);
  const description = metaDescription(doc.description);
  return {
    title: doc.title,
    description,
    alternates: {
      canonical: href,
      types: {
        "text/markdown": `${href}.md`,
      },
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName,
      title: doc.title,
      description,
      url: href,
      images: [{ url: "/og", width: 1200, height: 630, alt: doc.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: doc.title,
      description,
      images: ["/og"],
    },
  };
}

export default async function DocsPage({ params }: Props) {
  const { slug } = await params;
  const path = slug ?? [];
  if (!isSafePathSegments(path)) {
    notFound();
  }
  const doc = await getDoc("docs", path);

  if (!doc) {notFound();}

  const headings = extractHeadings(doc.content).filter(
    (heading) => heading.level >= 2 && heading.level <= 3
  );

  return (
    <div className="flex w-full max-w-7xl mx-auto">
      <article className="flex-1 min-w-0 px-8 py-12 lg:px-12">
        <div className="docs-article max-w-[860px]">
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight">
              {doc.title}
            </h1>
            {doc.description && (
              <p className="mt-3 text-lg text-muted">{doc.description}</p>
            )}
          </header>
          <Mdx source={doc.content} />
        </div>
      </article>
      <Outline headings={headings} />
    </div>
  );
}
