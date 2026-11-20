# Chrome 应用商店上架材料 · 自在浏览 1.1.0

按开发者后台的页面顺序排。每一栏直接复制粘贴即可。

---

## 一、Package（上传包）

- 上传文件：`store/zizai-1.1.0.zip`（由 `scripts/pack-store.sh` 生成，manifest.json 在压缩包根目录；脚本会打印 SHA256，复审时对照）
- 版本：1.1.0（商店里显示 1.1.0，去掉了开发版后缀）

---

## 二、Store listing（商品详情）

商店会按浏览器语言显示对应版本。先填**默认语言：中文（简体）**，再点「添加语言」加 English。

### 中文（简体）

**名称**：来自 manifest，自动显示为「自在浏览」

**摘要**（manifest 里的 description，最多 132 字符，已写进包里）：
> 鼠标停在网页图片上，大图直接铺开，作者和正文就在旁边。免费开源，不向我们发送任何数据。

**详细说明**：

```
鼠标一停，精彩就来。

刷到好图，不用点开。鼠标停在图上，大图直接铺开，作者和正文就在旁边。看完随手一点，接着刷。

· 不用点：鼠标停一下就打开，不用先点开、再等它弹出来。
· 不打断：滚轮、触控板或 ← → 键翻下一张，不用关掉再去点。
· 字就在旁边：谁发的、写了什么、转发里说了什么，跟图一起看。
· 看得更清：自动找原图，放大了也清楚。
· 视频也一样：视频放大播放，带声音；实况照片和动图，鼠标停上去就会动。
· 来去自在：点一下图片或旁边的空白处就关；看视频时点画面是暂停。

装好就能用的网站：微博、即刻、X、Instagram、Pinterest、豆瓣、B 站、站酷。
其他网站由你决定：点工具栏上的图标，打开开关，允许访问就行。

隐私：不用注册，不用登录，没有统计和广告。帖子和图片只在你的浏览器里处理，用来显示预览，不会发给我们。我们没有服务器，设置只存在你自己的浏览器里。代码全部开源（MIT 协议）。

以上网站名称归各自的所有者。自在浏览是独立的开源项目，和这些网站没有关联。
```

**类别**：Make Chrome Yours → Functionality & UI（功能与界面）
（如果后台下拉里没有，就选 Photos / 照片）

**语言**：中文（简体）

**图片**（`store/zh/`）：
- 商店图标 128×128：`icon-128.png`
- 截图 1280×800（按顺序传 5 张）：`1-open.png` … `5-area.png`
- 小宣传图 440×280：`promo-small.png`
- 大宣传图 1400×560（选填）：`promo-marquee.png`

### English

**Summary**（自动来自 manifest 英文版）：
> Rest your mouse on a picture: it fills the screen, with the post right beside it. Free and open source. Nothing is sent to us.

**Description**:

```
Just pause. It comes to you.

Spot a great picture? No need to click it open. Rest your mouse on it and it fills the screen, with who posted it and what they wrote right beside it. One click and you're back to scrolling.

· No clicking in: pause on a picture and it opens.
· No losing your place: wheel, trackpad or ← → keys take you to the next one.
· The words, right beside it: who posted it, what they said and the post they quoted.
· Sharper: Zizai finds the original, so it stays clear when it's big.
· Videos too: they play big, with sound. Live Photos and GIFs move when you rest on them.
· Easy in, easy out: click the picture or the space around it to close; on a video, a click pauses.

Ready on: X, Instagram, Pinterest, Weibo, Jike, Douban, Bilibili, Zcool.
On any other site, you decide: click the toolbar icon, turn it on and allow access.

Privacy: no account, no sign-in, no analytics or ads. Posts and pictures are handled only in your browser to show the preview, and never sent to us. There is no server; your settings stay in your own browser. All the code is open source (MIT).

Site names belong to their owners. Zizai is an independent open-source project and is not affiliated with these sites.
```

**图片**（`store/en/`）：同上，英文版。

### 其他栏

- **Official URL / Homepage URL**：`https://jooosephlee.github.io/zizai/`。2026-11-20 实测 HTTP 200。不要填商店商品页。
- **Support URL**：`https://github.com/Jooosephlee/zizai/issues`。没有联系邮箱，不要另填一个编出来的地址。
- **Mature content**：否。

---

## 三、Privacy（隐私权）

**Single purpose（单一用途）**：

```
在用户开启的网站上看图：鼠标停在图片或视频上时，把它放大显示（尽量用原图），并在旁边显示这条帖子的作者和正文；用户也可以主动复制或保存当前的图片和文字。
```

English（如果后台要求英文）：

```
Viewing pictures on sites the user turns on: when the mouse rests on a picture or video, show it enlarged (using the original when available), with the post's author and text beside it; the user can also copy or save the current picture and text.
```

**Permission justification（权限理由）**：

