// Light / Dark の 2 択。既定は OS の設定に従い、選択は保存しない
(function () {
  "use strict";
  var root = document.documentElement;
  var os = matchMedia("(prefers-color-scheme: dark)");
  var pinned = false;
  var follow = function () {
    if (!pinned) root.dataset.theme = os.matches ? "dark" : "light";
  };
  follow();
  os.addEventListener("change", follow);

  function toggle() {
    pinned = true;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  }

  document.getElementById("theme-toggle").addEventListener("click", toggle);
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
