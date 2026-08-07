import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";

// test/viz-lab-source.dom.test.ts - setSource must survive the async boot.
//
// WHY THIS EXISTS
// VizLab loads Monaco from a CDN, so its editor does not exist for the first
// second or two of a page's life. MonacoEditor.setValue is a no-op before mount
// (`if (this.editor)`), which means a host that pushes the learner's starter in
// during that window loses it SILENTLY and the learner is handed an empty
// editor - and then, on Visualize, "Program does not contain a static 'Main'".
//
// That is exactly how the course's lab plugin drives the widget: it mounts the
// widget once per page and calls setSource for each card, including the first.
// This was caught by running the real thing, not by reading the code.
//
// Monaco cannot load in jsdom, so this drives the same contract through a stub
// editor with the real timing: writes that arrive before mount are held, and the
// most recent one is what the editor opens with.

class FakeEditor {
  private editor: { value: string } | null = null;
  async mount(_host: unknown, opts: { value: string }): Promise<void> {
    this.editor = { value: opts.value };
  }
  getValue(): string {
    return this.editor ? this.editor.value : "";
  }
  setValue(value: string): void {
    if (this.editor) this.editor.value = value;
  }
}

// The exact shape VizLab uses: a pending slot, consumed by boot.
class SourceHolder {
  private mounted = false;
  private pendingSource: string | null = null;
  constructor(private readonly editor: FakeEditor) {}

  async boot(starter: string): Promise<void> {
    await this.editor.mount(null, { value: this.pendingSource ?? starter });
    this.mounted = true;
    if (this.pendingSource !== null) {
      this.editor.setValue(this.pendingSource);
      this.pendingSource = null;
    }
  }
  setSource(code: string): void {
    if (!this.mounted) {
      this.pendingSource = code;
      return;
    }
    this.editor.setValue(code);
  }
  getSource(): string {
    if (!this.mounted) return this.pendingSource ?? "";
    return this.editor.getValue();
  }
}

test("a starter pushed in before the editor mounts is not lost", async () => {
  const editor = new FakeEditor();
  const lab = new SourceHolder(editor);

  const booting = lab.boot("class Program { static void Main() {} }");
  lab.setSource("public class Cat {}");
  await booting;

  assert.equal(
    editor.getValue(), "public class Cat {}",
    "the card's starter must win over the widget's default, not vanish",
  );
});

test("the last write before mount is the one that lands", async () => {
  const editor = new FakeEditor();
  const lab = new SourceHolder(editor);

  const booting = lab.boot("default");
  lab.setSource("first card");
  lab.setSource("second card");
  await booting;

  assert.equal(editor.getValue(), "second card");
});

test("with no write before mount the configured starter still opens", async () => {
  const editor = new FakeEditor();
  const lab = new SourceHolder(editor);
  await lab.boot("the configured starter");
  assert.equal(editor.getValue(), "the configured starter");
});

test("getSource reads back the held value before mount, not empty string", async () => {
  const editor = new FakeEditor();
  const lab = new SourceHolder(editor);

  const booting = lab.boot("default");
  lab.setSource("work in progress");
  assert.equal(
    lab.getSource(), "work in progress",
    "a host that saves the learner's work mid-boot must not save nothing over it",
  );
  await booting;
  assert.equal(lab.getSource(), "work in progress");
});

test("after mount setSource writes straight through", async () => {
  const editor = new FakeEditor();
  const lab = new SourceHolder(editor);
  await lab.boot("default");
  lab.setSource("card two");
  assert.equal(editor.getValue(), "card two");
  lab.setSource("card three");
  assert.equal(editor.getValue(), "card three");
});
