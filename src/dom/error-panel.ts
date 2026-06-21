import type { CompileError } from "../types.js";

// Capstone-quality compile-error panel, shared by every surface that runs code
// (the build/drill lesson engines reuse this instead of dumping joined text).
// The markup mirrors the Blazor capstone so one stylesheet covers all of them.

export interface ErrorPanelLabels {
  heading: string;
  note: string;
}

const DEFAULT_LABELS: ErrorPanelLabels = {
  heading: "Let's fix this first",
  note: "Often a single early mistake (a missing or extra { } ( ) ;) is enough to confuse the rest. Fix the top one first, then run again.",
};

function locText(e: CompileError): string {
  if (e.line == null) return "";
  return e.column != null ? `Line ${e.line}, col ${e.column}` : `Line ${e.line}`;
}

/** Build the compile-error panel as a detached element. */
export function renderErrorPanel(
  errors: CompileError[],
  labels: Partial<ErrorPanelLabels> = {},
): HTMLElement {
  const l = { ...DEFAULT_LABELS, ...labels };

  const section = document.createElement("section");
  section.className = "cl-errors";

  const heading = document.createElement("h3");
  heading.textContent = l.heading;
  section.appendChild(heading);

  const note = document.createElement("p");
  note.className = "cl-errors-note";
  note.textContent = l.note;
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
): boolean {
  host.textContent = "";
  if (!errors || errors.length === 0) {
    host.hidden = true;
    return false;
  }
  host.appendChild(renderErrorPanel(errors, labels));
  host.hidden = false;
  return true;
}
