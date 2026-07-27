// AgentLoopView: the AI-track "agent loop" scene - the capstone picture where the
// pieces met one at a time (the model, its context, memory, tools) are assembled
// and wrapped in a loop. It renders the `agentLoop` field of the current step: it
// lights nodes, a loop stage, memory rows and tool chips, fills the context box,
// shows the model's current thought, and animates packets along the wires on a
// forward step. Colours and structure reuse the course's own look (dark-green
// board, amber for the active element, teal/blue accents already in the palette).

import type { AgentLoopScene, AgentLoopNodeId } from "../core/agent-loop-model.js";
import { agentLoopActiveSet, DEFAULT_LOOP_TOOLS, DEFAULT_LOOP_MEMORIES } from "../core/agent-loop-model.js";
import type { ResolvedModel } from "../core/memory-model.js";
import type { Panel, SyncCtx } from "./panel.js";
import { svgEl } from "./svg.js";

const NODES: AgentLoopNodeId[] = ["env", "ctx", "llm", "tools", "mem"];
const SVG_NS = "http://www.w3.org/2000/svg";

// Geometry for the tool and memory boxes, so the view can lay their rows out from
// data instead of hardcoding each one. Heights are derived from the row count, so
// the boxes stay identical at three rows and still fit if the taxonomy grows.
const TOOL_BOX = { x: 812, y: 86, w: 150, rowX: 826, rowY: 122, rowW: 122, rowH: 24, step: 28 };
const MEM_BOX = { x: 812, y: 238, w: 150, rowX: 826, rowY: 274, rowW: 122, rowH: 34, step: 38 };
const toolsHeight = TOOL_BOX.rowY - TOOL_BOX.y + (DEFAULT_LOOP_TOOLS.length - 1) * TOOL_BOX.step + TOOL_BOX.rowH + 4;
const memHeight = MEM_BOX.rowY - MEM_BOX.y + (DEFAULT_LOOP_MEMORIES.length - 1) * MEM_BOX.step + MEM_BOX.rowH + 18;

