#!/usr/bin/env python3
"""Builds docs/privacy.html from PRIVACY.md, so the policy has one source and a
public page (the address the Chrome Web Store asks for). Handles the small
Markdown subset PRIVACY.md uses: headings, lists, paragraphs, bold, links."""
import html
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = (root / "PRIVACY.md").read_text(encoding="utf-8")


def inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"(?<![\"'>])(https://[^\s<]+?)(?=\s|$|<)", r'<a href="\1">\1</a>', text)
    return text


def slug(title):
    return {"中文": "zh", "English": "en"}.get(title, re.sub(r"\W+", "-", title.lower()).strip("-"))


out, items = [], []


def flush():
    if items:
        out.append("<ul>" + "".join(f"<li>{inline(i)}</li>" for i in items) + "</ul>")
        items.clear()


for line in source.splitlines():
    line = line.rstrip()
    if line.startswith("- "):
        items.append(line[2:])
        continue
    flush()
    if not line:
        continue
    level = len(line) - len(line.lstrip("#"))
    if level:
        title = line[level:].strip()
        anchor = f' id="{slug(title)}"' if level == 2 else ""
        out.append(f"<h{level}{anchor}>{inline(title)}</h{level}>")
    else:
        line = line.replace("(#中文)", "(#zh)").replace("(#english)", "(#en)")
        out.append(f"<p>{inline(line)}</p>")
flush()

page = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>隐私政策 · Zizai Privacy Policy</title>
<link rel="icon" href="assets/mark.svg" type="image/svg+xml">
<style>
:root {{ color-scheme: light dark; --bg: light-dark(#fff, #000); --ink: light-dark(#1d1d1f, #f5f5f7); --muted: light-dark(#6e6e73, #a1a1a6); --line: light-dark(#e5e5ea, #2c2c2e); --link: light-dark(#b25e00, #f2a03d); }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.75 -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }}
main {{ max-width: 720px; margin: 0 auto; padding: 56px 16px 96px; }}
.home {{ display: inline-flex; align-items: center; gap: 8px; color: var(--ink); text-decoration: none; font-weight: 600; }}
.home img {{ width: 24px; height: 24px; }}
h1 {{ margin: 32px 0 8px; font-size: 34px; letter-spacing: -.02em; line-height: 1.2; }}
h2 {{ margin: 56px 0 8px; padding-top: 24px; border-top: 1px solid var(--line); font-size: 26px; }}
h3 {{ margin: 32px 0 6px; font-size: 18px; }}
p, li {{ word-break: keep-all; overflow-wrap: break-word; }}
ul {{ padding-left: 1.2em; }}
li {{ margin: 6px 0; }}
a {{ color: var(--link); }}
main > p:first-of-type {{ color: var(--muted); }}
</style>
</head>
<body>
<main>
<a class="home" href="./"><img src="assets/mark.svg" alt="">自在浏览 · Zizai</a>
{chr(10).join(out)}
</main>
</body>
</html>
"""
(root / "docs" / "privacy.html").write_text(page, encoding="utf-8")
print("docs/privacy.html")
