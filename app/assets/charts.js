/* 의존성 없는 SVG 도넛 차트 */
import { won, shortWon, pct } from "./calc.js";

const R = 100, HOLE = 60, CX = 110, CY = 110, GAP = 0.012;

function arc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return { x0, y0, x1, y1, large };
}

/**
 * @param {Array<{key,value,color}>} slices
 * @param {{centerLabel?:string}} opts
 */
export function donut(slices, opts = {}) {
  const data = slices.filter(s => s.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) {
    return `<p class="pie__empty">기간 안에 표시할 금액이 없습니다</p>`;
  }

  let a = -Math.PI / 2;
  const single = data.length === 1;
  const paths = data.map(d => {
    const sweep = (d.value / total) * Math.PI * 2;
    const g = single ? 0 : Math.min(GAP, sweep / 4);
    const a0 = a + g / 2, a1 = a + sweep - g / 2;
    a += sweep;
    const o = arc(CX, CY, R, a0, a1);
    const i = arc(CX, CY, HOLE, a1, a0);
    const dstr = single
      ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} L ${CX - 0.01} ${CY - HOLE} A ${HOLE} ${HOLE} 0 1 0 ${CX} ${CY - HOLE} Z`
      : `M ${o.x0} ${o.y0} A ${R} ${R} 0 ${o.large} 1 ${o.x1} ${o.y1} L ${i.x0} ${i.y0} A ${HOLE} ${HOLE} 0 ${i.large} 0 ${i.x1} ${i.y1} Z`;
    return `<path class="pie__seg" d="${dstr}" fill="${d.color}"><title>${esc(d.key)} · ${won(d.value)}원 (${pct(d.value, total)})</title></path>`;
  }).join("");

  const label = opts.centerLabel || "합계";
  return `<svg viewBox="0 0 220 220" role="img" aria-label="${esc(label)} ${won(total)}원">
    ${paths}
    <text class="pie__hole-k" x="${CX}" y="${CY - 8}" text-anchor="middle">${esc(label)}</text>
    <text class="pie__hole-v" x="${CX}" y="${CY + 16}" text-anchor="middle">${shortWon(total)}</text>
  </svg>`;
}

export function legend(slices) {
  const data = slices.filter(s => s.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return "";
  return data.map(d => `
    <div class="legend__r">
      <span class="legend__d" style="background:${d.color}"></span>
      <span class="legend__k">${esc(d.key)}</span>
      <span class="legend__p">${pct(d.value, total)}</span>
      <span class="legend__v">${won(d.value)}</span>
    </div>`).join("");
}

/** 거래처 카드의 작업 구성 막대 */
export function miniBar(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return "";
  return parts.filter(p => p.value > 0)
    .map(p => `<i style="width:${(p.value / total) * 100}%;background:${p.color}"></i>`).join("");
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
