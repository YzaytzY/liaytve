// rules.json → embeddings.json，带 content_hash 缓存：只重新嵌入新增/修订的条目
// 用法: node build-embeddings.mjs <rules.json> <输出embeddings.json> [上一版embeddings.json]
import fs from "node:fs";

const [rulesPath, outPath, prevPath] = process.argv.slice(2);
if (!rulesPath || !outPath) {
  console.error("usage: node build-embeddings.mjs <rules.json> <out.json> [prev-embeddings.json]");
  process.exit(2);
}

const rulesPayload = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
const rules = rulesPayload.rules;

function embedText(r) {
  const benefit = (r.benefit || "").slice(0, 400);
  return `${r.title}。${r.plain}。${benefit}`;
}

// 上一版缓存：content_hash → 向量。条目没改就复用，省 CI 时间
const cache = new Map();
if (prevPath && fs.existsSync(prevPath)) {
  const prev = JSON.parse(fs.readFileSync(prevPath, "utf8"));
  const byId = new Map(prev.items.map((it) => [it.id, it]));
  for (const r of rules) {
    const hit = byId.get(r.id);
    if (hit && hit.content_hash === r.content_hash && Array.isArray(hit.q)) {
      cache.set(r.id, hit.q);
    }
  }
}

const DIM = 512;
const SCALE = 1 / 127;
const MODEL = "Xenova/bge-small-zh-v1.5";
const QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";

const items = [];
let embedded = 0;
let extractor = null;

for (const r of rules) {
  if (cache.has(r.id)) {
    items.push({ id: r.id, content_hash: r.content_hash, q: cache.get(r.id) });
    continue;
  }
  if (!extractor) {
    // 首次需要嵌入时才加载模型（CI 首次全量、之后增量极少）
    const { pipeline, env } = await import("@huggingface/transformers");
    const localDir = process.env.LOCAL_MODEL_DIR; // 可选：指向含 Xenova/<model> 的目录
    if (localDir) {
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = localDir;
      extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
    } else {
      // CI：首次从 HF 下载后缓存到 .tfcache，后续增量直接命中缓存
      env.cacheDir = process.env.TRANSFORMERS_CACHE || ".tfcache";
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
    }
  }
  const out = await extractor(QUERY_PREFIX + embedText(r), { pooling: "mean", normalize: true });
  const vec = out.tolist()[0];
  if (vec.length !== DIM) throw new Error(`dim mismatch: ${vec.length}`);
  items.push({
    id: r.id,
    content_hash: r.content_hash,
    q: vec.map((v) => Math.max(-127, Math.min(127, Math.round(v / SCALE)))),
  });
  embedded++;
  if (embedded % 50 === 0) console.log(`  embedded ${embedded}...`);
}

// 与 App 的 embeddings.json 结构对齐（App 端按 items[i].id 匹配，q 为 int8）
const payload = {
  model: MODEL,
  dim: DIM,
  scale: SCALE,
  version: Date.now(),
  items: items.map(({ id, q }) => ({ id, q })), // App 只认 id+q；content_hash 仅构建期缓存用
};
fs.writeFileSync(outPath, JSON.stringify(payload));
console.log(`embeddings.json: ${items.length} 条 | 复用 ${items.length - embedded} | 新嵌 ${embedded}`);

// 构建期缓存（含 content_hash），下次增量用；不发布
fs.writeFileSync(outPath + ".cache", JSON.stringify({ model: MODEL, dim: DIM, scale: SCALE, version: payload.version, items }));
