// design/ の面を横断する chrome —— 面の切り替えとテーマ。
//
// 見本の外に置く。DOM の末尾へ入れて焦点の順を崩さず、下端に固定して天の帯と重ねない。
(function () {
  "use strict";

  // 面の索引。`design/` に面を足したらここへ 1 行足す
  var SURFACES = [
    ["components.html", "部品"],
    ["landing.html", "宣伝"],
    ["docs.html", "読み物"],
    ["app.html", "操作"],
    ["diagram.html", "図"],
  ];

  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2' +
    'M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></svg>';

  var root = document.documentElement;

  // 顔は紙。闇は切り替えで見る —— 文房具の既定は紙の上
  root.dataset.theme = "light";

  function toggle() {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    sync();
  }

  // 面は切り替えを複数持てる。全部の状態を揃える。
  // 動かすのは `aria-pressed` だけ —— 名前を反対の操作にすると状態と食い違う。
  // 名前を足すのは図だけの切替に限る。可視の文字がある側に足すと、名前がそれを含ま**ない**
  function sync() {
    var dark = root.dataset.theme === "dark";
    var all = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < all.length; i += 1) {
      all[i].setAttribute("aria-pressed", dark ? "true" : "false");
      if (all[i].textContent.trim() === "") all[i].setAttribute("aria-label", "ダークテーマ");
    }
  }

  function bar() {
    var here = location.pathname.split("/").pop() || "components.html";
    var items = "";
    for (var i = 0; i < SURFACES.length; i += 1) {
      var file = SURFACES[i][0];
      var selected = file === here ? ' aria-current="page"' : "";
      items +=
        '<a class="rabi-segment-item" href="' +
        file +
        '"' +
        selected +
        ">" +
        SURFACES[i][1] +
        "</a>";
    }
    var el = document.createElement("div");
    el.className = "surface-bar";
    el.innerHTML =
      '<nav class="rabi-segment rabi-segment-sm" aria-label="面">' +
      items +
      "</nav>" +
      '<button type="button" class="rabi-btn rabi-btn-xs rabi-btn-icon rabi-btn-secondary"' +
      ' data-theme-toggle aria-keyshortcuts="t">' +
      SUN +
      "</button>";
    document.body.appendChild(el);
  }

  // 状態を配るのは `sync()` なので、切り替えを注入した後に走らせる
  bar();
  sync();

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-theme-toggle]")) toggle();
  });

  document.addEventListener("keydown", function (e) {
    if (e.isComposing) return;
    if ((e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var t = e.target;
      // select の typeahead も 1 文字キーを使う。奪わ**ない**
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))
        return;
      if (t && (t.isContentEditable || t.closest("[contenteditable]"))) return;
      e.preventDefault();
      toggle();
    }
  });
})();