export class AgentLoopView implements Panel {
  readonly el: HTMLElement;
  private readonly svg: SVGSVGElement;
  private scene: AgentLoopScene = {};

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-al";
    this.el.innerHTML = this.markup();
    this.svg = this.el.querySelector("svg") as unknown as SVGSVGElement;
  }

  sync(ctx: SyncCtx): void {
    const scene = ctx.model.agentLoop ?? {};
    this.scene = scene;
    // With no `active` list the whole picture shows neutral (intro/recap); with a
    // list, the named nodes light up (amber) and the rest dim.
    const hasActive = Array.isArray(scene.active);
    const active = agentLoopActiveSet(scene);
    NODES.forEach((id) => {
      const el = this.node(id);
      if (!el) return;
      const on = active.has(id);
      el.classList.toggle("hl", hasActive && on);
      el.classList.toggle("dim", hasActive && !on);
    });
    this.svg.querySelectorAll(".stage").forEach((s) =>
      s.classList.toggle("on", s.getAttribute("data-stage") === (scene.stage ?? null)),
    );
    this.svg.querySelectorAll(".memrow").forEach((m) =>
      m.classList.toggle("on", m.getAttribute("data-mem") === (scene.mem ?? null)),
    );
    const chips: string[] = scene.chips ?? [];
    this.svg.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("on", chips.includes(c.getAttribute("data-chip") ?? "")),
    );
    this.setCtxChips(scene.ctx ?? []);
    (this.svg.querySelector("[data-think]") as SVGTextElement).textContent = scene.think ?? "";
    (this.svg.querySelector("[data-goal]") as SVGTextElement).textContent =
      "GOAL: " + (scene.goal ?? "book a flight");
    // Draw the active wires as a steady glow (packets add motion on forward steps).
    const hot = new Set((scene.packets ?? []).map((p) => p.path));
    this.svg.querySelectorAll("[data-trace]").forEach((t) =>
      t.classList.toggle("hot", hot.has(t.getAttribute("data-trace") ?? "")),
    );
  }

  animate(model: ResolvedModel): Promise<void> {
    const scene = model.agentLoop ?? this.scene;
    (scene.packets ?? []).forEach((p) => this.sendPacket(p.path, p.reverse));
    return Promise.resolve();
  }

  private node(id: string): SVGGElement | null {
    return this.svg.querySelector(`[data-node="${id}"]`);
  }

  private setCtxChips(items: string[]): void {
    const host = this.svg.querySelector("[data-ctxchips]") as SVGGElement;
    host.textContent = "";
    items.forEach((t, n) => {
      const x = 350 + n * 172;
      const g = svgEl("g", {});
      g.appendChild(svgEl("rect", { class: "ctxchip", x, y: 148, width: 160, height: 24, rx: 5 }));
      const tx = svgEl("text", { class: "ctxchip-t", x: x + 9, y: 165 });
      tx.textContent = t;
      g.appendChild(tx);
      host.appendChild(g);
    });
  }

  private sendPacket(trace: string, reverse?: boolean): void {
    const path = this.svg.querySelector(`[data-trace="${trace}"]`) as SVGPathElement | null;
    if (!path || typeof path.getTotalLength !== "function") return;
    const len = path.getTotalLength();
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("r", "6");
    dot.setAttribute("class", "cl-al-packet");
    this.svg.appendChild(dot);
    const dur = 780;
    const t0 = performance.now();
    const frame = (t: number): void => {
      const p = Math.min(1, (t - t0) / dur);
      const pt = path.getPointAtLength((reverse ? 1 - p : p) * len);
      dot.setAttribute("cx", String(pt.x));
      dot.setAttribute("cy", String(pt.y));
      if (p < 1) requestAnimationFrame(frame);
      else dot.remove();
    };
    requestAnimationFrame(frame);
  }

  private toolsMarkup(): string {
    const cx = TOOL_BOX.x + TOOL_BOX.w / 2;
    return DEFAULT_LOOP_TOOLS.map((tool, i) => {
      const y = TOOL_BOX.rowY + i * TOOL_BOX.step;
      return (
        `<rect class="chip" data-chip="${tool.id}" x="${TOOL_BOX.rowX}" y="${y}" width="${TOOL_BOX.rowW}" height="${TOOL_BOX.rowH}" rx="5" />` +
        `<text x="${cx}" y="${y + 17}" text-anchor="middle" class="chip-t" font-size="11">${tool.label}</text>`
      );
    }).join("");
  }

  private memoriesMarkup(): string {
    const tx = MEM_BOX.rowX + 10;
    return DEFAULT_LOOP_MEMORIES.map((row, i) => {
      const y = MEM_BOX.rowY + i * MEM_BOX.step;
      return (
        `<g class="memrow" data-mem="${row.id}">` +
        `<rect x="${MEM_BOX.rowX}" y="${y}" width="${MEM_BOX.rowW}" height="${MEM_BOX.rowH}" rx="6" />` +
        `<text x="${tx}" y="${y + 16}" class="mem-t" font-size="10" font-weight="700">${row.label}</text>` +
        `<text x="${tx}" y="${y + 29}" class="mem-s" font-size="9">${row.sub}</text>` +
        `</g>`
      );
    }).join("");
  }

  private markup(): string {
    return `
      <svg class="cl-al-svg" viewBox="0 0 1000 470" role="img" aria-label="An agent: model, context, tools and memory in a loop">
        <defs>
          <linearGradient id="cl-al-pcb" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0f3b33" /><stop offset="1" stop-color="#0a2a25" />
          </linearGradient>
          <filter id="cl-al-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <pattern id="cl-al-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="#12463c" />
          </pattern>
        </defs>

        <rect x="6" y="6" width="988" height="458" rx="16" fill="url(#cl-al-pcb)" stroke="#123f36" stroke-width="2" />
        <rect x="6" y="6" width="988" height="458" rx="16" fill="url(#cl-al-dots)" opacity="0.6" />

        <path data-trace="trPercept" class="trace" d="M 232 210 C 280 210, 300 165, 338 165" />
        <path data-trace="trReason"  class="trace" d="M 520 210 L 520 250" />
        <path data-trace="trRecall"  class="trace" d="M 812 300 C 700 300, 640 300, 604 292" />
        <path data-trace="trAct"     class="trace" d="M 604 262 C 700 250, 740 175, 812 165" />
        <path data-trace="trObserve" class="trace" d="M 812 150 C 720 120, 640 150, 700 158" />

        <g class="node" data-node="env">
          <rect class="node-body" x="40" y="150" width="192" height="180" rx="12" />
          <text x="136" y="180" text-anchor="middle" class="silk" font-size="15" font-weight="700">ENVIRONMENT</text>
          <text x="136" y="200" text-anchor="middle" class="silk-dim" font-size="11">the task \u00b7 the world</text>
          <rect class="goal" x="56" y="220" width="160" height="34" rx="7" />
          <text data-goal x="136" y="242" text-anchor="middle" class="goal-t" font-size="11">GOAL: book a flight</text>
          <text x="136" y="286" text-anchor="middle" class="silk-dim" font-size="10">percepts out \u00b7 actions in</text>
        </g>

        <rect class="agent-shell" x="300" y="70" width="430" height="320" rx="16" />
        <text x="316" y="92" class="silk-dim" font-size="12" font-weight="700" letter-spacing="1">AGENT</text>

        <g class="node" data-node="ctx">
          <rect class="node-body" x="338" y="112" width="356" height="70" rx="10" />
          <text x="350" y="132" class="silk-dim" font-size="11" font-weight="700">CONTEXT \u00b7 WORKING MEMORY</text>
          <g data-ctxchips></g>
        </g>

        <g class="node llm" data-node="llm">
          <rect class="node-body" x="430" y="250" width="180" height="96" rx="12" />
          <text x="520" y="288" text-anchor="middle" class="silk" font-size="18" font-weight="700">LLM</text>
          <text x="520" y="310" text-anchor="middle" class="silk-dim" font-size="11">reasoning engine</text>
          <text data-think x="520" y="330" text-anchor="middle" class="think" font-size="10"></text>
        </g>

        <g class="node" data-node="tools">
          <rect class="node-body" x="${TOOL_BOX.x}" y="${TOOL_BOX.y}" width="${TOOL_BOX.w}" height="${toolsHeight}" rx="12" />
          <text x="887" y="110" text-anchor="middle" class="silk" font-size="14" font-weight="700">TOOLS</text>
          ${this.toolsMarkup()}
        </g>

        <g class="node" data-node="mem">
          <rect class="node-body" x="${MEM_BOX.x}" y="${MEM_BOX.y}" width="${MEM_BOX.w}" height="${memHeight}" rx="12" />
          <text x="887" y="262" text-anchor="middle" class="silk" font-size="14" font-weight="700">MEMORY</text>
          ${this.memoriesMarkup()}
        </g>

        <g class="stage" data-stage="perceive">
          <rect x="316" y="410" width="96" height="34" rx="8" />
          <text x="364" y="431" text-anchor="middle" font-size="12">Perceive</text>
        </g>
        <text x="418" y="431" class="arrow" font-size="14">&#8594;</text>
        <g class="stage" data-stage="reason">
          <rect x="436" y="410" width="96" height="34" rx="8" />
          <text x="484" y="431" text-anchor="middle" font-size="12">Reason</text>
        </g>
        <text x="538" y="431" class="arrow" font-size="14">&#8594;</text>
        <g class="stage" data-stage="act">
          <rect x="556" y="410" width="96" height="34" rx="8" />
          <text x="604" y="431" text-anchor="middle" font-size="12">Act</text>
        </g>
        <text x="658" y="431" class="arrow" font-size="14">&#8594;</text>
        <g class="stage" data-stage="observe">
          <rect x="676" y="410" width="96" height="34" rx="8" />
          <text x="724" y="431" text-anchor="middle" font-size="12">Observe</text>
        </g>
        <text x="784" y="431" class="arrow" font-size="16">&#8635;</text>
      </svg>`;
  }
}
