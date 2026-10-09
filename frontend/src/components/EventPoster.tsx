import { useState } from "react";
// Shared 3:4 frame preserves complete portrait and landscape posters.
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
          {title}
          <br />
          <small>{src ? "Poster unavailable" : "Club event · CampusOne"}</small>
        </span>
      )}
    </div>
  );
}
