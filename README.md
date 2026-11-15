# zhPencil 的博客

个人博客，使用 [Jekyll](https://jekyllrb.com) 构建，主题为 [Windows 95](https://github.com/h01000110/windows-95)。

线上地址：<https://zhpencil.github.io>

## 目录结构

```text
.
├── _includes/       # 公共片段（顶栏导航）
├── _layouts/        # 布局：default / me / tag
├── _posts/          # 文章
├── _sass/           # SCSS 源文件
├── assets/          # CSS、JS、字体、图标
├── me/              # 关于页（/me/）
├── new/             # 临时文本框（/new/）
├── tags/            # 标签页（/tag/<name>/）
├── 404.html         # 404 页面
├── index.html       # 首页
├── robots.txt
└── _config.yml      # 站点配置
```

## 写文章

在 `_posts/` 下新建 `YYYY-MM-DD-slug.md`，例如 `2026-04-19-test.md`：

```markdown
---
layout: default
title: "文章标题"
tags: [posts, projects]
---

正文从这里开始。
```

- 文章地址为 `/年/月/日/slug/`，建议文件名使用英文或拼音。
- 标签用数组或空格分隔均可，例如 `tags: [posts, projects]`。
- 代码块会自动加上 Windows 95 风格的攀爬行号。

## 新建标签

侧边栏的每个标签都对应 `tags/` 下的一个页面。新增标签 `notes` 时，创建 `tags/notes.html`：

```html
---
layout: tag
tag: notes
permalink: /tag/notes/
---
```

然后在文章 front matter 中加上 `notes` 即可。

## 临时文本框

顶栏的 **NEW** 会打开 `/new/`：和打开文章一样在下方显示 NEW 窗口，日期取浏览器当天日期，内容区是一个普通文本框。

内容只存在当前页面，不会上传到服务器，刷新后会清空。

## 本地预览

需要 Ruby 3.x，然后安装 Jekyll：

```bash
gem install jekyll
jekyll serve --livereload
```

打开 <http://127.0.0.1:4000>。

> 仓库不附带 Gemfile，GitHub Pages 会使用平台自带的 Jekyll 3.10 构建站点。本地安装的 Jekyll 4.x 对本站而言输出基本一致。

## 部署

推送到 `master` 分支即可。GitHub Pages 会自动构建并发布，构建状态可以在仓库的 **Actions** 或 **Settings → Pages** 中查看。

## 自定义

| 想改什么 | 改哪里 |
| --- | --- |
| 站点名称、描述、网址 | `_config.yml` |
| 顶栏链接（About / GitHub / RSS） | `_includes/topbar.html` |
| 关于页内容 | `me/index.md` |
| 临时文本框 | `new/index.html` |
| 首页文章列表 | `index.html` |
| 404 文案 | `404.html` |
| 配色、字号、字体 | `_sass/_main.scss` |
| 页面结构与页脚 | `_layouts/default.html` |

## 致谢

主题作者 [h01000110 (hi)](https://github.com/h01000110)，基于 MIT License 使用，版权信息见 `LICENSE`。站点内容版权归 zhPencil 所有。