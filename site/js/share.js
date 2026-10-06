// Dot Trading Post — the Share button on public listing pages: the phone's share sheet where there
// is one, otherwise copy the link.
"use strict";
(function () {
  var b = document.querySelector("[data-share]");
  if (!b) return;
  b.hidden = false;
  b.addEventListener("click", function () {
    var url = location.origin + location.pathname, title = document.title.replace(/ \| Dot Trading Post$/, "");
    if (navigator.share) return navigator.share({ title: title, url: url }).catch(function () {});
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
      b.textContent = "Link copied"; setTimeout(function () { b.textContent = "Share"; }, 2000);
    }, function () { window.prompt("Copy this link:", url); });
  });
})();
