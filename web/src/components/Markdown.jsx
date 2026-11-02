// Tiny renderer for the brief: headings, bullets, numbered lines, text.
// Builds React elements (no HTML injection).
export default function Markdown({ text }) {
  const out = [];
  let items = null;
  const flush = (key) => {
    if (items) { out.push(<ul key={`l${key}`} className="md-list">{items}</ul>); items = null; }
  };
  (text ?? "").split("\n").forEach((line, i) => {
    if (/^# /.test(line)) { flush(i); out.push(<h2 key={i}>{line.slice(2)}</h2>); }
    else if (/^## /.test(line)) { flush(i); out.push(<h3 key={i}>{line.slice(3)}</h3>); }
    else if (/^(- |\d+\. )/.test(line)) { (items ??= []).push(<li key={i}>{line.replace(/^- /, "")}</li>); }
    else if (line.trim() === "") flush(i);
    else { flush(i); out.push(<p key={i}>{line}</p>); }
  });
  flush("end");
  return <div className="md">{out}</div>;
}
