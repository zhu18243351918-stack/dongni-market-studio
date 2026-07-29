# 东尼菜市场 Studio

本地优先的专业图片编辑器，同一套 React/Fabric 编辑核心同时生成：

- GitHub Pages 官网与登录后的网页版。
- GitHub Releases Windows x64 安装版和便携版。

## 核心能力

- Supabase邮箱注册、邮箱验证、登录、找回密码和退出登录。
- Windows首次联网验证后允许离线使用30天。
- PNG、JPEG、WebP、TIFF、PSD和PSB导入预检，手机16MP、桌面50MP强制内存限制。
- 原图按4MB分块保存到OPFS，无法使用OPFS时回退IndexedDB；Windows版写入AppData。
- 同一原图按内容哈希去重，只保存一份；大图自动生成2048/4096px编辑预览。
- 差量撤销记录只保存对象变化、参数和资源引用，不重复保存原图。
- 多画板只渲染当前画板，手机常驻1个画板位图、桌面最多2个。
- 图片预览、TIFF编解码、滤镜、抠图和PSD解析使用Web Worker；导出时重新读取原始资源。
- 图层、文字、形状、滤镜、蒙版、抠图、美颜、液化、模板、区域批填和自动工作流。
- PNG、JPEG、WebP、TIFF、PDF、分层PSD和超大PSB导出。

## 本机启动

双击 `启动东尼菜市场.bat`，或运行：

```powershell
pnpm install
pnpm dev
```

开发模式显示登录界面并启用本机预览账号；输入有效邮箱格式和至少6位密码即可进入。生产构建不会包含该入口。

## 构建

```powershell
pnpm lint
pnpm build
pnpm tauri build
```

生产Pages和Windows构建必须提供：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_REQUIRE_AUTH_CONFIG=true`

完整免费部署步骤见 [FREE_DEPLOYMENT.md](./FREE_DEPLOYMENT.md)。

## 隐私与费用

- Supabase只处理账号认证，图片、字体和工程不上传。
- 官网使用免费`github.io`地址，Windows包通过免费GitHub Releases分发。
- 不购买代码签名证书，因此Windows首次运行可能显示“未知发布者”。
- Supabase不绑定付费方式；免费额度耗尽时服务可能暂停或限流，不自动收费。

开源依赖许可见 [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)。
