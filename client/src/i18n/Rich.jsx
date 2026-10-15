import { Fragment } from "react";

// Renders a translated string that may contain the rich-text markup allowed
// in the dictionaries – <t>…</t> (a game term), <em>…</em> and
// <strong>…</strong> – plus {slot} placeholders that are filled with React
// elements (e.g. a link). The string is parsed into elements; it is never
// injected as HTML.
const TOKEN = /<(\/?)(t|em|strong)>|\{(\w+)\}/g;

function parse(text) {
  const root  = { tag: null, children: [] };
  const stack = [root];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [, closing, tag, slot] = m;
    if (slot) {
      top.children.push({ slot });
    } else if (closing) {
      if (stack.length > 1 && top.tag === tag) stack.pop();
    } else {
      const node = { tag, children: [] };
      top.children.push(node);
      stack.push(node);
    }
  }
  if (last < text.length) stack[stack.length - 1].children.push(text.slice(last));
  return root.children;
}

function render(nodes, components, slots, prefix) {
  return nodes.map((node, i) => {
    const key = `${prefix}${i}`;
    if (typeof node === "string") return <Fragment key={key}>{node}</Fragment>;
    if (node.slot) {
      return <Fragment key={key}>{slots && node.slot in slots ? slots[node.slot] : `{${node.slot}}`}</Fragment>;
    }
    const children = render(node.children, components, slots, `${key}.`);
    const Custom = components?.[node.tag];
    if (Custom) return <Custom key={key}>{children}</Custom>;
    if (node.tag === "t") return <em key={key}>{children}</em>;
    const Tag = node.tag; // "em" | "strong"
    return <Tag key={key}>{children}</Tag>;
  });
}

/**
 * <Rich text={t("rules.setup.p1")} components={{ t: Term }} slots={{ link: <a …/> }} />
 */
export default function Rich({ text, components, slots }) {
  if (typeof text !== "string") return null;
  return <>{render(parse(text), components, slots, "")}</>;
}
