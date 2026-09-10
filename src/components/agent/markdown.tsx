import { Fragment, type ReactNode } from "react";

/**
 * Minimal markdown renderer for agent output.
 *
 * The agent's messages are assembled by our own code, so the supported subset
 * is deliberately tiny — bold, inline code, bullets and paragraphs. Text is
 * never interpreted as HTML, which keeps model output from injecting markup.
 */
export function Markdown({ content }: { content: string }) {
  const blocks = content.split("\n");

  return (
    <div className="space-y-1.5">
      {blocks.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1.5" />;

        if (/^[-•*]\s+/.test(trimmed)) {
          return (
            <div key={index} className="flex gap-2 pl-1">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
              <span className="min-w-0">{renderInline(trimmed.replace(/^[-•*]\s+/, ""))}</span>
            </div>
          );
        }

        if (/^_.+_$/.test(trimmed)) {
          return (
            <p key={index} className="text-[12px] text-muted-foreground italic">
              {renderInline(trimmed.slice(1, -1))}
            </p>
          );
        }

        return <p key={index}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string): ReactNode {
  const parts = text.split(INLINE_PATTERN).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
