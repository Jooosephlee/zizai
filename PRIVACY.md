# 隐私政策 · Privacy Policy

生效日期：2026 年 11 月 27 日 · Effective 27 November 2026

[中文](#中文) · [English](#english)

## 中文

自在浏览（Zizai）是一个浏览器插件，只在你的浏览器里工作。开发者没有服务器，收不到你看了什么。

### 插件在你的浏览器里处理什么

只在你开启了看图的网站上，为了放大图片、显示帖子：

- **鼠标位置和点击**：判断你停在哪张图上、点了哪个按钮。
- **页面上的图片、视频地址，帖子的正文、作者名和头像**：从网页本身读取；在微博、即刻、X、Instagram 上，也从网页自己已经收到的数据里读取。小红书（xiaohongshu.com）和 Rednote（rednote.com）默认不开启，安装时也不申请它们的访问权限。你在设置里打开并在 Chrome 的提示里点「允许」之后，插件同样只读取该页已经收到的笔记数据：首页、搜索、个人页、收藏、点赞，以及已经打开的笔记，留下图片、视频地址、标题、正文、作者名和头像。只显示封面的笔记不会因此再去请求笔记页。帖子缓存只保留带图片或视频的帖子。读取这些已经收到的数据时，会按网址路径和接口名称跳过能对上的私信、通知、账号、设置、支付相关请求；当前页路径也对得上时，不再把新的响应写进缓存。这是一份名称名单，不是「私密页面整页不读取」：看图仍会读取页面上的图片来放大，名单对不上的地址不在跳过范围内，已经留在内存里的内容也不会因为后来打开这类页面就自动清掉。
- **当前标签页的网址**：你打开工具栏上的设置时，用来显示和切换这个网站。

这些内容只放在当前页面的内存里，用来显示预览。关掉看图或关掉这个网站的开关，当前页面立刻停止读取并清掉已读的内容，之后才到的数据也会丢弃；重新打开后，从下一次打开页面起才恢复。关掉页面，内容也随之消失。插件不把这些内容写进自己的硬盘存储，也不发给开发者。显示图片、视频时，浏览器仍会按下一节所说，向网站或图床请求文件。

### 会发出哪些网络请求

- 显示大图、视频、头像时，浏览器会按网页给出的地址（https 或 http）向图片所在的网站或它的图片服务器请求这些文件，和你自己点开时一样。对方会按惯例看到你的 IP 地址和请求的文件地址。
- 放大播放视频时，会先用允许读取画面的方式加载视频文件，以便在服务器允许时复制当前画面。服务器拒绝后，改为和网页一样的普通方式加载，并在这台电脑上记下这个视频服务器的域名（最多 50 个），下次同一域名直接用普通方式。只存域名，不存具体网址或视频内容。
- 在微博上用全页看一条网页只显示了前一部分的长帖时，插件会向微博请求这条帖子的全文，带着你在微博的登录状态，并带上 Accept 和 X-Requested-With 这两个请求头，和你点「展开」一样。被引用的长帖如果也只显示了前一部分，会另外请求一次。悬浮放大不发这个请求。
- 这些全文请求按一个人看帖的速度限制，所有标签页一起算，weibo.cn 和 weibo.com 算同一个网站：两次之间至少隔 4 秒，一分钟最多 6 次，一小时最多 60 次。名额只在真要发出时才占用。微博返回请求太频繁、要求验证，或页面跳到验证页时，30 分钟内不再请求，只显示网页上已有的内容。这些次数记在浏览器的会话存储里，关掉浏览器就清空，里面没有帖子内容。
- 插件不向小红书或 Rednote 请求笔记页，也不把页面数据里的 xsec_token 发到任何网站。你自己打开小红书或 Rednote 之后，只显示封面的笔记就只显示封面和页面上已经有的文字。
- 全页查看一组图片时，当前图片显示出来之后，浏览器会再请求下一张图片的文件，优先级较低，一次只取一张。下一张若是视频或实况图，不会提前请求，要播放时才获取。图片服务器看到的仍是你的 IP 地址和该文件地址。
- 复制或保存图片时，插件下载这张图片，不带 Cookie。若主机名落在一份固定的本机或局域网字面名单里（localhost，以 .local、.localhost、.internal、.lan、.home.arpa 结尾，以及 0.、10.、127.、169.254.、192.168.、172.16–31.、::1、fc00::/7、fe80::），并且和当前网页不是同一主机，这次下载会拒绝；跳转之后的主机名也按同一名单看。这不是「绝不请求私网」：普通域名即使指向内网也不会被拦住，当前网页自己就开在那台主机上时，同一主机的图片仍会下载。有的图床只接受来自自己网站的请求，插件会在这次下载期间，对发往这个图片服务器（同一域名）的请求临时附上当前网站的域名（不含具体页面地址）。下载一次只进行一张，结束后先确认撤掉再开始下一张；撤不掉就不再下载。

插件不读取、不导出你的 Cookie 或登录信息。

### 保存在你电脑上的

- 设置（开关、启用的网站名单、快捷键、看图方式、视频音量）存在浏览器的扩展存储里，只在这台电脑上，卸载插件时一并删除。
- 还有两个计数：你点过几次关闭按钮、打开过几次全页看图，用来决定关闭按钮什么时候收成小点。只是数字，不含网址或内容，卸载插件时一并删除。
- 上面说的视频服务器域名（最多 50 个）也存在同一处扩展存储里，卸载时一并删除。
- 你主动保存的图片在你的下载文件夹里，复制的内容在系统剪贴板里，由你自己管理。

### 不做的事

没有账号，没有统计，没有广告。不出售数据，也不把数据用在看图以外的地方。

本插件对用户数据的使用符合 Chrome 应用商店用户数据政策中的 Limited Use 要求：这些数据只用于在你开启的网站上放大图片和显示帖子；不出售；不用于广告、信用评估或放贷；开发者不接收这些数据。为显示图片和视频而向图床或视频服务器请求文件（含全页一组图里提前请求下一张图片文件，不提前请求视频或实况图；视频会先试一次允许读取画面的加载），以及为在全页显示微博长文而向微博请求全文，是这个用途所必需的。政策原文：https://developer.chrome.com/docs/webstore/program-policies/limited-use

### 网站权限

安装时只申请默认网站和它们图片服务器的访问权限。小红书和 Rednote 不在这份名单里。其他网站要等你在设置里打开它，并在 Chrome 的提示里点「允许」，插件才会在那里运行；你关掉这个网站时，权限一并交还。默认网站的权限是安装时授予的，关掉开关后插件在那里不再运行，但权限要卸载插件才会收回。从旧版本更新时，会把已经开着的小红书和 Rednote 关掉一次；你之后再打开，就会保留。

### 联系与变更

有问题或建议，请在 GitHub 提交：https://github.com/Jooosephlee/zizai/issues 。政策有变化时会更新这一页，并写明新的生效日期。插件的代码全部公开，任何人都可以检查。没有单独的联系邮箱。

## English

Zizai is a browser extension that works only inside your browser. The developer has no server and never learns what you look at.

### What the extension handles in your browser

Only on sites where you have turned previews on, to enlarge pictures and show posts:

- **Mouse position and clicks**: to tell which picture you are resting on and which button you pressed.
- **Picture and video addresses, and a post's text, author name and avatar**: read from the page itself and, on Weibo, Jike, X and Instagram, from data the page has already received. Xiaohongshu (xiaohongshu.com) and Rednote (rednote.com) are off by default, and the extension does not ask for access to them at install. After you turn one on in settings and click Allow in Chrome's prompt, the extension reads only note data that the page has already received — the feed, search, a profile, collects, likes, and a note already open — keeping picture and video addresses, the title, the text, and the author's name and avatar. A note shown only by its cover does not cause a request for the note page. The post cache keeps only posts with pictures or videos. When reading data the page has already received, requests whose address or query name matches messages, notifications, account, settings or payments are skipped, and a matching page path stops new responses from being cached. That is a name list, not a promise that a private page is never read: previews still read pictures on the page in order to enlarge them, addresses that do not match the list are outside it, and anything already in memory is not cleared just because a matching page opens later.
- **The current tab's address**: when you open the toolbar settings, to show and switch previews for that site.

This stays in the current page's memory to show the preview. Turning previews off, or turning the site off, stops the reading on the current page at once and clears what was read; data arriving later is dropped. Turning it back on takes effect from the next page load. Closing the page clears it too. The extension does not write this into its own disk storage and does not send it to the developer. Showing a picture or video still makes the browser request the file from the site or its image host, as the next section describes.

### Network requests it makes

- To show pictures, videos and avatars, your browser requests those files (over https or http, as the page gives them) from the site or its image servers, just as when you open them yourself. Those servers see your IP address and the file address, as usual.
- An enlarged video is first loaded in a way that allows the current frame to be read, so it can be copied when the server allows that. If the server refuses, the video loads the ordinary way, as on the page, and this computer remembers that video server's domain (up to 50). The next video from the same domain skips the first try. Only the domain is stored, not the address or the video.
- For a long Weibo post that the page shows only in part, the full-page view asks Weibo for the rest, with your Weibo session and with the Accept and X-Requested-With headers, just as clicking "展开" (expand) does. A quoted long post that is also only partly shown is requested separately. The floating view does not send this request.
- Those full-text requests are paced like a person reading, across all tabs, with weibo.cn and weibo.com counted as one site: at least 4 seconds apart, at most 6 a minute and 60 an hour. A slot is taken only when a request is about to be sent. If Weibo answers that requests are too frequent, asks for a check, or the page is sent to a check page, no further request is made for 30 minutes, and only what the page already holds is shown. The counts stay in the browser's session storage, are cleared when the browser closes, and do not contain post text.
- The extension does not request a note page from Xiaohongshu or Rednote, and it does not send an xsec_token from the page data to any site. After you turn Xiaohongshu or Rednote on yourself, a note shown only by its cover stays that cover and the text already on the page.
- In a full-page gallery, after the current picture is shown, the browser requests the next picture's file, at low priority, one at a time. If the next item is a video or a Live Photo, it is not requested ahead; it is requested when it plays. The image server still sees your IP address and that file's address.
- To copy or save a picture, the extension downloads it without cookies. If the hostname is on a fixed list of literal local or private-network names (localhost, names ending in .local, .localhost, .internal, .lan or .home.arpa, and 0., 10., 127., 169.254., 192.168., 172.16–31., ::1, fc00::/7, fe80::) and it is not the same host as the current page, that download is refused. The hostname after a redirect is checked against the same list. This is not a promise that a private-network address is never requested: an ordinary domain name is not blocked even if it points at a private address, and a picture on the same host is still downloaded when the page itself is already open on that host. Some image servers only accept requests from their own site, so while that download runs, requests to that image server (same domain) carry the current site's domain (not the page address) as the source. Downloads run one at a time; the rule is confirmed removed before the next one starts, and if it cannot be removed, no further download runs.

The extension never reads or exports your cookies or sign-in details.

### What stays on your computer

- Settings (on/off, enabled sites, shortcuts, viewing mode, video volume) are kept in the browser's extension storage on this computer only, and are removed when you uninstall.
- Two counts are kept there too: how many times you press the close button, and how many times a full page opens, so the close button can shrink to a dot. They are numbers only, with no address or content, and they are removed when you uninstall.
- The video-server domains above (up to 50) are kept in the same extension storage and removed when you uninstall.
- Pictures you save are in your downloads folder, and anything you copy is on your system clipboard; you manage those yourself.

### What it never does

No account, no analytics, no ads. It does not sell data, or use it for anything other than viewing pictures.

This extension's use of user data complies with the Limited Use requirements in the Chrome Web Store User Data Policy. That data is used only to enlarge pictures and show posts on sites you turn on. It is not sold, it is not used for advertising, credit assessment, or lending, and the developer does not receive it. Requesting a file from an image host or a video server in order to show the picture or video (including requesting the next picture's file ahead in a full-page gallery, and not requesting a video or Live Photo ahead; a video first tries a load that allows the frame to be read), and requesting a long Weibo post's full text from Weibo for the full-page view, are necessary for that use. Policy text: https://developer.chrome.com/docs/webstore/program-policies/limited-use

### Site access

At install it only asks for access to the built-in sites and their image servers. Xiaohongshu and Rednote are not on that list. Anywhere else it runs only after you turn the site on in settings and click Allow in Chrome's prompt; turning that site off gives the access back. Access to the built-in sites is granted at install; turning one off stops the extension there, and the access itself is removed when you uninstall. Updating from an older version turns Xiaohongshu and Rednote off once; if you turn one on again, it stays on.

### Contact and changes

Questions or suggestions: open an issue at https://github.com/Jooosephlee/zizai/issues . If this policy changes, this page is updated with a new effective date. All of the extension's code is public, so anyone can check it. There is no separate contact email.
