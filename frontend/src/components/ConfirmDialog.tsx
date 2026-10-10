import { useEffect, useRef } from "react";
export function ConfirmDialog({
  title,
  description,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirmation-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <h2 id="confirmation-title">{title}</h2>
      <p>{description}</p>
      <div className="button-row">
        <button
          className="secondary-button"
          autoFocus
          onClick={onClose}
          disabled={busy}
        >
          Keep current state
        </button>
        <button className="primary-button" onClick={onConfirm} disabled={busy}>
          {busy ? "Saving…" : "Confirm"}
        </button>
      </div>
    </dialog>
  );
}
