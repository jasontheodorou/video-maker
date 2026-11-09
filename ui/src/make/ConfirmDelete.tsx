// "Delete this video?" asked in the page, GOV.UK style. Focus goes to the safe answer (Cancel), Escape cancels,
// and a failed delete says why inside the question.
import { Button } from "@mantine/core";
import { useEffect, useId, useRef, useState } from "react";
import { Reveal } from "../shared/motion";
import { Message } from "../shared/ui";

export function ConfirmDelete({ title, onYes, onCancel, className = "" }: { title: string; onYes: () => Promise<string | void>; onCancel: () => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const qid = useId();
  useEffect(() => noRef.current?.focus(), []);
  return (
    <Reveal
      className={`confirm delete-question ${className}`}
      role="group"
      aria-labelledby={qid}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <Message tone="warn">
        <h3 className="h4" id={qid}>
          Delete this video?
        </h3>
        <p>
          <span className="visually-hidden">{`${title}. `}</span>It can’t be undone.
        </p>
        {error ? (
          <p className="error-msg" role="alert">
            <span className="visually-hidden">Error: </span>
            {error}
          </p>
        ) : null}
        <div className="buttons">
          <Button
            className="danger"
            color="red"
            aria-disabled={busy || undefined}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError(null);
              const err = await onYes();
              // On success the question unmounts with its row or page; only a problem keeps it here.
              if (err) {
                setError(err);
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting..." : "Yes, delete it"}
          </Button>
          <Button ref={noRef} variant="default" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Message>
    </Reveal>
  );
}
