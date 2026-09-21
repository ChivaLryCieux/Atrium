# Atrium 自托管字体 (Self-hosted Fonts)

全部字体为 SIL Open Font License 1.1（见各 `OFL-*.txt`），可随应用打包分发，无需联网。

| 字体 | 用途 | 文件 | 来源 |
| --- | --- | --- | --- |
| Noto Sans SC（思源黑体 Google 发行版，Adobe 设计） | 中文（CJK） | `NotoSansSC-variable.woff2`（变量 100–900，7.4 MB） | [google/fonts](https://github.com/google/fonts/tree/main/ofl/notosanssc)，TTF 本地转 woff2 |
| Linux Biolinum | 西文（Latin） | `LinBiolinum_R.woff2` / `_B.woff2` / `_I.woff2` | [Linux Libertine 5.3.0](https://sourceforge.net/projects/linuxlibertine/)（GPL+字体例外 / OFL 双许可，取 OFL），TTF 本地转 woff2 |
| JetBrains Mono | 代码与等宽遥测 | `JetBrainsMono-Regular/Medium/Bold.woff2` | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) 官方 webfonts |

字体栈（`src/styles.css` 的 `--font-sans` / `--font-mono`）：

- 西文与数字 → Linux Biolinum，CJK 字形自动回退 Noto Sans SC（按字体覆盖逐字形匹配，无需 unicode-range）
- 等宽 → JetBrains Mono（含 Medium 500；字重 600 会匹配到 Bold 700）
- 系统兜底：PingFang SC / Microsoft YaHei / Consolas

注意：

- Biolinum 仅有 400/700 两档实重，西文在 `font-weight: 500/600` 的上下文中会由浏览器合成加粗（中文走 Noto 变量字体为真实字重）。
- 更新字体版本后同步更新本表与对应 OFL 文件。
