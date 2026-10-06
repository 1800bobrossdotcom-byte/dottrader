// Dot Trading Post — the public pages' one script: the Share button on listing pages (the phone's
// share sheet where there is one, otherwise copy the link), and NFT tiles that fall back cleanly.
"use strict";
// NFT artwork that can't be drawn turns back into the plain tile instead of a broken image.
Array.prototype.forEach.call(document.querySelectorAll("img[data-art]"), function (img) {
  var swap = function () { var s = document.createElement("span"); s.className = "noimg"; s.setAttribute("aria-hidden", "true"); img.replaceWith(s); };
  if (img.complete && !img.naturalWidth) swap(); else img.addEventListener("error", swap);
});
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
