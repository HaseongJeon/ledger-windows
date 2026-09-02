/* 의존성 없는 SVG 파이 차트 — 꽉 찬 조각 + 탭 인터랙션
   숫자는 도형 위에 얹지 않는다: 합계는 카드 제목 옆으로, 비율은 조각이 충분히 클 때만
   조각 안쪽에, 정확한 금액은 아래 범례로 — 세 자리로 나눠 각자 한 가지 정보만 맡는다. */
import { won, shortWon, pct } from "./calc.js";

const R = 92, CX = 110, CY = 110;   // 파이 반지름 · 중심
const START = -Math.PI / 2;         // 12시 방향에서 시작해 시계 방향으로
const GAP_RAD = 0.022;              // 조각 사이 여백(라디안, 한쪽당)
const MIN_SWEEP = 0.02;             // 값이 아주 작아도 유지하는 최소 조각 각도
const LABEL_MIN_SWEEP = 0.7;        // 이 각도(약 40°) 이상인 조각에만 비율을 안에 적는다
const LABEL_R = R * 0.62;           // 안쪽 라벨 위치 반지름
const POP = 9;                      // 선택 시 바깥으로 밀려나는 거리(px)
const ENTER_MS = 900;               // 파이 전체가 시계방향으로 한 번에 그려지는 시간

const pt = (r, a) => ({ x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) });

function wedgePath(r, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 1e-4) {
    const mid = a0 + Math.PI;
    const p0 = pt(r, a0), pm = pt(r, mid);
    return `M ${CX} ${CY} L ${p0.x} ${p0.y} A ${r} ${r} 0 1 1 ${pm.x} ${pm.y} A ${r} ${r} 0 1 1 ${p0.x} ${p0.y} Z`;
  }
  const p0 = pt(r, a0), p1 = pt(r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${CX} ${CY} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
}

/** 조각 색 위에서 글자가 잘 보이도록 밝기에 따라 흰/잉크 중 고른다 */
function labelInk(hex) {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16) || 0, g = parseInt(n.slice(2, 4), 16) || 0, b = parseInt(n.slice(4, 6), 16) || 0;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.62 ? "#0F1417" : "#FFFFFF";
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

  const single = data.length === 1;
  let a = START;
  const segs = data.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const trueStart = a, trueEnd = a + sweep;
    a = trueEnd;
    const g = single ? 0 : Math.min(GAP_RAD, Math.max(sweep - MIN_SWEEP, 0) / 2);
    const a0 = trueStart + g, a1 = Math.max(trueEnd - g, a0 + MIN_SWEEP * 0.3);
    const mid = (a0 + a1) / 2;
    const dir = { x: Math.cos(mid), y: Math.sin(mid) };

    let label = "";
    if (!single && sweep >= LABEL_MIN_SWEEP) {
      const lp = pt(LABEL_R, mid);
      label = `<text class="pie__label" x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}"
        text-anchor="middle" dominant-baseline="middle" fill="${labelInk(d.color)}"
        style="opacity:0">${pct(d.value, total)}</text>`;
    }

    return `<g class="pie__seg" data-index="${i}" data-key="${esc(d.key)}" data-value="${d.value}"
      style="--pop-x:${(dir.x * POP).toFixed(2)}px;--pop-y:${(dir.y * POP).toFixed(2)}px;--seg-glow:${d.color}">
      <path class="pie__wedge" fill="${d.color}"
        data-a0="${a0}" data-a1="${a1}"
        style="d:path('${wedgePath(R, a0, a0 + 0.0005)}')"
      ><title>${esc(d.key)} · ${won(d.value)}원 (${pct(d.value, total)})</title></path>
      ${label}
    </g>`;
  }).join("");

  const label = opts.centerLabel || "합계";
  return `<svg class="pie__svg" viewBox="0 0 220 220" role="img" aria-label="${esc(label)} ${won(total)}원" data-total="${total}" data-label="${esc(label)}">${segs}</svg>`;
}

