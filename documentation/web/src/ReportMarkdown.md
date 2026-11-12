# web/src/ReportMarkdown.tsx

Renders the evaluation report on the job workspace as Markdown with `react-markdown` and `remark-gfm`
(tables, task lists, strikethrough).

- No raw HTML passthrough: the report is untrusted text, so HTML in it shows as literal text.
- Images render nothing. Only http(s) and mailto links become anchors (new tab, `rel="noopener noreferrer"`); javascript:, data:, vbscript: and relative links render as plain text. Unsafe URL schemes are
  dropped by the library default.
- Headings are demoted (report h1 and h2 become h4, h3 becomes h5, deeper levels h6) so the page keeps one
  h1 and a valid outline under the section's h3.
- Tables sit in a horizontally scrolling wrapper. The container is a focusable, labelled region.
- Styles: `.report-prose` in `styles.css`, themed for light and dark.

## Header fields grid (F24)

A paragraph made of two or more consecutive bold `Label:` fields, written either on separate lines or on one
line, renders as a borderless two-column grid (`dl.report-fields`, one field per row). The label is the bold text
without its colon; the value keeps its inline content, so a URL stays a link under the http(s) and mailto rule.
A paragraph with a single bold field, or any other paragraph, renders unchanged. No raw HTML is involved.
