# 每日一条 · 内容分发模块

把上游 HowToLiveBetter 的 markdown，每周自动转成 App 同步协议要的 `rules.json` + `embeddings.json`，发布到 GitHub Pages。

## 这套东西解决什么

App 的每周同步之前一直失败，原因是 `DEFAULT_URL` 指向的 `rules.json` 从来没人生成。这个模块就是那个「源头」：解析 + 向量化 + 发布，全部自动化，服务器成本 0 元（GitHub Actions + Pages 免费额度）。

## 文件

- `build-rules.mjs` —— 解析 `book/*.md` → `rules.json`。带防呆：条数偏离上一版 ±5% 直接 fail。
- `build-embeddings.mjs` —— `rules.json` → `embeddings.json`。带 `content_hash` 缓存：只重嵌新增/修订的条目，每周增量几乎秒级。
- `rebuild.yml` —— GitHub Actions 工作流，每周一凌晨跑一次。

## 接入步骤（一次性，约 10 分钟）

1. 在你名下建一个仓库（或用现有的 `cdyforever/how-to-live-better`），把 `publisher/` 下的三个文件拷进去，`rebuild.yml` 放到 `.github/workflows/`。
2. 仓库 **Settings → Pages → Source 选 GitHub Actions**（不是 Deploy from branch）。
3. 手动触发一次工作流（Actions → rebuild → Run workflow），确认它产出 `rules.json`、`embeddings.json` 并部署成功。
4. 打开 `https://<你的用户名>.github.io/<仓库名>/rules.json`，能看到 JSON 就说明源头通了。
5. 把 App 的 `content-sync.js` 里 `DEFAULT_URL` 改成上面这个 `rules.json` 地址（或保持不变，如果仓库路径正好一致），发新版。

## 同步怎么工作的

- App 每周启动拉一次 `rules.json`。`version.commit_sha` 变了就更新本地内容库。
- 拉到 rules 的同时，顺带拉同目录的 `embeddings.json`。向量库更新后，语义搜索自动覆盖新增/修订条目。
- 任一文件拉取失败都不影响另一个：rules 更新成功但向量失败，新条目暂无向量（回退关键词搜索），下次同步再补。

## 验证过的

- 解析器：上游 772 条、34 章，与 App 内置 ID 集合完全一致（双向 diff 为空）。
- 增量向量：改 1 条 → 复用 771 + 新嵌 1 = 772 条、512 维，结构对齐 App。
- 防呆：条数 ±5% 漂移会 fail，防静默出垃圾数据。
- 首跑全量：772 条全嵌约 20 秒（本地模型），CI 免费额度绰绰有余。
- 两轮端到端演练：首跑全嵌 → 二跑全复用（0 新嵌），产物 rules.json / embeddings.json / cache.json 齐全，ID 双向对齐。

## 我没法替你做的（需要你的 GitHub 账号）

本机没有 GitHub 凭据（gh 未登录、无 ssh key、无 credential helper），所以下面三步得你自己来：

1. 把本模块 push 到 `cdyforever/how-to-live-better`（`rebuild.yml` 放进 `.github/workflows/`）。
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
3. Actions → rebuild-content → Run workflow 手动跑一次，确认 Pages 上出现 `rules.json`。

跑通后 App 的同步地址（`content-sync.js` 的 `DEFAULT_URL`）就和 `rebuild.yml` 的 `SITE_BASE` 指向同一处，无需再改，每周自动同步内容 + 向量。
