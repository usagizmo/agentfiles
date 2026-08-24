/* mermaid を rabi-design の面・罫・文字で描く。規則は `../references/DESIGN.md`「図」 */

const CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

const probe = document.createElement("span");
const read = (property, value) => {
  document.documentElement.append(probe);
  probe.style.setProperty(property, value);
  const resolved = getComputedStyle(probe).getPropertyValue(property);
  probe.remove();
  return resolved;
};
const color = (value) => read("color", value);

const config = () => {
  const ink = color("var(--rabi-ink)");
  const paper = color("var(--rabi-paper)");
  const sunk = color("var(--rabi-paper-2)");
  const divider = color("var(--rabi-divider)");
  const line = color("var(--rabi-line)");
  const wash = color("var(--rabi-wash)");
  const washLine = color("var(--rabi-wash-line)");
  const accentText = color("var(--rabi-accent-text)");
  const family = read("font-family", "var(--rabi-font)");
  return {
    startOnLoad: false,
    // 壊れた図は爆弾ではなくソースのまま残す
    suppressErrorRendering: true,
    theme: "base",
    fontFamily: family,
    // 図種ごとの font は themeVariables では届かない
    sequence: { actorFontFamily: family, messageFontFamily: family, noteFontFamily: family },
    themeVariables: {
      fontFamily: family,
      background: paper,
      lineColor: color("var(--rabi-edge)"),
      textColor: ink,
      primaryColor: paper,
      primaryBorderColor: divider,
      primaryTextColor: ink,
      secondaryColor: paper,
      secondaryBorderColor: divider,
      secondaryTextColor: ink,
      tertiaryColor: sunk,
      tertiaryBorderColor: line,
      tertiaryTextColor: ink,
      clusterBkg: sunk,
      clusterBorder: line,
      edgeLabelBackground: paper,
      noteBkgColor: wash,
      noteBorderColor: washLine,
      noteTextColor: ink,
    },
    // 強調は `class <id> accent`。図のソースへ色を書かせない
    themeCSS: `
      .node.accent > rect, .node.accent > polygon, .node.accent > path, .node.accent > circle {
        fill: ${wash};
        stroke: ${washLine};
      }
      .node.accent .nodeLabel, .node.accent .nodeLabel p { color: ${accentText}; }
      .node.accent text { fill: ${accentText}; }
    `,
  };
};

// テーマが変わると解決済みの色が古くなる。ソースを保って描き直す
let sources;
const render = () => {
  const nodes = [...document.querySelectorAll("pre.mermaid")];
  sources ??= new Map(nodes.map((node) => [node, node.textContent]));
  for (const node of nodes) {
    node.textContent = sources.get(node);
    node.removeAttribute("data-processed");
  }
  mermaid.initialize(config());
  // 描けなかった図は空にされる。ソースへ戻して読めるようにする
  const restore = () => {
    for (const node of nodes) {
      if (!node.querySelector("svg")) node.textContent = sources.get(node);
    }
  };
  return mermaid.run({ nodes }).then(restore, restore);
};

const parsed =
  document.readyState === "loading"
    ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve))
    : Promise.resolve();

const loaded = new Promise((resolve, reject) => {
  const tag = document.createElement("script");
  tag.src = CDN;
  tag.addEventListener("load", resolve);
  // CDN へ届かないときは図のソースがそのまま残る
  tag.addEventListener("error", reject);
  document.head.append(tag);
});

Promise.all([parsed, loaded]).then(
  () => {
    render();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
    new MutationObserver(render).observe(document.documentElement, {
      attributeFilter: ["data-theme"],
    });
  },
  () => {},
);
