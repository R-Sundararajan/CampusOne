import type { AnchorHTMLAttributes } from "react";
import { navigate } from "../hooks/useRoute";
export function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
) {
  return (
    <a
      {...props}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigate(props.href);
        }
      }}
    />
  );
}
