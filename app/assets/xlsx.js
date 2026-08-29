/* 엑셀 내보내기 — SheetJS 로 .xlsx, 실패하면 Excel 이 바로 여는 CSV 로 대체 */

let XLSXP = null;
function lib() {
  if (!XLSXP) XLSXP = import("https://esm.sh/xlsx@0.18.5");
  return XLSXP;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const stamp = () => new Date().toLocaleDateString("sv-SE").replace(/-/g, "");

/**
 * @param {string} base           파일 이름 (확장자 제외)
 * @param {Array<{name:string, aoa:any[][], widths?:number[]}>} sheets
 * @returns {Promise<"xlsx"|"csv">}
 */
export async function exportSheets(base, sheets) {
  const filename = `${base}_${stamp()}`;
  try {
    const XLSX = await lib();
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.aoa);
      if (s.widths) ws["!cols"] = s.widths.map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    download(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename + ".xlsx");
    return "xlsx";
  } catch {
    const cell = v => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = sheets.map(s =>
      `[${s.name}]\n` + s.aoa.map(r => r.map(cell).join(",")).join("\n")
    ).join("\n\n");
    download(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }), filename + ".csv");
    return "csv";
  }
}
