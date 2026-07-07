// BoardView: the stylised hardware board only - UFS storage, the SoC with CPU
// cores and a PC/instruction readout, a GPIO pin/LED, the RAM chip, and copper
// traces with animated signal packets. It exposes small commands; it does not
// know about the memory model or the controls.

import type { CoreLight, Packet, ResolvedModel } from "../core/memory-model.js";
import type { Panel, SyncCtx } from "./panel.js";
import { svgEl } from "./svg.js";

export class BoardView implements Panel {
  readonly el: HTMLElement;
  private readonly board: SVGSVGElement;

  constructor(private readonly uid: number) {
    const u = uid;
    this.el = document.createElement("div");
    this.el.className = "cl-mv-board-wrap";
    this.el.innerHTML = `
      <svg class="cl-mv-board" viewBox="0 0 1000 400" role="img" aria-label="Stylised computer board">
        <defs>
          <linearGradient id="clmv-pcb-${u}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0f3b33" /><stop offset="1" stop-color="#0a2a25" />
          </linearGradient>
          <filter id="clmv-glow-${u}" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <pattern id="clmv-dots-${u}" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="#12463c" />
          </pattern>
        </defs>
        <rect x="6" y="6" width="988" height="388" rx="16" fill="url(#clmv-pcb-${u})" stroke="#123f36" stroke-width="2" />
        <rect x="6" y="6" width="988" height="388" rx="16" fill="url(#clmv-dots-${u})" opacity="0.6" />
        <text x="24" y="380" class="silk silk-dim s-md" font-size="12">board rev PoC · not to scale</text>

        <path data-trace="trUfs" class="trace" d="M 250 190 C 320 190, 350 190, 410 190" />
        <path data-trace="trRam" class="trace" d="M 620 150 C 690 150, 700 120, 762 120" />
        <path data-trace="trGpio" class="trace" d="M 512 300 L 512 348" />
        <path data-trace="trZoom" class="trace" d="M 851 190 C 851 300, 851 320, 851 388" opacity="0.35" />

        <g data-part="ufs">
          <rect x="96" y="136" width="154" height="108" rx="9" class="chip-body" />
          <rect x="106" y="146" width="134" height="88" rx="6" class="chip-lid" />
          <text x="173" y="178" text-anchor="middle" class="silk s-lg" font-size="15" font-weight="700">UFS</text>
          <text x="173" y="198" text-anchor="middle" class="silk s-rg" font-size="11">STORAGE</text>
          <text x="173" y="216" text-anchor="middle" class="silk silk-dim s-sm" font-size="10">256 GB · flash</text>
          <g data-ufsprog></g>
        </g>

        <g data-ram data-part="ram">
          <rect x="760" y="72" width="182" height="118" rx="9" class="chip-body" />
          <text x="851" y="92" text-anchor="middle" class="silk s-md" font-size="12" font-weight="700">LPDDR5 RAM</text>
          <g data-ramcells></g>
          <text x="851" y="184" text-anchor="middle" class="silk silk-dim s-xs" font-size="9">holds: code · global · stack · heap</text>
        </g>

        <g data-part="soc">
          <rect x="410" y="90" width="204" height="210" rx="12" class="chip-body" />
          <rect x="410" y="90" width="204" height="210" rx="12" fill="none" stroke="#2f5a52" stroke-width="1" />
          <text x="512" y="116" text-anchor="middle" class="silk s-lg" font-size="15" font-weight="700">SoC</text>
          <text x="512" y="133" text-anchor="middle" class="silk silk-dim s-sm" font-size="10">system on chip</text>
          <g data-cores></g>
          <rect x="428" y="240" width="168" height="46" rx="6" class="readout" />
          <text x="438" y="258" class="silk silk-dim s-xs" font-size="9">PC</text>
          <text data-pc x="470" y="258" class="silk s-rg" font-size="11" font-family="IBM Plex Mono, monospace">-</text>
          <text data-instr x="438" y="277" class="silk s-rg" font-size="11" font-family="IBM Plex Mono, monospace">idle</text>
        </g>

        <g data-part="gpio">
          <rect x="480" y="300" width="64" height="28" rx="5" class="chip-body" />
          <text x="512" y="318" text-anchor="middle" class="silk s-xs" font-size="9">GPIO buf</text>
          <rect x="500" y="342" width="24" height="14" rx="2" class="pad" opacity="0.85" />
          <circle data-led class="led" cx="512" cy="372" r="11" />
          <text x="536" y="376" class="silk silk-dim s-sm" font-size="10">output pin → world</text>
        </g>
      </svg>`;

    this.board = this.el.querySelector(".cl-mv-board") as SVGSVGElement;
    this.decorate();
  }

