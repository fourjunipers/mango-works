"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { describedBy, Field, inputClass } from "@/components/form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a server action returns to its form: field errors as message keys of
 * "FormErrors" (the key "form" is the whole-form error), or ok.
 */
export type FormState = {
  ok?: boolean;
  errors?: Record<string, string>;
  /** Numbers an error message names, e.g. { count: 3 }. */
  values?: Record<string, string | number>;
  /** "Did you mean…": links offered with an error, e.g. matching presets. */
  suggestions?: { label: string; href: string }[];
  /** Another way to get it done, offered with an error, e.g. "retire". */
  offer?: string;
};

export type FormAction = (
  state: FormState,
  formData: FormData,
) => Promise<FormState>;

const FormContext = createContext<{
  error: (field: string) => string | undefined;
  pending: boolean;
}>({ error: () => undefined, pending: false });

/** The error message for a field of the surrounding ActionForm, if any. */
export function useFieldError(name: string): string | undefined {
  return useContext(FormContext).error(name);
}

/**
 * A form bound to a server action: shows each field's error under it, a
 * "Saved" note, and a submit button that says it's working. Native inputs
 * throughout, so it works with a finger, a mouse or a keyboard.
 */
export function ActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel,
  confirm,
  confirmIf,
  destructive,
  quiet,
  showSubmit = true,
  submitDisabled = false,
  onOk,
  className,
  offers,
  children,
}: {
  action: FormAction;
  /** Hidden fields, e.g. the shop slug and the row id. */
  hidden?: Record<string, string>;
  submitLabel?: string;
  pendingLabel?: string;
  /** Always ask before submitting (deletes). */
  confirm?: string;
  /** Ask only when this returns a question for what was typed. */
  confirmIf?: (data: FormData) => string | undefined;
  /** An outlined red button; "solid" fills it (deleting for good). */
  destructive?: boolean | "solid";
  /** An outlined button: for an action that isn't its card's main one. */
  quiet?: boolean;
  /** False hides the button, e.g. until a value has changed. */
  showSubmit?: boolean;
  /** True keeps the button from being pressed, e.g. while a value is wrong. */
  submitDisabled?: boolean;
  /** Called once each time the action answers ok, e.g. to close a dialog. */
  onOk?: () => void;
  className?: string;
  /**
   * What to show under the form when the action answers with an `offer`,
   * by its name: usually a button for the other way ("Retire instead").
   */
  offers?: Record<string, ReactNode>;
  children?: ReactNode;
}) {
  const t = useTranslations("FormErrors");
  const tCommon = useTranslations("Common");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  // The latest onOk, so a new function each render doesn't call it again.
  const onOkRef = useRef(onOk);
  useEffect(() => {
    onOkRef.current = onOk;
  });
  useEffect(() => {
    if (state.ok) onOkRef.current?.();
  }, [state]);
  // After a refused save, focus goes to the first field with an error, so
  // a keyboard or screen-reader user lands on what to fix and a phone
  // scrolls to it. Fields mark themselves with aria-invalid. An error with
  // no field of its own (the whole-form message, a list's message) takes
  // the focus itself.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const keys = Object.keys(state.errors ?? {});
    if (keys.length === 0) return;
    const form = formRef.current;
    if (!form) return;
    // Only the whole-form error: its own message takes the focus, not a
    // field or a note the screen itself marked before the save (the pricing
    // form marks days as they are typed).
    const formOnly = keys.length === 1 && keys[0] === "form";
    const marked = formOnly
      ? null
      : form.querySelector<HTMLElement>(
          '[aria-invalid="true"]:not([disabled])',
        );
    // A group is marked as a group, and a group can't take focus: of a
    // group of radios the chosen one does (the one Tab stops at), else the
    // group's first field that can.
    const field = marked?.matches("input, select, textarea")
      ? marked
      : (marked?.querySelector<HTMLElement>(
          'input[type="radio"]:checked:enabled',
        ) ??
        marked?.querySelector<HTMLElement>(
          "input:enabled, select:enabled, textarea:enabled",
        ));
    const target =
      field ??
      (formOnly
        ? form.querySelector<HTMLElement>("[data-form-error]")
        : null) ??
      form.querySelector<HTMLElement>('[role="alert"]');
    if (!target) return;
    if (!field && !target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus();
  }, [state]);
  const error = (field: string) => {
    const key = state.errors?.[field];
    if (!key) return undefined;
    // Keys come from the server, so they are checked at run time.
    const known = key as "saveFailed";
    return t.has(known) ? t(known, state.values) : t("saveFailed");
  };

  return (
    <FormContext.Provider value={{ error, pending }}>
      <form
        ref={formRef}
        action={formAction}
        className={cn("space-y-5", className)}
        onSubmit={(event) => {
          // Submitted by hand rather than left to the browser, so the fields
          // keep what was typed when the server sends back an error, and a
          // dropdown keeps the value just saved. (Without JavaScript the
          // plain form action above still works.)
          event.preventDefault();
          const data = new FormData(
            event.currentTarget,
            (event.nativeEvent as SubmitEvent).submitter,
          );
          const question = confirm ?? confirmIf?.(data);
          if (question && !window.confirm(question)) return;
          startTransition(() => formAction(data));
        }}
      >
        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
        <div className="flex flex-wrap items-center gap-3">
          {showSubmit && (
            <Button
              type="submit"
              variant={destructive === true || quiet ? "outline" : "default"}
              className={cn(
                "h-11 px-6",
                destructive === true &&
                  "border-destructive/40 text-destructive",
                // White on the red: 4.8:1 (light), and the lighter red of the
                // dark theme takes near-black text.
                destructive === "solid" &&
                  "bg-destructive text-white hover:bg-destructive/85 dark:text-zinc-950",
              )}
              disabled={pending || submitDisabled}
            >
              {pending
                ? (pendingLabel ?? tCommon("saving"))
                : (submitLabel ?? tCommon("save"))}
            </Button>
          )}
          {state.ok && !pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {tCommon("saved")}
            </p>
          )}
          {state.errors?.form && (
            <p
              role="alert"
              data-form-error=""
              className="text-sm text-destructive"
            >
              {error("form")}
            </p>
          )}
        </div>
        {state.suggestions && state.suggestions.length > 0 && !pending && (
          <div className="rounded-md border border-highlight-border bg-highlight p-3 text-sm text-highlight-foreground">
            <p className="font-medium">{tCommon("didYouMean")}</p>
            <ul className="mt-1">
              {state.suggestions.map((suggestion) => (
                <li key={suggestion.href}>
                  <a
                    href={suggestion.href}
                    className="inline-flex min-h-11 items-center font-medium underline"
                  >
                    {suggestion.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
      {/* Outside the form: an offer is usually a form of its own. */}
      {state.offer && !pending && offers?.[state.offer] && (
        <div>{offers[state.offer]}</div>
      )}
    </FormContext.Provider>
  );
}

type Labelled = { name: string; label: string; help?: string };

/** A labelled input wired to the form's errors. */
export function TextInput({
  name,
  label,
  help,
  className,
  ...props
}: Labelled & Omit<ComponentProps<"input">, "name" | "id">) {
  const message = useFieldError(name);
  return (
    <Field id={name} label={label} help={help} error={message}>
      <input
        id={name}
        name={name}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(name, { help, error: message })}
        autoComplete="off"
        className={cn(inputClass, className)}
        {...props}
      />
    </Field>
  );
}

export function TextArea({
  name,
  label,
  help,
  ...props
}: Labelled & Omit<ComponentProps<"textarea">, "name" | "id">) {
  const message = useFieldError(name);
  return (
    <Field id={name} label={label} help={help} error={message}>
      <textarea
        id={name}
        name={name}
        rows={3}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(name, { help, error: message })}
        className={cn(inputClass, "h-auto py-2")}
        {...props}
      />
    </Field>
  );
}

export function SelectInput({
  name,
  label,
  help,
  options,
  ...props
}: Labelled & {
  options: { value: string; label: string }[];
} & Omit<ComponentProps<"select">, "name" | "id">) {
  const message = useFieldError(name);
  return (
    <Field id={name} label={label} help={help} error={message}>
      <select
        id={name}
        name={name}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(name, { help, error: message })}
        className={inputClass}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A checkbox with a 44 px tap target. */
export function CheckboxInput({
  name,
  label,
  help,
  ...props
}: Labelled & Omit<ComponentProps<"input">, "name" | "id" | "type">) {
  const message = useFieldError(name);
  return (
    <div className="space-y-1">
      <label
        htmlFor={name}
        className="flex min-h-11 items-center gap-3 text-sm font-medium"
      >
        <input
          id={name}
          name={name}
          type="checkbox"
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy(name, { help, error: message })}
          className="size-5 accent-primary"
          {...props}
        />
        {label}
      </label>
      {help && (
        <p id={`${name}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {message && (
        <p
          id={`${name}-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          {message}
        </p>
      )}
    </div>
  );
}

/** One choice from a short list, each with a line saying what it means. */
export function RadioList({
  name,
  legend,
  options,
  defaultValue,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string; help: string; disabled?: boolean }[];
  defaultValue: string;
}) {
  const message = useFieldError(name);
  return (
    // The group, not each radio, is what can be invalid: a radio's role
    // does not take aria-invalid, a radio group's does.
    <fieldset
      role="radiogroup"
      aria-invalid={message ? true : undefined}
      aria-describedby={describedBy(name, { error: message })}
      className="space-y-2"
    >
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-highlight",
            option.disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={option.value === defaultValue}
            disabled={option.disabled}
            className="mt-0.5 size-5 accent-primary"
          />
          <span>
            <span className="block font-medium">{option.label}</span>
            <span className="block text-sm text-muted-foreground">
              {option.help}
            </span>
          </span>
        </label>
      ))}
      {message && (
        <p
          id={`${name}-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          {message}
        </p>
      )}
    </fieldset>
  );
}

/** A white panel with a heading, for one group of fields or one list. */
export function Panel({
  id,
  title,
  intro,
  children,
  className,
}: {
  /** An anchor to link or scroll to, e.g. "purchase-sale". */
  id?: string;
  title?: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        "scroll-mt-20 rounded-lg border bg-card p-4 sm:p-5",
        className,
      )}
    >
      {title && (
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
      )}
      {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
      <div className={cn((title || intro) && "mt-4")}>{children}</div>
    </section>
  );
}
