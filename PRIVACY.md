# 隐私政策 · Privacy Policy

生效日期：2026 年 11 月 20 日 · Effective 20 November 2026

[中文](#中文) · [English](#english)

## 中文

自在浏览（Zizai）是一个浏览器插件，只在你的浏览器里工作。开发者没有服务器，收不到你看了什么。

### 插件在你的浏览器里处理什么

只在你开启了看图的网站上，为了放大图片、显示帖子：

- **鼠标位置和点击**：判断你停在哪张图上、点了哪个按钮。
- **页面上的图片、视频地址，帖子的正文、作者名和头像**：从网页本身读取；在微博、即刻、X、Instagram 上，也从网页自己已经收到的数据里读取。帖子缓存只保留带图片或视频的帖子。读取这些已经收到的数据时，会按网址路径和接口名称跳过能对上的私信、通知、账号、设置、支付相关请求；当前页路径也对得上时，不再把新的响应写进缓存。这是一份名称名单，不是「私密页面整页不读取」：看图仍会读取页面上的图片来放大，名单对不上的地址不在跳过范围内，已经留在内存里的内容也不会因为后来打开这类页面就自动清掉。
- **当前标签页的网址**：你打开工具栏上的设置时，用来显示和切换这个网站。

这些内容只放在当前页面的内存里，用来显示预览。关掉看图或关掉这个网站的开关，当前页面立刻停止读取并清掉已读的内容，之后才到的数据也会丢弃；重新打开后，从下一次打开页面起才恢复。关掉页面，内容也随之消失。插件不把这些内容写进自己的硬盘存储，也不发给开发者。显示图片、视频时，浏览器仍会按下一节所说，向网站或图床请求文件。

### 会发出哪些网络请求

- 显示大图、视频、头像时，浏览器会按网页给出的地址（https 或 http）向图片所在的网站或它的图片服务器请求这些文件，和你自己点开时一样。对方会按惯例看到你的 IP 地址和请求的文件地址。
- 在微博上看长帖时，插件会向微博请求这条帖子的全文，带着你在微博的登录状态，和你点「展开」一样。
- 复制或保存图片时，插件下载这张图片，不带 Cookie。若主机名落在一份固定的本机或局域网字面名单里（localhost，以 .local、.localhost、.internal、.lan、.home.arpa 结尾，以及 0.、10.、127.、169.254.、192.168.、172.16–31.、::1、fc00::/7、fe80::），并且和当前网页不是同一主机，这次下载会拒绝；跳转之后的主机名也按同一名单看。这不是「绝不请求私网」：普通域名即使指向内网也不会被拦住，当前网页自己就开在那台主机上时，同一主机的图片仍会下载。有的图床只接受来自自己网站的请求，插件会在这次下载期间，对发往这个图片服务器（同一域名）的请求临时附上当前网站的域名（不含具体页面地址）。下载一次只进行一张，结束后先确认撤掉再开始下一张；撤不掉就不再下载。

插件不读取、不导出你的 Cookie 或登录信息。

### 保存在你电脑上的

- 设置（开关、启用的网站名单、快捷键、看图方式、视频音量）存在浏览器的扩展存储里，只在这台电脑上，卸载插件时一并删除。
- 你主动保存的图片在你的下载文件夹里，复制的内容在系统剪贴板里，由你自己管理。

### 不做的事

没有账号，没有统计，没有广告。不出售数据，也不把数据用在看图以外的地方。

本插件对用户数据的使用符合 Chrome 应用商店用户数据政策中的 Limited Use 要求：这些数据只用于在你开启的网站上放大图片和显示帖子；不出售；不用于广告、信用评估或放贷；开发者不接收这些数据。为显示图片而向图床请求文件，以及为显示微博长文而向微博请求全文，是这个用途所必需的。政策原文：https://developer.chrome.com/docs/webstore/program-policies/limited-use

### 网站权限

安装时只申请默认网站和它们图片服务器的访问权限。其他网站要等你在设置里打开它，并在 Chrome 的提示里点「允许」，插件才会在那里运行；你关掉这个网站时，权限一并交还。默认网站的权限是安装时授予的，关掉开关后插件在那里不再运行，但权限要卸载插件才会收回。

### 联系与变更

有问题或建议，请在 GitHub 提交：https://github.com/Jooosephlee/zizai/issues 。政策有变化时会更新这一页，并写明新的生效日期。插件的代码全部公开，任何人都可以检查。没有单独的联系邮箱。

## English

Zizai is a browser extension that works only inside your browser. The developer has no server and never learns what you look at.

### What the extension handles in your browser

Only on sites where you have turned previews on, to enlarge pictures and show posts:

- **Mouse position and clicks**: to tell which picture you are resting on and which button you pressed.
- **Picture and video addresses, and a post's text, author name and avatar**: read from the page itself and, on Weibo, Jike, X and Instagram, from data the page has already received. The post cache keeps only posts with pictures or videos. When reading data the page has already received, requests whose address or query name matches messages, notifications, account, settings or payments are skipped, and a matching page path stops new responses from being cached. That is a name list, not a promise that a private page is never read: previews still read pictures on the page in order to enlarge them, addresses that do not match the list are outside it, and anything already in memory is not cleared just because a matching page opens later.
- **The current tab's address**: when you open the toolbar settings, to show and switch previews for that site.

This stays in the current page's memory to show the preview. Turning previews off, or turning the site off, stops the reading on the current page at once and clears what was read; data arriving later is dropped. Turning it back on takes effect from the next page load. Closing the page clears it too. The extension does not write this into its own disk storage and does not send it to the developer. Showing a picture or video still makes the browser request the file from the site or its image host, as the next section describes.

### Network requests it makes

- To show pictures, videos and avatars, your browser requests those files (over https or http, as the page gives them) from the site or its image servers, just as when you open them yourself. Those servers see your IP address and the file address, as usual.
- For a long post on Weibo, the extension asks Weibo for the post's full text, with your Weibo session, just as clicking "展开" (expand) does.
- To copy or save a picture, the extension downloads it without cookies. If the hostname is on a fixed list of literal local or private-network names (localhost, names ending in .local, .localhost, .internal, .lan or .home.arpa, and 0., 10., 127., 169.254., 192.168., 172.16–31., ::1, fc00::/7, fe80::) and it is not the same host as the current page, that download is refused. The hostname after a redirect is checked against the same list. This is not a promise that a private-network address is never requested: an ordinary domain name is not blocked even if it points at a private address, and a picture on the same host is still downloaded when the page itself is already open on that host. Some image servers only accept requests from their own site, so while that download runs, requests to that image server (same domain) carry the current site's domain (not the page address) as the source. Downloads run one at a time; the rule is confirmed removed before the next one starts, and if it cannot be removed, no further download runs.

The extension never reads or exports your cookies or sign-in details.

### What stays on your computer

- Settings (on/off, enabled sites, shortcuts, viewing mode, video volume) are kept in the browser's extension storage on this computer only, and are removed when you uninstall.
- Pictures you save are in your downloads folder, and anything you copy is on your system clipboard; you manage those yourself.

### What it never does

No account, no analytics, no ads. It does not sell data, or use it for anything other than viewing pictures.

This extension's use of user data complies with the Limited Use requirements in the Chrome Web Store User Data Policy. That data is used only to enlarge pictures and show posts on sites you turn on. It is not sold, it is not used for advertising, credit assessment, or lending, and the developer does not receive it. Requesting a file from an image host in order to show the picture, and requesting a long Weibo post's full text from Weibo, are necessary for that use. Policy text: https://developer.chrome.com/docs/webstore/program-policies/limited-use

### Site access

At install it only asks for access to the built-in sites and their image servers. Anywhere else it runs only after you turn the site on in settings and click Allow in Chrome's prompt; turning that site off gives the access back. Access to the built-in sites is granted at install; turning one off stops the extension there, and the access itself is removed when you uninstall.

### Contact and changes

Questions or suggestions: open an issue at https://github.com/Jooosephlee/zizai/issues . If this policy changes, this page is updated with a new effective date. All of the extension's code is public, so anyone can check it. There is no separate contact email.
