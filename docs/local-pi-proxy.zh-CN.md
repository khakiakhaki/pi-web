# 本地 PI_PROXY 代理分支使用说明

本仓库里保留一个本地分支：

```bash
local/pi-proxy
```

这个分支只做一件事：当环境变量 `PI_PROXY` 或 `pi_proxy` 存在时，让 pi-web 的模型请求走该 HTTP 代理；不设置时保持默认直连。

示例：

```bash
PI_PROXY=http://localhost:7890 pi-web --hostname 0.0.0.0 --port 8504 --no-open
```

---

## 1. 在开发目录直接测试

```bash
cd /home/akawcc/temp/pi-web
git checkout local/pi-proxy
npm install
PI_PROXY=http://localhost:7890 npm run dev -- -p 8504
```

浏览器打开：

```text
http://localhost:8504
```

如果不想走代理，去掉 `PI_PROXY=...` 即可：

```bash
npm run dev -- -p 8504
```

注意：开发模式不要运行 `next build` / `npm run build`，除非你要测试发布模式。

---

## 2. 本地编译并像发布版一样运行（不覆盖官方全局安装）

这种方式最安全，不会覆盖你已经安装的官方 `@agegr/pi-web`。

```bash
cd /home/akawcc/temp/pi-web
git checkout local/pi-proxy
npm install
npm run build
PI_PROXY=http://localhost:7890 node bin/pi-web.js --hostname 0.0.0.0 --port 8504 --no-open
```

不走代理：

```bash
node bin/pi-web.js --hostname 0.0.0.0 --port 8504 --no-open
```

---

## 3. 本地编译并安装到全局（会覆盖官方全局 pi-web）

如果执行：

```bash
cd /home/akawcc/temp/pi-web
git checkout local/pi-proxy
npm install
npm run build
npm install -g .
```

它会替换当前 Node 环境中的全局 `pi-web` 命令，因为包名和 bin 名都和官方版相同。

运行：

```bash
PI_PROXY=http://localhost:7890 pi-web --hostname 0.0.0.0 --port 8504 --no-open
```

恢复官方最新版：

```bash
npm install -g @agegr/pi-web@latest
```

---

## 4. systemd 服务写法

### 4.1 如果已经 `npm install -g .` 安装了本地版

不要再使用：

```ini
ExecStart=/home/akawcc/.config/nvm/versions/node/v22.23.1/bin/npx @agegr/pi-web@latest ...
```

因为 `npx @agegr/pi-web@latest` 会重新运行官方最新版。

改成直接运行全局 `pi-web`：

```ini
[Service]
Environment=PI_PROXY=http://localhost:7890
ExecStart=/home/akawcc/.config/nvm/versions/node/v22.23.1/bin/pi-web --hostname 0.0.0.0 --port 8504 --no-open
```

### 4.2 如果不想覆盖官方全局安装

先在仓库里编译：

```bash
cd /home/akawcc/temp/pi-web
git checkout local/pi-proxy
npm install
npm run build
```

systemd 使用本地文件：

```ini
[Service]
WorkingDirectory=/home/akawcc/temp/pi-web
Environment=PI_PROXY=http://localhost:7890
ExecStart=/home/akawcc/.config/nvm/versions/node/v22.23.1/bin/node /home/akawcc/temp/pi-web/bin/pi-web.js --hostname 0.0.0.0 --port 8504 --no-open
```

修改服务后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart <你的服务名>
sudo systemctl status <你的服务名>
```

查看日志：

```bash
journalctl -u <你的服务名> -f
```

---

## 5. 官方更新后，合并本地代理分支（无冲突流程）

目标：官方 `main` 更新后，把更新合并进 `local/pi-proxy`，继续保留 `PI_PROXY` 功能。

```bash
cd /home/akawcc/temp/pi-web

# 1. 确保当前没有未提交修改
git status

# 2. 更新官方 main
git checkout main
git pull --ff-only origin main

# 3. 回到本地代理分支
git checkout local/pi-proxy

# 4. 把最新 main 合并进来
git merge main
```

如果没有冲突，Git 会直接完成合并。然后重新安装/检查/编译：

```bash
npm install
node_modules/.bin/tsc --noEmit
npm run lint
npm run build
```

最后按第 2 或第 3 节重新运行/安装。

---

## 6. 如果你想确认代理代码还在

检查这些文件：

```bash
git branch --show-current
rg -n "PI_PROXY|pi_proxy|configurePiWebHttpProxy" lib app
```

应该能看到：

- `lib/http-proxy.ts`
- `lib/rpc-manager.ts`
- `app/api/models-config/test/route.ts`

---

## 7. 当前代理实现的行为

- 设置 `PI_PROXY` 或 `pi_proxy`：pi-web 模型请求走代理。
- 不设置：保持默认直连，不改动网络行为。
- 不再需要 `~/.config/pi-web/http-proxy-bootstrap.mjs`。
- 不读取额外 pi-web 配置文件。
