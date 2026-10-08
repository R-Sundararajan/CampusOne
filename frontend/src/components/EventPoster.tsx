import { useState } from "react";
// Reusable for the future event slice. No fabricated event records are rendered.
export function EventPoster({ src, title }: { src?: string; title: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  return (
    <div className="event-poster">
      {src && src !== failedSource ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          onError={() => setFailedSource(src)}
        />
      ) : (
        <span>
          Event poster
          <br />
          <small>Image unavailable</small>
        </span>
      )}
    </div>
  );
}
