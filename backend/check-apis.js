import { readFile } from "node:fs/promises";

const envText = await readFile(new URL("./.env", import.meta.url), "utf8");
const env = {};
for (const rawLine of envText.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 1) continue;
  const name = line.slice(0, i).trim();
  let value = line.slice(i + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[name] = value;
}

let serviceKey = env.DATA_GO_KR_SERVICE_KEY;
if (!serviceKey) {
  console.error("DATA_GO_KR_SERVICE_KEY가 비어 있어 호출할 수 없습니다.");
  process.exit(2);
}
try { serviceKey = decodeURIComponent(serviceKey); } catch {}

function endpoint(base, path) {
  return new URL(base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, ""));
}
function findValue(value, names) {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (names.includes(key)) return child;
    }
    for (const child of Object.values(value)) {
      const found = findValue(child, names);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
function itemCount(value) {
  const item = findValue(value, ["item", "items", "storeList", "data"]);
  if (Array.isArray(item)) return item.length;
  if (item && typeof item === "object") return 1;
  return undefined;
}
async function check(name, url, params) {
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("serviceKey", serviceKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch {}
    const code = body ? findValue(body, ["resultCode", "result_code", "code"]) : undefined;
    const message = body ? findValue(body, ["resultMsg", "result_msg", "message"]) : undefined;
    const count = body ? itemCount(body) : undefined;
    const passed = response.ok && (code === undefined || ["00", "INFO-000", "200"].includes(String(code)));
    console.log(name + ": " + (passed ? "응답 확인" : "실패") + " | HTTP " + response.status + " | API 코드 " + (code ?? "확인 불가") + " | 항목 " + (count ?? "확인 불가") + (message ? " | " + String(message).slice(0, 100) : ""));
    if (!body) console.log(name + ": JSON 응답이 아니거나 응답 본문을 해석하지 못했습니다.");
    return passed;
  } catch (error) {
    console.log(name + ": 호출 실패 | " + error.name + ": " + error.message);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const checks = [];
checks.push(await check(
  "부산 상권 변화지표",
  endpoint(env.BUSAN_CHANGE_API_BASE_URL, env.BUSAN_CHANGE_API_PATH),
  { pageNo: "1", numOfRows: "1", resultType: "json" }
));
checks.push(await check(
  "부산 상권 점포이력",
  endpoint(env.BUSAN_STORE_HISTORY_API_BASE_URL, env.BUSAN_STORE_HISTORY_API_PATH),
  { pageNo: "1", numOfRows: "1", resultType: "json" }
));
checks.push(await check(
  "소상공인 반경 내 점포",
  endpoint(env.SEMAS_API_BASE_URL, env.SEMAS_STORES_BY_RADIUS_PATH),
  { pageNo: "1", numOfRows: "1", radius: "500", cx: "129.0756", cy: "35.1796", type: "json" }
));
if (checks.some((ok) => !ok)) process.exitCode = 1;