export function legend(slices) {
  const data = slices.filter(s => s.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return "";
  return data.map((d, i) => `
    <button class="legend__r" type="button" data-index="${i}">
      <span class="legend__d" style="background:${d.color}"></span>
      <span class="legend__k">${esc(d.key)}</span>
      <span class="legend__p">${pct(d.value, total)}</span>
      <span class="legend__v">${won(d.value)}</span>
    </button>`).join("");
}

/**
 * donut()/legend()가 innerHTML로 심어진 뒤 호출 — 등장 애니메이션을 재생하고
 * 조각↔범례 탭 연동, 카드 제목 옆 합계 ↔ 선택한 항목 전환을 붙인다.
 * @param {HTMLElement} pieEl  .pie 컨테이너 (donut() 결과가 들어있음)
 * @param {HTMLElement=} legendEl .legend 컨테이너 (legend() 결과가 들어있음, 선택)
 */
export function mountPie(pieEl, legendEl) {
  const svg = pieEl?.querySelector(".pie__svg");
  if (!svg) return;

  const segs = [...svg.querySelectorAll(".pie__seg")];
  const card = pieEl.closest(".card");
  const statK = card?.querySelector("[data-pie-stat-k]");
  const statV = card?.querySelector("[data-pie-stat-v]");
  const total = Number(svg.dataset.total || 0);
  const defaultLabel = svg.dataset.label || "합계";
  const rows = legendEl ? [...legendEl.querySelectorAll(".legend__r")] : [];
  if (legendEl) legendEl.classList.add("legend--linked");
  if (statK) statK.textContent = defaultLabel;
  if (statV) statV.textContent = shortWon(total);

  // 등장 애니메이션: 12시부터 시계방향으로 한 번에 쓸어 그린다.
  // CSS로 두 path 문자열 사이를 전환하면 좌표를 직선으로 잇는 식이라 큰 조각일수록 부채꼴이
  // 일그러져 보인다 — 매 프레임 실제 각도로 경로를 다시 계산해야 원 모양 그대로 자란다.
  const wedges = segs.map(g => ({
    g,
    path: g.querySelector(".pie__wedge"),
    label: g.querySelector(".pie__label"),
    a0: Number(g.querySelector(".pie__wedge").dataset.a0),
    a1: Number(g.querySelector(".pie__wedge").dataset.a1),
  }));
  const sweepStart = performance.now();
  (function sweepFrame(now) {
    const t = Math.min(1, (now - sweepStart) / ENTER_MS);
    const eased = 1 - (1 - t) ** 3;
    const swept = START + eased * Math.PI * 2;
    wedges.forEach(w => {
      const end = Math.min(w.a1, Math.max(w.a0, swept));
      if (end > w.a0 + 0.0005) w.path.style.d = `path('${wedgePath(R, w.a0, end)}')`;
      if (w.label && end >= w.a1 - 0.0005) w.label.style.opacity = "1";
    });
    if (t < 1) requestAnimationFrame(sweepFrame);
  })(sweepStart);

  let activeIndex = null;
  let valueRaf = null;

  function animateValue(el, from, to, ms) {
    if (valueRaf) cancelAnimationFrame(valueRaf);
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = shortWon(from + (to - from) * eased);
      valueRaf = t < 1 ? requestAnimationFrame(step) : null;
    };
    valueRaf = requestAnimationFrame(step);
  }

  function swapLabel(el, text) {
    el.style.transition = "opacity .12s ease";
    el.style.opacity = "0";
    setTimeout(() => { el.textContent = text; el.style.opacity = "1"; }, 120);
  }

  function setActive(index) {
    const prevValue = activeIndex === null ? total : Number(segs[activeIndex]?.dataset.value || 0);
    activeIndex = index;

    segs.forEach((g, i) => {
      g.classList.toggle("is-active", i === index);
      g.classList.toggle("is-dim", index !== null && i !== index);
    });
    rows.forEach((r, i) => {
      r.classList.toggle("is-active", i === index);
      r.classList.toggle("is-dim", index !== null && i !== index);
    });

    const target = index === null ? total : Number(segs[index]?.dataset.value || 0);
    const label = index === null ? defaultLabel : segs[index]?.dataset.key || defaultLabel;
    if (statK) swapLabel(statK, label);
    if (statV) animateValue(statV, prevValue, target, 300);
  }

  segs.forEach((g, i) => {
    g.addEventListener("click", () => setActive(activeIndex === i ? null : i));
  });
  rows.forEach((r, i) => {
    r.addEventListener("click", () => setActive(activeIndex === i ? null : i));
  });
  svg.addEventListener("click", e => {
    if (e.target === svg) setActive(null);
  });
}

/** 거래처 카드의 작업 구성 막대 */
export function miniBar(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return "";
  return parts.filter(p => p.value > 0)
    .map(p => `<i style="width:${(p.value / total) * 100}%;background:${p.color}"></i>`).join("");
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
