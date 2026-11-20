<p align="center">
  <img src="docs/assets/mark.svg" width="80" height="80" alt="">
</p>

<h1 align="center">自在浏览 · Zizai</h1>

<p align="center">
  鼠标一停，即见大图。<br>
  Hover over an image to see it full size.
</p>

<p align="center">
  <a href="https://jooosephlee.github.io/zizai/">官网 / Website</a> ·
  <a href="CHANGELOG.md">更新记录 / Changelog</a> ·
  <a href="LICENSE">MIT</a>
</p>

---

**中文** · [English](#english)

自在浏览是一个 Chrome / Chromium 看图插件。把鼠标停在网页图片上，就能看到原图；在微博、即刻、X 上，大图旁边还会显示这条帖子的作者和正文，不用点进帖子就能看完图和文字。

看图不需要账号，没有统计和广告，不向我们发送任何数据，代码全部开源。详见[隐私政策](PRIVACY.md)。

## 功能

- **悬停看大图**：默认直接全页打开，背景跟着图片变色；也可以在设置里改成浮窗，或按 F 随时切换。普通图片和 CSS 背景图都支持；小图标、Logo 不会弹出。找不到更大版本的小缩略图（最长边不到 600px）也不弹，放大了只会更糊。
- **视频也能看**：点一下网页上的视频，就放大带声音播放，网页上的原视频同时停下，只有一路声音。暂停时画面中间有播放标记，全页有进度条和喇叭按钮（点一下静音，移上去调音量）。X、微博、即刻的视频直接播放最清晰的版本；GIF 和实况照片（Live Photo）和图片一样悬停就看。视频站（YouTube、B 站等）用它们自己的播放器，不弹预览。
- **自动找原图**：微博、即刻、X、豆瓣、Pinterest 和常见图床会换成最高清的地址，网页在 srcset 里列出的更大版本也会用上；先放大页面已有的缩略图，原图加载好后无缝替换。原图打不开时会明确提示。
- **图文一起看**：即刻、微博、X 的正文卡片显示头像、名字、发帖时间、正文和被引用的帖子。X 长帖显示全文；微博转发链拆成一人一行，更好读。
- **多图浏览**：← / → 或滚轮切换同组图片，全页底部有缩略图条。一组图用同一个固定画框，切图时画面不跳。
- **看图背景**：深色、浅色或跟随系统。正文卡片可以放在图片右侧或下方，质感可选。
- **你决定在哪里开**：默认只在常用图片站开启。别的网站想用，打开那个网站，点工具栏上的自在浏览，打开「启用看图」；第一次 Chrome 会问你是否允许访问这个网站。
- **快捷键可改**：所有快捷键都能在设置里重新录制。中英双语界面。

默认开启的网站：微博、即刻、X、小红书、Instagram、Pinterest、豆瓣、B 站、站酷。其中微博、即刻、X 会读取网站自己的数据（原图、视频、Live Photo、全文），Instagram 读取整组图（轮播一次只画两张，也能切完整组）；其余网站按通用规则放大页面上的图片。其他网站在工具栏的设置里打开，允许访问后就能用。

## 安装

目前还没有上架应用商店，也还没有 Chrome 商店商品页，需要手动加载。仓库设置里还没打开 GitHub Pages；打开之后，官网是 https://jooosephlee.github.io/zizai/ ，隐私政策是 https://jooosephlee.github.io/zizai/privacy.html 。没有单独的联系邮箱，问题请开 [Issue](https://github.com/Jooosephlee/zizai/issues)。

1. 下载本仓库（右上角 Code → Download ZIP）并解压，或用 `git clone`。
2. 在 Chrome / Edge / Arc 等 Chromium 浏览器（版本 123 及以上）里打开 `chrome://extensions`，打开右上角的「开发者模式」。
3. 点「加载已解压的扩展程序」，选择仓库里的 `extension/` 文件夹（里面能直接看到 `manifest.json`）。
4. 刷新要看图的网页，把鼠标停在图片上。

首次安装会打开一个可以动手试的引导页，之后可以在设置里的「使用说明」重新打开。更新版本后，先在扩展管理页点重新加载，再刷新网页。

## 快捷键

| 默认键 | 动作 |
| --- | --- |
| Shift | 按住暂停预览 |
| Alt / ⌥ | 「按键触发」模式下，按住看图 |
| Alt+Z / ⌥Z | 在已允许的网站上开启或关闭看图 |
| F | 浮窗和全页互相切换 |
| ← / → | 切换同组图片；只有一个视频时快退 / 快进 5 秒 |
| 空格 | 播放 / 暂停视频 |
| M | 视频声音开关 |
| O | 新标签页打开图片 |
| Ctrl+C / ⌘C | 复制当前图片 |
| ? | 查看快捷键 |
| Esc | 关闭预览 |

复制得到的是 PNG 图片，GIF 会变成静态图。有的图床拒绝复制，这时可以按 O 打开图片再保存。

## 隐私

- 看图功能不需要账号，也没有统计。插件不把浏览记录发给开发者。显示图片时，浏览器仍会向网页给出的图床地址取图；微博长文会向微博请求一次全文。详见下面几条和[隐私政策](PRIVACY.md)。
- 插件只请求当前网页本来就提供的图片地址（可能指向这个网站用的图床）。复制图片的请求不带 Cookie。
- 即刻、微博、X 的正文卡片读取的是网页上已有的文字，以及网站自己已经请求过的帖子数据，只在当前页面的内存里临时使用，不会保存。
- 唯一的例外：在微博上用全页看一条被截断的长文时，插件会在当前网页里请求一次这条微博的全文。用的是你点「展开」时微博自己调用的同一个接口，带的也是你在微博上的登录状态。每条只请求一次，不发往别处。
- 安装时只申请默认网站（和它们的图片服务器）的访问权限，不申请「所有网站」。别的网站要等你在设置里打开它、并在 Chrome 弹出的提示里点「允许」，插件才会在那里运行；关掉后，这个网站的权限也一并交还。
- 有的图床（比如微博）只认来自自己网站的请求。复制或保存图片时，插件会给这一次请求临时带上当前网站的域名（只有域名，不含具体页面地址），和网页自己显示这张图时一样；请求结束就撤掉。这需要「修改网络请求头」权限，它只作用于插件自己发出的请求。

## 开发

不需要安装依赖，用 Node.js 自带的测试运行器：

```sh
node --test tests/*.test.cjs
bash scripts/privacy-scan.sh
```

把环境变量 `ZIZAI_CHROMIUM` 设为 Chromium 或 Chrome for Testing 的可执行文件路径，会同时跑浏览器验收测试（临时浏览器配置 + 本机测试网页）。剪贴板写入会被替换成测试接收端来检查 PNG 数据，实际粘贴到其他应用需要手动确认。

```
extension/         插件本体（直接加载这个文件夹）
  content.js         预览浮窗、全页看图、正文卡片
  site-images.js     各网站的原图地址规则
  site-posts.js      从网页读取作者和正文
  page-media.js      读取网站已请求的帖子和视频数据（即刻、微博、X、Instagram）
  popup.*            设置面板
  welcome.*          首次安装引导
  _locales/          中英文文案
tests/             自动化测试
docs/              官网（GitHub Pages，从 main 分支的 /docs 发布）
scripts/           隐私扫描
```

欢迎提 Issue 和 PR。想支持新网站的原图规则，从 `extension/site-images.js` 开始看；提交前请跑一遍测试和隐私扫描。

## 许可

[MIT](LICENSE)

---

<a id="english"></a>

[中文](#自在浏览--zizai) · **English**

Zizai is an image viewer extension for Chrome and other Chromium browsers. Rest your mouse on an image to see it full size. On Weibo, Jike and X, the post's author and text appear next to the picture, so you can read the post without opening it.

Viewing images needs no account. No data collection, no telemetry. Fully open source.

## Features

- **Hover to preview**: opens in a full-window view by default, with the background tinted by the picture; switch to a floating preview in settings, or press F any time. Works with regular images and CSS background images, and skips small icons and logos.
- **Videos too**: click a video on the page to watch it enlarged with sound. The page's own copy stops, so you only hear one. A play mark shows while paused, and the full-window view has a progress bar and a speaker button (click to mute, hover for volume). Videos on X, Weibo and Jike play the sharpest file; GIFs and Live Photos open on hover like pictures. Video sites (YouTube, Bilibili…) keep their own players.
- **Full-size images**: rewrites Weibo, Jike, X and common image CDN URLs to the largest version. The page's thumbnail shows first and is swapped for the full image once it loads. You get a clear notice if the full image fails.
- **Post text alongside**: on Jike, Weibo and X, a card shows the avatar, name, time, text and any quoted post. Long X posts show in full; Weibo repost chains are split one person per line.
- **Galleries**: browse with ← / → or the scroll wheel, with a thumbnail strip in full-window view. One fixed frame per gallery, so nothing jumps when you switch images.
- **Viewer background**: dark, light or follow the system. Put the text card beside or below the picture.
- **You choose where it runs**: on by default only on popular image sites. To use it elsewhere, open the site, click Zizai in the toolbar and turn it on; the first time, Chrome asks whether to allow access to that site.
- **Custom shortcuts**: re-record any shortcut in settings. Chinese and English interface.

## Install

Zizai isn't in the Chrome Web Store yet, and there is no store listing page, so load it manually. GitHub Pages is not turned on in the repository settings yet. Once it is, the site is https://jooosephlee.github.io/zizai/ and the privacy policy is https://jooosephlee.github.io/zizai/privacy.html . There is no contact email; open an [issue](https://github.com/Jooosephlee/zizai/issues).

1. Download this repository (Code → Download ZIP) and unzip it, or `git clone` it.
2. In a Chromium browser (Chrome, Edge, Arc… version 123 or later), open `chrome://extensions` and turn on Developer mode.
3. Click "Load unpacked" and choose the `extension/` folder (the one containing `manifest.json`).
4. Reload a page and rest your mouse on an image.

An interactive guide opens on first install; reopen it from "User guide" in settings. After updating, reload the extension on the extensions page, then reload your pages.

## Shortcuts

| Default | Action |
| --- | --- |
| Shift | Hold to pause previews |
| Alt / ⌥ | Hold to show images (in "Hold a key" mode) |
| Alt+Z / ⌥Z | Turn previews on or off on a site you've allowed |
| F | Switch between floating and full-window view |
| ← / → | Previous / next image in the gallery; on a single video, skip 5 seconds |
| Space | Play / pause a video |
| M | Video sound on / off |
| O | Open the image in a new tab |
| Ctrl+C / ⌘C | Copy the current image |
| ? | Show shortcuts |
| Esc | Close the preview |

Copy puts a PNG on the clipboard; GIFs become still images. If an image host blocks copying, press O to open the image instead.

## Privacy

- Viewing images needs no account and has no analytics or ads. Browsing is not reported to the developer. Showing a picture still makes the browser request the image address the page already gave, and a long Weibo post asks Weibo for the full text. See the [privacy policy](PRIVACY.md).
- It only requests image URLs the current page already provides, which may point to the site's image CDN. Copy requests omit cookies.
- Post cards on Jike, Weibo and X use text already on the page and post data the site itself already requested. It is held in page memory only, never stored, and never fetched separately.
- At install it only asks for the built-in sites (and their image servers), not all sites. Anywhere else it runs only after you turn the site on in settings and click Allow in Chrome's prompt; turning it off gives that access back.

## Development

No dependencies. Uses Node's built-in test runner:

```sh
node --test tests/*.test.cjs
bash scripts/privacy-scan.sh
```

Set `ZIZAI_CHROMIUM` to a Chromium or Chrome for Testing executable to also run the browser acceptance tests (temporary profile and local fixture page). Clipboard writes go to a test receiver that checks the PNG bytes; pasting into other apps needs a manual check.

Issues and pull requests are welcome. To add full-size image rules for a new site, start with `extension/site-images.js`. Please run the tests and the privacy scan before submitting.

## License

[MIT](LICENSE)
