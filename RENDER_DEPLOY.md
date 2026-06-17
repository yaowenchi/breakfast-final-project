# Render 部署方式

這個專案不需要 Docker。Render 直接連 GitHub repo 即可。

## Render 設定

建立 Web Service 時選這個 GitHub repo，設定：

```bash
Build Command: bun install && bun run build
Start Command: bun run start:render
Health Check Path: /health
```

Render 會自動提供 `PORT`，專案已設定 `HOST=0.0.0.0` 以便 Render 對外連線。

## 必填環境變數

在 Render 的 Environment 填入：

```env
STORE_DRIVER=postgres
HOST=0.0.0.0
NODE_ENV=production
DATABASE_URL=你的 Neon pooled connection string
DATABASE_URL_MIGRATION=你的 Neon direct connection string
BETTER_AUTH_URL=https://你的-render網址.onrender.com
BETTER_AUTH_SECRET=一串隨機長字串
BETTER_AUTH_TRUSTED_ORIGINS=https://你的-render網址.onrender.com
BOSS_EMAIL=你的 boss 登入 email
BOSS_PASSWORD=你的 boss 登入密碼
BOSS_NAME=Boss
```

如果要啟用 Google 登入，再加：

```env
GOOGLE_CLIENT_ID=你的 Google client id
GOOGLE_CLIENT_SECRET=你的 Google client secret
```

Google Console 的 redirect URI 要加入：

```text
https://你的-render網址.onrender.com/api/auth/callback/google
```

## 使用方式

部署成功後，Render 會給一個公開網址，例如：

```text
https://breakfast-ordering-system.onrender.com
```

Apple、Android、Windows 都直接開這個網址即可點餐。你的本機終端機不需要開著。
