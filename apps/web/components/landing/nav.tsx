"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Nav() {
  const [scrolled, setScrolled] = useState(true);

  useEffect(() => {
    const handle = () => setScrolled(window.scrollY > 20);
    handle();
    window.addEventListener("scroll", handle, { passive: true });
    return () => window.removeEventListener("scroll", handle);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div className="mx-auto max-w-[1320px]">
        <div
          className={`flex h-16 items-center justify-between border-x border-b px-6 transition-colors duration-200 ${
            scrolled
              ? "border-x-white/[0.06] border-b-white/[0.06] bg-[#0a0a0a]/95 backdrop-blur-sm"
              : "border-x-transparent border-b-transparent bg-transparent"
          }`}
        >
          <Link href="/" className="flex items-center gap-2.5 text-white">
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 17L10 11L4 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 19H20"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-sm font-semibold tracking-tight">ai-cli</span>
          </Link>

          <div className="flex items-center gap-6">
            <Link
              href="/docs"
              className="text-sm text-white/50 hover:text-white transition-colors"
            >
              Docs
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
