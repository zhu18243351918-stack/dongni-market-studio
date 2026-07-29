# 全免费发布说明

## 不影响现有作品集网站

- 请新建独立仓库 `dongni-market-studio`，不要把本项目放进 `用户名.github.io` 作品集主仓库。
- 发布地址固定为 `https://用户名.github.io/dongni-market-studio/`，不会覆盖 `https://用户名.github.io/`。
- 项目不包含 `CNAME`，不会接管作品集正在使用的自定义域名。
- Pages 工作流带有保护检查：如果误放进作品集主仓库或检测到 `CNAME`，构建会直接停止。

本项目默认只使用免费服务：公开 GitHub 仓库、GitHub Pages、GitHub Releases、公开仓库 GitHub Actions、Supabase Free、Tauri。

## 1. 创建 Supabase 免费登录项目

1. 在 Supabase 创建 Free 项目，不绑定付费方式。
2. 在 **Authentication → Providers** 开启 Email。
3. 开启邮箱确认；Site URL 设置为：
   `https://你的GitHub用户名.github.io/dongni-market-studio`
4. Redirect URLs 加入：
   `https://你的GitHub用户名.github.io/dongni-market-studio/**`
5. 从 **Project Settings → API** 复制 Project URL 和公开 anon key。

Supabase 只接收邮箱、认证会话和密码验证信息；图片与工程不会上传。

## 2. 创建公开 GitHub 仓库

1. 创建公开仓库 `dongni-market-studio`。
2. 上传本项目并使用 `main` 分支。
3. 在 **Settings → Secrets and variables → Actions** 添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. 在 **Settings → Pages → Source** 选择 **GitHub Actions**。
5. 推送 `main` 后，`pages.yml` 自动部署官网与网页版。

## 3. 发布 Windows 免费安装包

创建版本标签并推送：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

`release-windows.yml` 会自动生成：

- `Dongni-Market-Studio-Setup-x64.exe`：安装版。
- `Dongni-Market-Studio-Portable-x64.exe`：便携版。

因为不购买 Windows 代码签名证书，首次运行可能显示“未知发布者”或 SmartScreen 提示。用户需要点击“更多信息 → 仍要运行”。

## 4. 免费额度规则

- 不购买域名，直接使用 `github.io`。
- 不配置付费代码签名。
- Supabase 不绑定付费方式；免费额度用尽后可能限流或暂停，不会由本项目自动扣费。
- 公开仓库的 Pages、Releases 和 Actions 按 GitHub 当前公开免费政策运行。

## 5. 本机开发预览

开发环境使用 `.env.development` 中的本地预览登录。生产构建设置 `VITE_REQUIRE_AUTH_CONFIG=true` 后，缺少Supabase配置会直接构建失败，不存在生产免登录入口。
