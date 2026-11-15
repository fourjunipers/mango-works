"use client";

import {
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useTransition,
  type ReactNode,
} from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { moveProduct } from "@/app/[tenant]/products/actions";
import { dropTarget, moveInList } from "@/lib/general-products";
import { cn } from "@/lib/utils";
import { RowDragContext, type RowDrag } from "./drag-handle";

export type SortableRow = {
  id: string;
  name: string;
  /** The row as the server drew it, with its DragHandle inside. */
  content: ReactNode;
};

/** Rows move up and down only. */
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * A list whose rows can be dragged by their handles (design §5.8; owner, 14
 * Nov 2026). A drop shows the new order at once and saves it through the
 * same action as the Move up and Move down arrows, so Fleet and the Products
 * list keep their one order; if the save is refused, the list goes back to
 * the saved order.
 */
export default function DragRows({
  slug,
  label,
  className,
  rows,
}: {
  slug: string;
  /** The list's name for screen readers. */
  label: string;
  className?: string;
  /** The rows in the saved order. */
  rows: SortableRow[];
}) {
  const t = useTranslations("Lists.drag");
  const id = useId();
  const saved = useMemo(() => rows.map((row) => row.id), [rows]);
  const [order, setOrder] = useOptimistic(saved);
  const [, startTransition] = useTransition();
  // Whether the row picked up has left its place yet.
  const left = useRef(false);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const sensors = useSensors(
    // A plain click on the handle does nothing.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Hold a quarter of a second; a finger that moves sooner scrolls.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  /** A row's name and place, for what a screen reader is told. */
  const place = (row: UniqueIdentifier, at: UniqueIdentifier = row) => ({
    name: byId.get(String(row))?.name ?? "",
    position: order.indexOf(String(at)) + 1,
    total: order.length,
  });

  function drop({ active, over }: DragEndEvent) {
    if (!over) return;
    const moved = String(active.id);
    const move = dropTarget(order, moved, String(over.id));
    if (!move) return;
    const next = moveInList(order, moved, String(over.id));
    startTransition(async () => {
      setOrder(next);
      const form = new FormData();
      form.set("slug", slug);
      form.set("id", moved);
      form.set("target", move.target);
      form.set("place", move.place);
      await moveProduct(form);
    });
  }

  return (
    <DndContext
      // A fixed id: the library's own counter differs between server and browser.
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[vertical]}
      onDragEnd={drop}
      accessibility={{
        screenReaderInstructions: { draggable: t("instructions") },
        announcements: {
          onDragStart: ({ active }) => {
            left.current = false;
            return t("pickedUp", place(active.id));
          },
          onDragOver: ({ active, over }) => {
            // A row is over its own place as soon as it is picked up: that
            // must not talk over "Picked up".
            if (!over || (over.id === active.id && !left.current)) return;
            left.current = true;
            return t("movedTo", place(active.id, over.id));
          },
          onDragEnd: ({ active, over }) =>
            over
              ? t("dropped", place(active.id, over.id))
              : t("cancelled", place(active.id)),
          onDragCancel: ({ active }) => t("cancelled", place(active.id)),
        },
      }}
    >
      <ul aria-label={label} className={className}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {order.map((rowId) => {
            const row = byId.get(rowId);
            return (
              row && (
                <Row key={rowId} id={rowId} role={t("role")}>
                  {row.content}
                </Row>
              )
            );
          })}
        </SortableContext>
      </ul>
    </DndContext>
  );
}

function Row({
  id,
  role,
  children,
}: {
  id: string;
  role: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, attributes: { roleDescription: role } });
  const drag = useMemo<RowDrag>(
    () => ({ attributes, listeners, setHandle: setActivatorNodeRef }),
    [attributes, listeners, setActivatorNodeRef],
  );
  return (
    <li
      ref={setNodeRef}
      data-sortable-row={id}
      data-dragging={isDragging ? "" : undefined}
      style={{
        transform: transform
          ? `translate3d(0, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      }}
      // The row being dragged sits above the others, on its own background.
      className={cn(
        isDragging && "relative z-10 bg-card shadow-lg ring-1 ring-border",
      )}
    >
      <RowDragContext value={drag}>{children}</RowDragContext>
    </li>
  );
}
