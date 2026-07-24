import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  source: string;
}

/**
 * Shared markdown renderer for blog posts (plan 0011): public pages and the
 * admin editor preview render through the same component so what you preview
 * is what ships. react-markdown never renders raw HTML, so no sanitizer is
 * needed; images are plain external URLs.
 *
 * Only import from lazy routes — react-markdown lives in the vendor-markdown
 * chunk and must stay off the eager landing payload.
 */
export function MarkdownContent({ source }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-a:text-primary prose-code:text-foreground prose-blockquote:text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <img src={src} alt={alt ?? ""} loading="lazy" className="rounded-lg" />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