  private decorate(): void {
    const cores = this.board.querySelector("[data-cores]") as SVGElement;
    const cpos = [
      [440, 150],
      [512, 150],
      [440, 195],
      [512, 195],
    ];
    cpos.forEach((p, i) => {
      const g = svgEl("g", {});
      g.appendChild(svgEl("rect", { x: p[0], y: p[1], width: 62, height: 38, rx: 5, class: "core", "data-core": i }));
      const tx = svgEl("text", { x: p[0] + 31, y: p[1] + 24, "text-anchor": "middle", class: "silk s-xs", "font-size": 9 });
      tx.textContent = "Core " + i;
      g.appendChild(tx);
      cores.appendChild(g);
    });

    const cells = this.board.querySelector("[data-ramcells]") as SVGElement;
    let n = 0;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 6; c++)
        cells.appendChild(svgEl("rect", { x: 776 + c * 26, y: 110 + r * 22, width: 20, height: 16, rx: 3, class: "ramcell", "data-cell": n++ }));

    const up = this.board.querySelector("[data-ufsprog]") as SVGElement;
    for (let i = 0; i < 4; i++)
      up.appendChild(svgEl("rect", { x: 118 + i * 30, y: 224, width: 22, height: 6, rx: 2, fill: "#c9922e", opacity: 0.9 }));

    for (let i = 0; i < 7; i++)
      this.board.appendChild(svgEl("rect", { x: 620 + i * 26, y: 348, width: 8, height: 22, rx: 2, fill: "#d9b45a", opacity: 0.5 }));
  }

  sync(ctx: SyncCtx): void {
    this.applyState(ctx.model);
  }

  animate(model: ResolvedModel): Promise<void> {
    return this.playPackets(model);
  }

  /** Reflect the non-animated board state for a model. */
  applyState(model: ResolvedModel): void {
    const pc = model.pc ?? -1;
    (this.board.querySelector("[data-pc]") as SVGTextElement).textContent = pc < 0 ? "-" : "0x" + (pc + 1);
    (this.board.querySelector("[data-instr]") as SVGTextElement).textContent = model.instr ?? "";
    this.setRam(Boolean(model.ram));
    (this.board.querySelector("[data-led]") as SVGElement).classList.toggle("on", Boolean(model.led));
    if (typeof model.core === "number") this.pulseCore(model.core);
    this.setCores(model.cores);
    this.setHighlight(model.highlight);
  }

  private setHighlight(parts?: string | string[]): void {
    const wanted = new Set(parts == null ? [] : Array.isArray(parts) ? parts : [parts]);
    this.board.querySelectorAll<SVGElement>("[data-part]").forEach((g) => {
      g.classList.toggle("hl", wanted.has(g.getAttribute("data-part") ?? ""));
    });
  }

  private setRam(loaded: boolean): void {
    this.board.querySelectorAll<SVGElement>(".ramcell").forEach((cell, i) => {
      cell.classList.toggle("on", loaded && i < 12);
    });
    (this.board.querySelector("[data-ram]") as SVGElement).classList.toggle("ram-active", loaded);
  }

  private pulseCore(i: number): void {
    const core = this.board.querySelector(`[data-core="${i}"]`) as SVGElement | null;
    if (!core) return;
    core.classList.add("on");
    setTimeout(() => core.classList.remove("on"), 700);
  }

  /** Light cores persistently, tinting each to the process it runs (parallelism cue). */
  private setCores(lit?: CoreLight[]): void {
    const tint = new Map((lit ?? []).map((c) => [c.i, c.color]));
    this.board.querySelectorAll<SVGElement>(".core").forEach((core) => {
      const i = Number(core.getAttribute("data-core"));
      const on = tint.has(i);
      core.classList.toggle("lit", on);
      const color = tint.get(i);
      if (on && color) core.style.setProperty("--core-tint", color);
      else core.style.removeProperty("--core-tint");
    });
  }

  /** Run this model's signal packets: the load sequence, then any per-step packets. */
  async playPackets(model: ResolvedModel): Promise<void> {
    if (model.load) {
      await this.sendPacket("trUfs", { color: "#ffd479" });
      await this.sendPacket("trRam", { color: "#ffd479" });
      this.setRam(true);
      await this.sendPacket("trZoom", { color: "#37d3a6" });
    }
    for (const p of model.packets ?? []) await this.sendPacket(p.path, p);
  }

  private sendPacket(trace: string, opts: Omit<Packet, "path"> = {}): Promise<void> {
    const path = this.board.querySelector(`[data-trace="${trace}"]`) as SVGPathElement | null;
    if (!path) return Promise.resolve();
    const { reverse = false, color = "#ffd479", dur = 780 } = opts;
    return new Promise((resolve) => {
      const len = path.getTotalLength();
      const dot = svgEl("circle", { r: 6, fill: color, filter: `url(#clmv-glow-${this.uid})` });
      this.board.appendChild(dot);
      const t0 = performance.now();
      const frame = (t: number): void => {
        const p = Math.min(1, (t - t0) / dur);
        const pt = path.getPointAtLength((reverse ? 1 - p : p) * len);
        dot.setAttribute("cx", String(pt.x));
        dot.setAttribute("cy", String(pt.y));
        path.classList.add("hot");
        if (p < 1) requestAnimationFrame(frame);
        else {
          dot.remove();
          path.classList.remove("hot");
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }
}
