import type { CompileError } from "../types.js";

// Capstone-quality compile-error panel, shared by every surface that runs code
// (the build/drill lesson engines reuse this instead of dumping joined text).
// The markup mirrors the Blazor capstone so one stylesheet covers all of them.

export interface ErrorPanelLabels {
  heading: string;
  note: string;
  /** Opens the paragraph explaining the idea behind the message. */
  why: string;
  hideWhy: string;
  /** Heading used when the panel lists warnings rather than errors. */
  warningHeading: string;
  warningNote: string;
}

const DEFAULT_LABELS: ErrorPanelLabels = {
  heading: "Let's fix this first",
  note: "Often a single early mistake (a missing or extra { } ( ) ;) is enough to confuse the rest. Fix the top one first, then run again.",
  why: "Learn why",
  hideWhy: "Hide why",
  warningHeading: "It ran - but read this",
  warningNote: "The compiler built this, so it is not an error. It is telling you these lines cannot be doing what they look like they do. Code that runs and is still wrong is the expensive kind.",
};

function locText(e: CompileError): string {
  if (e.line == null) return "";
  return e.column != null ? `Line ${e.line}, col ${e.column}` : `Line ${e.line}`;
}

export interface ErrorPanelOptions {
  /** Render as advisory warnings (the run succeeded) rather than blocking errors. */
  kind?: "error" | "warning";
}

/** Build the compile-error panel as a detached element. */
export function renderErrorPanel(
  errors: CompileError[],
  labels: Partial<ErrorPanelLabels> = {},
  options: ErrorPanelOptions = {},
): HTMLElement {
  const l = { ...DEFAULT_LABELS, ...labels };
  const isWarning = options.kind === "warning";

  const section = document.createElement("section");
  section.className = isWarning ? "cl-errors cl-errors--warning" : "cl-errors";

  const heading = document.createElement("h3");
  heading.textContent = isWarning ? l.warningHeading : l.heading;
  section.appendChild(heading);

  const note = document.createElement("p");
  note.className = "cl-errors-note";
  note.textContent = isWarning ? l.warningNote : l.note;
  section.appendChild(note);

  const list = document.createElement("ul");
  for (const e of errors) {
    const li = document.createElement("li");

    const loc = locText(e);
    if (loc) {
      const locEl = document.createElement("span");
      locEl.className = "cl-error-loc";
      locEl.textContent = loc;
      li.appendChild(locEl);
    }

    if (e.friendly) {
      const friendly = document.createElement("span");
      friendly.className = "cl-error-friendly";
      friendly.textContent = e.friendly;
      li.appendChild(friendly);
    }

    const raw = document.createElement("span");
    raw.className = "cl-error-raw";
    raw.textContent = e.raw;
    li.appendChild(raw);

    // The concept stays folded away. Someone mid-fix wants the fix; someone who
    // has already fixed it twice wants to know why it keeps happening.
    if (e.why) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cl-error-why-toggle";
      toggle.textContent = l.why;
      toggle.setAttribute("aria-expanded", "false");

      const why = document.createElement("p");
      why.className = "cl-error-why";
      why.textContent = e.why;
      why.hidden = true;

      toggle.addEventListener("click", () => {
        why.hidden = !why.hidden;
        toggle.textContent = why.hidden ? l.why : l.hideWhy;
        toggle.setAttribute("aria-expanded", why.hidden ? "false" : "true");
      });

      li.appendChild(toggle);
      li.appendChild(why);
    }

    list.appendChild(li);
  }
  section.appendChild(list);

  return section;
}

/** Replace the contents of `host` with the error panel, or clear and hide it
 *  when there are no errors. Returns true when errors were shown. */
export function showErrorPanel(
  host: HTMLElement,
  errors: CompileError[] | undefined,
  labels?: Partial<ErrorPanelLabels>,
  options?: ErrorPanelOptions,
): boolean {
  host.textContent = "";
  if (!errors || errors.length === 0) {
    host.hidden = true;
    return false;
  }
  host.appendChild(renderErrorPanel(errors, labels, options));
  host.hidden = false;
  return true;
}
