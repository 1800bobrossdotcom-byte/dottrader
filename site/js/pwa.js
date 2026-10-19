// Dot Trading Post — the board as an app on a phone: the service worker (sw.js), and an offer to
// install it, shown on the board and on the profile page when the browser says installing is
// possible (Android's Chrome, Edge, Samsung Internet). "Not now" hides the offer for a month.
"use strict";
(function () {
  if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  var later = 0; try { later = Number(localStorage.getItem("dtp-install-no")) || 0; } catch (e) {}
  var asked = null;
  var paint = function () {
    var bar = document.getElementById("installBar"), prof = document.getElementById("p-installwrap");
    if (bar) bar.hidden = !asked || Date.now() - later < 30 * 864e5;
    if (prof) prof.hidden = !asked;
  };
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); asked = e; paint(); });
  window.addEventListener("appinstalled", function () { asked = null; paint(); });
  var install = function () {
    if (!asked) return;
    var a = asked; asked = null; paint();
    a.prompt();
    a.userChoice.then(function (c) { if (c.outcome !== "accepted") { asked = a; paint(); } }).catch(function () {});
  };
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("#installBtn, #p-installBtn, #installNo");
    if (!b) return;
    if (b.id === "installNo") { later = Date.now(); try { localStorage.setItem("dtp-install-no", String(later)); } catch (x) {} paint(); return; }
    install();
  });
})();
