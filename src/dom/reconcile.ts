// A tiny keyed DOM reconciler: reuse nodes by id so persistent items animate,
// new ones enter, and removed ones fade out. Kept separate so any view can use
// it without pulling in the rest of MemoryViz.

export function reconcile<T extends { id: string }>(
  container: HTMLElement,
  items: T[],
  make: (item: T, existing?: HTMLElement) => HTMLElement,
): void {
  const want = new Set(items.map((it) => it.id));
  Array.from(container.children).forEach((node) => {
    const el = node as HTMLElement;
    if (!want.has(el.dataset.id ?? "") && !el.classList.contains("leaving")) {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 280);
    }
  });
  items.forEach((it) => {
    let node = container.querySelector<HTMLElement>(`[data-id="${it.id}"]:not(.leaving)`);
    if (!node) {
      node = make(it);
      node.dataset.id = it.id;
      node.classList.add("enter");
      container.appendChild(node);
    } else {
      make(it, node);
    }
  });
}
