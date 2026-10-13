# 产品宣传页与 GitHub Pages

`docs/` 是独立的静态宣传页，使用相对资源路径，兼容 GitHub Pages 的 `/english-printer/` 子路径。它不连接设备、不调用模型或翻译接口，也不读取本机配置和聊天记录。GitHub Pages 仅发布 `docs/` 中列入工作流白名单的首页、样式、脚本和宣传图片，不包含项目指南或文档截图；实际打印 App 仍使用[本机服务](../README.md#快速开始)或 [iOS 工程](../ios/README.md)。

本机预览（Node.js 22+、tmux，无额外依赖）：

```bash
node scripts/site-acceptance.mjs up
node scripts/site-acceptance.mjs status
```

入口为 <http://127.0.0.1:10293/english-printer/>。脚本核对端口登记、监听进程工作目录、独立 tmux 会话和 `/__site_health`，复用当前工作区健康服务。10293 属于本项目已登记端口段，不影响 10290 的实际 App；静态服务只提供同一组宣传页资源白名单。验收结束后使用 `node scripts/site-acceptance.mjs down` 停止宣传页服务。

部署工作流位于 `.github/workflows/pages.yml`，使用 [GitHub 官方 Pages Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。首次部署需在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，然后将页面和工作流推送到 `main`；本项目禁止自动 push，必须先得到用户当前任务的明确推送授权。之后宣传页资源或工作流的推送会触发部署，也可在 Actions 中手动运行 **Deploy product page**。

访问地址为 **[词签产品官网](https://czm233.github.io/english-printer/)**，仓库公开、默认分支为 `main`。每次发布以 **Deploy product page** 工作流的成功状态和实际输出的 `page_url` 为准。
