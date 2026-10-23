/** The whole stylesheet; served at /assets/style.css. Light and dark via prefers-color-scheme. */
export const STYLESHEET = `
:root {
  --bg: #f7f7f9; --surface: #ffffff; --text: #1d1d24; --muted: #666675;
  --border: #e2e2e8; --accent: #5865f2; --accent-text: #ffffff; --warn: #b45309;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15151b; --surface: #1e1e26; --text: #ececf1; --muted: #a0a0ad;
    --border: #2e2e39; --accent: #7983f5; --accent-text: #0e0e12; --warn: #f59e0b;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  background: var(--surface); border-bottom: 1px solid var(--border);
  padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center;
}
header .brand { font-weight: 700; color: var(--text); }
header nav { display: flex; gap: 16px; flex-wrap: wrap; }
header form.search { margin-left: auto; display: flex; gap: 6px; flex: 1 1 220px; max-width: 360px; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 32px 0 12px; }
.muted { color: var(--muted); }
.small { font-size: 0.875rem; }
.badge {
  display: inline-block; font-size: 0.75rem; padding: 1px 8px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--muted); margin-left: 6px; vertical-align: middle;
}
.badge.warn { color: var(--warn); border-color: currentColor; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.card, .row {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px;
}
.rows { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.row .grow { flex: 1 1 240px; min-width: 0; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--border); flex: none; }
.avatar.large { width: 72px; height: 72px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.tag {
  font-size: 0.8rem; padding: 1px 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
audio, video { width: 100%; margin-top: 12px; }
video { border-radius: 8px; background: #000; }
input, textarea, select, button {
  font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px;
}
input, textarea, select { width: 100%; }
textarea { min-height: 90px; }
button, .button {
  background: var(--accent); color: var(--accent-text); border-color: var(--accent);
  cursor: pointer; width: auto; display: inline-block; padding: 6px 14px; border-radius: 8px;
}
button.secondary { background: transparent; color: var(--text); border-color: var(--border); }
form.stack { display: grid; gap: 12px; max-width: 560px; }
form.stack label { display: grid; gap: 4px; font-size: 0.9rem; }
form.filters { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); align-items: end; margin-bottom: 20px; }
form.inline { display: inline; }
details.edit { margin-top: 24px; background: var(--surface); border: 1px dashed var(--border); border-radius: 10px; padding: 12px 16px; }
details.edit summary { cursor: pointer; font-weight: 600; }
details.edit form { margin-top: 12px; }
.pager { display: flex; gap: 12px; justify-content: center; margin-top: 24px; align-items: center; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.error { color: var(--warn); }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
td code { white-space: pre-wrap; word-break: break-word; }
`;
