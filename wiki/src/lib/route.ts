import { useEffect, useState } from "react";

// hash routing: /wiki/#/factorio — static hosting needs no fallback config
export function currentSlug(): string {
  return window.location.hash.replace(/^#\/?/, "") || "home";
}

export function useRoute(): string {
  const [slug, setSlug] = useState(currentSlug);
  useEffect(() => {
    const onChange = () => {
      setSlug(currentSlug());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return slug;
}

export function navigate(slug: string) {
  window.location.hash = `/${slug}`;
}

export function href(slug: string): string {
  return `#/${slug}`;
}
