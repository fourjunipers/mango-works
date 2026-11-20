"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { inputClass } from "@/components/form";
import {
  matchOptions,
  readRecent,
  recentAfter,
  type PriceCheckOption,
} from "@/lib/new-order";
import { cn } from "@/lib/utils";

/**
 * The Price check's one search box (20 Nov 2026): as you type, the products
 * that match by name, kind or category; picking one sends the form with it,
 * so its free count and price open under the box. The last few looked at
 * stay as quick chips, in this browser only (per shop).
 *
 * Before the page's scripts have started, or on Enter with nothing picked,
 * the text goes as `q`: the page then opens the one match, or lists them.
 */
export function PriceCheckSearch({
  slug,
  options,
  selectedId,
  typed,
}: {
  slug: string;
  options: PriceCheckOption[];
  selectedId: string | null;
  /** What the box starts with: the product shown, or what was searched. */
  typed: string;
}) {
  const t = useTranslations("NewOrder");
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const productRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(typed);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const recent = useRecent(slug, selectedId);
  // "yes" once the box runs in the browser: tests type only then.
  const started = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  const matches = matchOptions(options, text);
  const showList = open && text.trim() !== "";
  const byId = new Map(options.map((o) => [o.id, o]));
  const chips = recent
    .filter((r) => r !== selectedId)
    .map((r) => byId.get(r))
    .filter((o): o is PriceCheckOption => !!o);

  const pick = (option: PriceCheckOption) => {
    setText(option.name);
    setOpen(false);
    if (productRef.current) productRef.current.value = option.id;
    inputRef.current?.form?.requestSubmit();
  };

  return (
    <div
      className="min-w-0 flex-1 space-y-2"
      data-started={started ? "yes" : "no"}
    >
      <div className="relative">
        <label htmlFor={`${id}-input`} className="sr-only">
          {t("search")}
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          id={`${id}-input`}
          name="q"
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && matches[active] ? `${id}-opt-${active}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          placeholder={t("searchPlaceholder")}
          className={cn(inputClass, "pl-9")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            // Typing again forgets the product picked before.
            if (productRef.current) productRef.current.value = "";
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && matches.length > 0) {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (a + 1) % matches.length);
            } else if (e.key === "ArrowUp" && matches.length > 0) {
              e.preventDefault();
              setActive((a) => (a - 1 + matches.length) % matches.length);
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Enter" && showList && matches[active]) {
              e.preventDefault();
              pick(matches[active]);
            }
          }}
        />
        <input
          ref={productRef}
          type="hidden"
          name="product"
          defaultValue={selectedId ?? ""}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={t("search")}
          hidden={!showList}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t("noMatch", { query: text.trim() })}
            </li>
          ) : (
            matches.map((option, i) => (
              <li
                key={option.id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                // Keep the focus in the box, so blur doesn't close the list first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col justify-center rounded-sm px-3 py-1.5",
                  i === active && "bg-accent text-accent-foreground",
                )}
              >
                <span className="truncate text-sm font-medium">
                  {option.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {option.what}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
      {chips.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("recent")}
          </span>
          <ul className="flex gap-2" aria-label={t("recent")}>
            {chips.map((option) => (
              <li key={option.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => pick(option)}
                  className="h-9 max-w-48 truncate rounded-full border px-3 text-sm hover:bg-accent"
                >
                  {option.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const noSubscribe = () => () => {};

/**
 * The products looked at lately in this browser, the one shown first. Kept
 * in localStorage per shop; a browser that keeps nothing simply has no chips.
 */
function useRecent(slug: string, selectedId: string | null): string[] {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    const key = `price-check-recent:${slug}`;
    let list: string[] = [];
    try {
      list = readRecent(window.localStorage.getItem(key));
      if (selectedId) {
        list = recentAfter(list, selectedId);
        window.localStorage.setItem(key, JSON.stringify(list));
      }
    } catch {
      // Storage blocked: no chips.
    }
    // Read once the page runs in a browser: the server has no storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(list);
  }, [slug, selectedId]);
  return recent;
}
