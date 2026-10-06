// Dot Trading Post — Proof of item: the one-time code, the photo, the verdict.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- proof of item ----
   The board hands out a one-time code; the owner writes name + date + code by hand and photographs
   it beside the item; an Edge Function has a vision model read it and writes the verdict. Nothing
   in this page can mark anything verified — it can only ask. */
function openVerify(it) {
  var me = profiles[uid] || {};
  if (!me.name) { toast("Set your name in Your standing first — the note has to carry it."); return; }
  var veil = document.createElement("div"); veil.className = "veil";
  var box = document.createElement("div"); box.className = "sheet f";
  box.innerHTML = '<h3>Prove you have it</h3><p class="hint" style="margin:0">Getting you a code…</p>' +
    '<div class="acts"><button class="btn ghost" type="button" data-x>Close</button></div>';
  veil.appendChild(box); document.body.appendChild(veil);
  var close = function () { veil.remove(); };
  box.querySelector("[data-x]").addEventListener("click", close);
  veil.addEventListener("click", function (e) { if (e.target === veil) close(); });

  sb.rpc("start_verification", { p_item: it.id }).then(function (r) {
    if (r.error) { close(); return fail(r.error); }
    var v = (r.data || [])[0];
    if (!v) { close(); return toast("Could not start a proof."); }
    var today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    box.innerHTML =
      "<h3>Prove you have it</h3>" +
      '<p class="hint" style="margin:0">Write these three lines on a piece of paper, <b>by hand</b>, and photograph the note sitting next to <b style="color:var(--ink)">' +
        esc(it.title) + "</b>. The code is new every time and lasts 24 hours, so it cannot be prepared in advance.</p>" +
      '<ol class="proofnote"><li>Your name: <b>' + esc(me.name) + "</b></li><li>Today\u2019s date: <b>" + esc(today) + "</b></li>" +
        '<li>This code: <div style="margin-top:6px"><span class="code">' + esc(v.code) + "</span></div></li></ol>" +
      '<div><label>Photo of the note and the item</label>' +
        '<label class="filebtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>Take the photo</span><input id="v-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label>' +
        '<p class="hint" style="margin:6px 0 0">One original photo from your camera. Screenshots and printed notes do not pass.</p></div>' +
      '<div id="v-out" hidden></div>' +
      '<div class="acts"><button class="btn ghost" type="button" data-x>Close</button></div>';
    box.querySelector("[data-x]").addEventListener("click", close);
    var out = box.querySelector("#v-out"), input = box.querySelector("#v-photo");
    var say = function (html, kind) { out.hidden = false; out.className = "verdict" + (kind ? " " + kind : ""); out.innerHTML = html; };

    input.addEventListener("change", function (e) {
      var f = (e.target.files || [])[0]; e.target.value = "";
      if (!f) return;
      input.disabled = true;
      say("Uploading the photo…");
      var url;
      window.DTP_PHOTOS.upload(sb, uid, f, "proofs").then(function (u) {
        url = u;
        say("Reading the note… this takes about ten seconds.");
        return sb.auth.getSession();
      }).then(function (sr) {
        var token = sr.data && sr.data.session && sr.data.session.access_token;
        if (!token) throw new Error("Your session expired — sign in again.");
        return fetch(cfg.url + "/functions/v1/verify-item", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "apikey": cfg.anonKey },
          body: JSON.stringify({ verification_id: v.id, proof_path: url })
        });
      }).then(function (res) {
        return res.json().then(function (j) { return { status: res.status, body: j || {} }; });
      }).then(function (r) {
        if (r.status >= 400) throw new Error(r.body.error || "The check did not go through.");
        var b = r.body;
        if (b.passed) {
          say("<b>Verified.</b> " + esc(b.summary || "") + " Your listing now carries a Proof of item badge.", "ok");
          toast("Proof of item — verified.");
          load();
          return;
        }
        var why = (b.flags || []).slice(0, 4).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
        say("<b>Not verified this time.</b> " + esc(b.summary || "") + (why ? "<ul>" + why + "</ul>" : "") +
          '<div class="acts" style="margin-top:10px"><button class="btn" type="button" data-again>New code, try again</button></div>', "bad");
        out.querySelector("[data-again]").addEventListener("click", function () { close(); openVerify(it); });
      }).catch(function (err) {
        say(esc(err && err.message ? err.message : "That did not go through."), "bad");
        input.disabled = false;
      });
    });
  });
}