| 权限 | 填写内容 |
| --- | --- |
| storage | 把用户的设置（开关、触发方式、启用的网站、快捷键、视频音量）保存在本机浏览器里。不上传。 |
| scripting | 只在用户启用的网站上，按需运行扩展包内自带的看图脚本，不加载远程代码。用户在新网站上允许访问后，为这个网站登记同一组脚本；在微博、即刻、X、Instagram 上，读取帖子数据的脚本只在开着看图时登记，关掉就注销。 |
| activeTab | 用户点工具栏图标打开设置时，读取当前标签页的网址，好让用户在这个网站上打开或关闭看图。 |
| declarativeNetRequestWithHostAccess | 用户主动复制或保存图片时，部分图床（例如微博的图片服务器）会拒绝没有来源的请求。插件在这次下载期间加一条临时规则，把来源（Referer）设为当前网站的域名（不含页面地址），只作用于扩展自己发出、发往这张图片所在服务器域名（含同一域名内的跳转）的请求，不影响网页本身的请求。下载一次只进行一张：开始前先清掉任何残留规则，结束后确认删掉；删不掉就不再继续下载。 |
| Host permissions | 安装时只申请默认开启的网站（微博、即刻、X、Instagram、Pinterest、豆瓣、B 站、站酷、小红书）和它们的图片服务器：在这些网站上识别鼠标下的图片、显示大图；复制和保存图片时下载这张图片。 |
| Optional host permissions（`*://*/*`） | 不在安装时申请。只有用户在某个网站上主动打开看图开关时，才通过 Chrome 的提示申请这一个网站的访问权限；用户关掉这个网站（开关或快捷键）就交还。默认网站的权限在安装时授予，关掉后插件不在那里运行，权限在卸载时收回。 |

**Remote code（远程代码）**：选「No, I am not using remote code」。所有脚本都在扩展包里。

**Data usage（数据使用）**：只在本机处理的数据也要申报。勾选：

- **Website content（网站内容）**：在用户开启的网站上读取帖子正文、作者名、头像和图片 / 视频地址，用来显示预览。帖子内容留在当前页面内存里，不发给开发者，也不另存。显示图片时，浏览器仍会向图床请求该地址。
- **User activity（用户活动）**：读取鼠标位置和点击，判断停在哪张图上。只在本机使用。
- **Personally identifiable information（个人身份信息）**：勾选。卡片读取并显示帖子作者的名字和头像。不读取用户本人的邮箱、住址或证件号。Chrome 的用户数据 FAQ 把人名和用户名列为个人身份信息，所以和「网站内容」一起勾。
- **Personal communications（个人通讯）**：勾选。私信、通知、账号、设置、支付只按网址路径和接口名称跳过；看图仍会读取当前页上的图片，名单对不上的内容也不在跳过范围内。不要写成「整页不读取」，也不要据此不勾。

不勾选：

- **Authentication（身份验证信息）**：不勾。不读取密码、Cookie 或登录信息。微博长文由浏览器附上已有会话发出，插件看不到这些凭据。不要把浏览器自动附带的 Cookie 当成凭据收集。
- **Location（位置）**：不勾。不读取 IP、地区或 GPS。图床或微博在普通请求里看到的 IP，不作为位置信息申报。
- **Health information（健康信息）**、**Financial and payment information（财务和付款信息）**：不勾。没有读取这些内容。

**Web history（网络记录）**：先打开后台这一项的具体定义，再决定勾不勾。不要直接写成不选。实现是：不保存访问过的网页列表，也没有标题或访问时间；打开设置时读取当前标签页网址，并且不保存；启用的网站域名存在本机设置里。若定义只指访问记录列表，可以不选；若定义包括读取当前网址，则应勾选。

然后对照后台原文勾选这三项。语义来自 Limited Use 政策，不是 Google API 承诺：

- 不向第三方出售用户数据。向图床取图、向微博取长文，只为显示图片或全文。
- 不把用户数据用于与看图这个单一用途无关的目的。
- 不把用户数据用于信用评估或放贷。

**Privacy policy URL（必填）**：`https://jooosephlee.github.io/zizai/privacy.html`。页面由 `scripts/build-privacy.py` 从 PRIVACY.md 生成。2026-11-20 实测首页和这一页都是 HTTP 200。本段修改合并到 `main` 之后，再打开这一页确认能看到 Limited Use 陈述，然后再提交审核。草稿商品 ID 不要写成已上架，也不要放进官网或下载链接。

---

## 四、Distribution（发布）

- **Visibility**：Public（公开）
- **Regions**：All regions（所有地区）
- **付费**：免费

---

## 五、提交前要你确认的

- 开发者账号的「发布者名称」用什么（会公开显示在商店里）。用这个项目自己的身份，不用个人主账号的名字或邮箱。
- 欧盟「交易者 / 非交易者」声明：用户已确认填非交易者。
- 审核时间：安装时只申请固定的几个网站，审核一般比申请所有网站快；首次提交仍可能需要几天。
