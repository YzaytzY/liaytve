// 解析上游 HowToLiveBetter 的 book/*.md → rules.json（App 同步协议格式）
// 用法: node build-rules.mjs <上游book目录> <输出rules.json> [上一版rules.json]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [bookDir, outPath, prevPath] = process.argv.slice(2);
if (!bookDir || !outPath) {
  console.error("usage: node build-rules.mjs <bookDir> <out.json> [prev.json]");
  process.exit(2);
}

const CHAPTER_RE = /^# (\d+)[.、]\s*(.+?)\s*$/;
const RULE_RE = /^### (\d+)[.、]\s*(.+?)\s*$/;
const FIELD_RE = /^- (成本|说人话|收益|证据等级|来源|备注)[：:]\s*/;

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function parseBook() {
  const files = fs.readdirSync(bookDir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
  const rules = [];
  for (const file of files) {
    const chapNum = parseInt(file, 10);
    const text = fs.readFileSync(path.join(bookDir, file), "utf8");
    const chapHead = text.match(CHAPTER_RE);
    const chapterTitle = clean(chapHead ? chapHead[2] : path.basename(file, ".md").slice(3));
    // 条目块 = 从某个 "### N. " 起到下一个 "### " 或文件尾；split 会吃掉 "### " 前缀
    const blocks = text.split(/^### /m).slice(1);
    for (const block of blocks) {
      // 块首形如 "12. 标题\n..."（前缀已被 split 去掉）
      const head = block.match(/^(\d+)[.、]\s*(.+?)\s*$/m);
      if (!head) continue;
      const localNumber = Number(head[1]);
      const title = clean(head[2]);
      const fields = { cost: "", plain: "", benefit: "", grade: "", source: "", note: "", tagsLine: "" };
      for (const raw of block.split("\n")) {
        const m = raw.match(FIELD_RE);
        if (!m) {
          // 成本标签注释行：<!-- 成本标签: 钱=.. 时间=.. 毅力=.. 收益=.. 口径=.. -->
          const tag = raw.match(/成本标签[:：]\s*(.+?)-->/);
          if (tag) fields.tagsLine = clean(tag[1]);
          continue;
        }
        const key = m[1];
        const val = clean(raw.slice(m[0].length));
        if (key === "成本") fields.cost = val;
        else if (key === "说人话") fields.plain = val;
        else if (key === "收益") fields.benefit = val;
        else if (key === "证据等级") fields.grade = val.slice(0, 1).toUpperCase();
        else if (key === "来源") fields.source = val;
        else if (key === "备注") fields.note = val;
      }
      if (!fields.plain) continue; // 没有说人话正文的跳过（非条目块）
      const officialId = `${chapNum}-${localNumber}`;
      const content_hash = crypto.createHash("sha256")
        .update(title + "\n" + fields.plain + "\n" + fields.benefit).digest("hex");
      rules.push({
        id: officialId,
        official_id: officialId,
        legacyId: officialId,
        chapter_number: chapNum,
        chapter: chapterTitle,
        local_number: localNumber,
        title,
        plain: fields.plain,
        cost: fields.cost,
        benefit: fields.benefit,
        grade: fields.grade || "C",
        sources: fields.source ? [fields.source] : [],
        note: fields.note,
        tags: [],
        score: 0,
        content_hash,
      });
    }
  }
  return rules;
}

const rules = parseBook();

// 防静默出垃圾：条数偏离上一版 ±5% 直接失败报警
if (prevPath && fs.existsSync(prevPath)) {
  const prev = JSON.parse(fs.readFileSync(prevPath, "utf8"));
  const prevCount = Array.isArray(prev) ? prev.length : prev.rules.length;
  const drift = Math.abs(rules.length - prevCount) / prevCount;
  if (drift > 0.05) {
    console.error(`FAIL: 条数 ${rules.length} 偏离上一版 ${prevCount} 超过 5%`);
    process.exit(1);
  }
}
if (rules.length < 1) { console.error("FAIL: 解析出 0 条"); process.exit(1); }

const commitSha = process.env.UPSTREAM_SHA || "local";
const payload = { version: { commit_sha: commitSha, generated_at: new Date().toISOString() }, rules };
fs.writeFileSync(outPath, JSON.stringify(payload));
const graded = rules.reduce((a, r) => { a[r.grade] = (a[r.grade] || 0) + 1; return a; }, {});
console.log(`rules.json: ${rules.length} 条 | 章节 ${new Set(rules.map(r=>r.chapter_number)).size} | 等级 ${JSON.stringify(graded)}`);
