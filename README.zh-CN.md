# dsh-collab-server

给使用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的工程团队共享 AI 上下文。

一个人用 AI 得出的硬件结论、设计决策或踩坑记录，应该能被另一个人的 AI 直接用上——**按条取用**，而不是让 AI 读完一整份越来越长的 md，也不是把某个人的对话记录重放一遍。

```
成员 A 的 DSH ──team_share──▶ hub ──▶ records.jsonl
       ▲                        │
       └──简报 / team_recall────┘
```

## 为什么不直接共享文件或对话

- 一份 md 知识库会让每个 AI 每次都读全文，成本随文件增长。
- 对话记录里 90% 是死胡同、工具噪声和模型特有的推理；无法验证，还容易泄露密钥。
- 记录是原子的、可寻址的，并且带**审核状态**，接收方 AI 能区分"硬件验证过的事实"和"某个模型的猜测"。

## 一条记录包含什么

```json
{
  "id": "r_mw54ps8r",
  "project": "motor-f407",
  "kind": "fact",
  "title": "USART1 + DMA 在 500k 波特率下会丢首字节",
  "body": "现象、适用条件、规避方式、怎么验证的。",
  "scope": { "board": "F407IG", "mcu": "STM32F407", "paths": ["drivers/usart/**"] },
  "status": "verified",
  "evidence": [{ "type": "serial", "label": "10 万帧无丢帧" }],
  "author": "zhangsan",
  "tags": ["USART", "DMA"]
}
```

状态就是可信度：`draft`（AI 提议）→ `verified`（人工或硬件证据）→ `stale`（环境变了不再适用）。只有 `verified` 会进会话简报。

## AI 看到什么

- **会话开始**：最近 8 条已验证记录的简报——id、标题、一行要点、作者、适用范围，约 600–900 token，作为稳定的系统提示段。
- **按需**：`team_recall(query, kind, status)` 检索；`team_get(id)` 读全文与证据。
- **写入**：`team_share` 提交一条 200–600 字的记录（上传前自动脱敏）；`team_review` 改状态。
- **任务收尾**：宣布任务完成之前，模型自检这一轮是否得出了可复用结论，有就提交草稿。这段协议常驻系统提示；`skills/team-context/SKILL.md` 是更完整的判断清单，供会加载文件 skill 的 profile 使用。

没有"全量读取"。上下文成本只和真正用到的条数相关。

## 快速开始

### 1. 安装 DSH 插件

```powershell
dsh plugin --profile desktop add <本仓库绝对路径>\plugin
```

重启 DSH。每个实例**内嵌一个节点**：监听 `127.0.0.1:7420`，事件日志存在 DSH profile 目录里，同时服务工具和面板。不用另外起服务，也没有需要保持运行的进程。

### 2. 加入 peer（可选）

把其它机器的地址填进 `peers`：

```yaml
peers:
  - http://192.168.1.21:7420
  - http://192.168.1.22:7420
```

每个节点每 15 秒和所有 peer 双向交换一次各自缺少的事件。离线过的机器下次连上自动补齐；一台机器关机不影响别人。单机使用就留空。

### 主机 / 从机（不需要 mesh）

一台机器存总库并接受其它机器写入：

```yaml
# 主机：保存全量日志，接受入站
expose: true
peers: []

# 每台从机：主动连主机，不需要开入站端口
primary: http://192.168.1.20:7420
```

主机离线时，从机继续写本地日志，面板显示 `待同步 N`；同步循环每 15 秒重试一次，链路恢复后的第一轮就把积压送上去——不用手动重试，也不会丢。反向同理：从机离线期间主机新增的记录，会在同一轮里补下来。

### 合作区：工作区即上下文

在会话 "..." 菜单点「加入团队合作区」，插件把该会话的工作区路径绑定成一个合作区（名字默认取目录名，存在本机 `zones.json`）。之后这个目录下的所有会话自动读写该合作区：简报、检索、提交都跟着工作区走，不需要每个会话单独设置。

| 接口 | 用途 |
|---|---|
| `GET /team-api/zones?sessionId=…` | 查询某个会话的当前绑定 |
| `POST /team-api/zones` `{sessionId}` 或 `{cwd, project}` | 绑定 |
| `DELETE /team-api/zones` `{cwd}` | 解绑 |

