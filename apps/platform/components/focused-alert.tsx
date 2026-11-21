"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A refusal with no field of its own, for a form that is not the shared
 * ActionForm (Phase 2 stage 11): it takes the focus when it appears, and
 * again on each new answer (`answer`, the action's state object), as the
 * shared form's whole-form message does. A keyboard or screen-reader user
 * then lands on what went wrong, and a phone scrolls to it.
 */
export function FocusedAlert({
  answer,
  as: Tag = "p",
  id,
  className,
  children,
}: {
  /** The action's latest answer: a new one moves the focus again. */
  answer: unknown;
  as?: "p" | "div";
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLParagraphElement & HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [answer]);
  return (
    <Tag
      ref={ref}
      id={id}
      role="alert"
      tabIndex={-1}
      data-form-error=""
      className={className}
    >
      {children}
    </Tag>
  );
}
