"use client";

import dynamic from "next/dynamic";

/**
 * Fleet's and the Products list's rows in reorder mode, with dragging
 * (design §5.8). The drag library is in its own file, fetched only when this
 * is on the page: reorder mode, which only owners and managers reach. The
 * rows are drawn on the server either way, so the arrows work before the
 * library arrives and without JavaScript.
 */
export const SortableRows = dynamic(() => import("./drag-rows"));
