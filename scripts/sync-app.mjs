/* ../ledger 저장소의 웹 앱 파일을 app/ 로 가져옵니다.
   전표철 본체(../ledger)를 고친 뒤 Windows 앱에도 반영하려면
   `npm run sync` 를 실행하고 결과를 커밋하세요. */
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SOURCE = path.resolve("../ledger");
const OUT = "app";
const FILES = ["index.html", "config.js", "manifest.json", "assets"];

if (!existsSync(SOURCE)) {
  console.error(`전표철 원본을 찾을 수 없습니다: ${SOURCE}`);
  console.error("ledger-windows 와 ledger 저장소가 같은 폴더 아래(형제 폴더)에 있어야 합니다.");
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const f of FILES) {
  const src = path.join(SOURCE, f);
  if (!existsSync(src)) {
    console.warn(`  건너뜀 (없음): ${f}`);
    continue;
  }
  await cp(src, path.join(OUT, f), { recursive: true });
  console.log(`  ${f}`);
}

console.log(`\n${OUT}/ 준비 완료 — 변경 사항을 git commit 하세요.`);
