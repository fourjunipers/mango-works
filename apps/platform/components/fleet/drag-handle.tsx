"use client";

import { createContext, useContext } from "react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * What a row's drag handle needs from the list it is in
 * (components/fleet/drag-rows). Only types come from the drag library here,
 * so this file doesn't load it.
 */
export type RowDrag = {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setHandle: (element: HTMLElement | null) => void;
};

export const RowDragContext = createContext<RowDrag | null>(null);

/**
 * The drag handle on a row in reorder mode (design §5.8): small to see, 44 px
 * to hold. Only the handle starts a drag. Mouse: press and move 8 px. Touch:
 * hold a quarter of a second, then drag; a quick tap does nothing and a
 * finger that moves sooner scrolls the page (so `touch-action` stays on).
 * Keyboard: Space, arrows, Space. It switches off text selection and the
 * long-press menu for itself only.
 */
export function DragHandle({ name }: { name: string }) {
  const drag = useContext(RowDragContext);
  const t = useTranslations("Lists.drag");
  if (!drag) return null;
  const { attributes, listeners, setHandle } = drag;
  return (
    <button
      type="button"
      ref={(element) => setHandle(element)}
      {...attributes}
      {...listeners}
      data-drag-handle
      aria-label={`${t("handle")}: ${name}`}
      title={t("handle")}
      onContextMenu={(event) => event.preventDefault()}
      className="inline-flex size-11 shrink-0 cursor-grab touch-manipulation items-center justify-center rounded-md text-muted-foreground/80 transition-colors outline-none select-none [-webkit-touch-callout:none] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <GripVertical aria-hidden className="size-4" />
    </button>
  );
}