面板的「合作区」页可以查看和解绑。绑定是**每台机器各自维护**的（存在本地节点数据目录），这样"本机缓存 + 团队共享"才能同时成立。

### 3. 可选：独立节点

常开机器、跨网段中继，或者那台机器上没有 DSH：

```powershell
$env:DSH_TEAM_TOKEN="团队口令"; $env:DSH_TEAM_PEERS="http://192.168.1.21:7420"; node hub/server.js
```

### 4. 使用

- **左栏 → 团队共享**：点一下图标就是整页面板；设置里也保留同一个入口作为兜底。
- 浏览、搜索、审核、手动新建。
- 让 AI「查一下团队里有没有类似问题」，它就会调用 `team_recall`。

### 验证

```bash
node hub/smoke.mjs
```

覆盖创建、列表、中文 bigram 检索、状态变更、简报过滤和口令校验。

## HTTP 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 存活检查、记录数 |
| GET | `/api/records?project=&q=&kind=&status=&limit=&since=` | 检索 / 增量同步 |
| POST | `/api/records` | 新建 |
| GET | `/api/records/:id` | 读一条 |
| PATCH | `/api/records/:id` | 改状态/内容，追加历史 |
| GET | `/api/brief?project=&limit=` | 仅已验证的简报 |
| GET | `/api/members?project=` | 成员统计 |
| POST | `/api/sync` | 节点间同步：交换摘要与缺失事件 |

除 `/api/health` 外都需要 `x-team-token`。浏览器面板不持有口令：插件在服务端代理 `/team-api/*`。

## 配置

Hub 环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_TEAM_PORT` | `7420` | 端口 |
| `DSH_TEAM_HOST` | `0.0.0.0` | 监听地址 |
| `DSH_TEAM_TOKEN` | `dev-token` | 共享口令，**务必更换** |
| `DSH_TEAM_DATA` | `hub/data` | 数据目录 |

插件配置：

| 键 | 默认 | 说明 |
|---|---|---|
| `hubUrl` | `http://127.0.0.1:7420` | hub 地址 |
| `token` | `dev-token` | 与 hub 一致 |
| `project` | `default` | 记录命名空间 |
| `member` | `me` | 面板显示的作者名 |
| `autoBrief` | `true` | 是否注入会话简报 |
| `briefLimit` | `8` | 简报条数 |
| `embedded` | `true` | 在 DSH 内运行节点 |
| `peerPort` | `7420` | 本地节点端口 |
| `peers` | `[]` | 其它节点，如 `http://192.168.1.21:7420` |
| `primary` | `''` | 从机填写主机地址；主机离线时本地缓存 |
| `expose` | `false` | 监听 `0.0.0.0`（主机打开） |
| `dataDir` | profile 目录 | 事件日志位置 |

## 安全

- hub 只存记录，不存原始对话。
- 上传前脱敏：私钥、API key、`password=` 赋值、常见 token 格式。
- 共享内容按**数据**注入，不按指令；只有 `verified` 会自动进入简报。
- 默认明文 HTTP，面向内网。跨网络请加 TLS 反向代理或走 VPN。
- 一个口令对应一个团队；按用户账号、按项目隔离在路线图里。

## 部署形态

| 形态 | 状态 | 说明 |
|---|---|---|
| 本机 | ✅ 默认 | 内嵌节点，`127.0.0.1`，无 peer |
| 内网 mesh | ✅ | 节点直连同步；需要端口可达、地址稳定 |
| 中继 | ✅ | 直连不通时放一台常开节点 |
| 云端/社区 | 🧭 规划 | 账号、团队隔离、Postgres、配额，见 [docs/ROADMAP.md](docs/ROADMAP.md) |

## 路线图

- `turn-stopping` 自动生成草稿记录（待审队列，不再依赖模型自觉）。
- 客户端离线队列，hub 恢复后补传。
- 从左栏一级入口进入，而不是藏在设置里。
- 取代链、环境指纹失效、嵌入式台架租约。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。设计取舍见 [docs/DESIGN.md](docs/DESIGN.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
