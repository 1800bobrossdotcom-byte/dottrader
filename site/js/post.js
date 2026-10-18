// Dot Trading Post — Photos on the post form: uploaded the moment they are picked.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- photos ---- */
// Uploaded the moment they are picked, so posting is instant and a failed upload is seen
// while the person is still looking at the form rather than after they hit Post.
var pendingPhotos = [];
function paintThumbs() {
  var host = $("f-thumbs");
  host.innerHTML = "";
  pendingPhotos.forEach(function (u, i) {
    var w = document.createElement("div"); w.className = "thumb";
    var img = document.createElement("img"); img.src = u; img.alt = "";
    var x = document.createElement("button"); x.type = "button"; x.className = "thumbx"; x.textContent = "×";
    x.title = t("Remove");
    x.addEventListener("click", function () { pendingPhotos.splice(i, 1); paintThumbs(); });
    w.appendChild(img); w.appendChild(x); host.appendChild(w);
  });
  $("f-photos").disabled = pendingPhotos.length >= 4;
}
$("f-photos").addEventListener("change", function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;
  if (!uid || !sb) { toast(t("Sign in first.")); return; }
  var room = 4 - pendingPhotos.length;
  if (files.length > room) { toast(room ? tn(room, "Only {n} more photo fits.", "Only {n} more photos fit.") : t("Four photos is the limit.")); files = files.slice(0, room); }
  if (!files.length) return;
  toast(tn(files.length, "Uploading {n} photo…", "Uploading {n} photos…"));
  var P = window.DTP_PHOTOS;
  Promise.all(files.map(function (f) {
    return P.upload(sb, uid, f).then(function (u) { return { ok: true, url: u }; },
                                    function (err) { return { ok: false, err: err }; });
  })).then(function (rs) {
    var bad = rs.filter(function (r) { return !r.ok; });
    var first = !pendingPhotos.length && rs.filter(function (r) { return r.ok; })[0];
    rs.forEach(function (r) { if (r.ok && pendingPhotos.length < 4) pendingPhotos.push(r.url); });
    paintThumbs();
    if (first) readPhoto(first.url);
    if (bad.length) {
      var em = bad[0].err && bad[0].err.message ? bad[0].err.message : t("A photo failed to upload.");
      if (/bucket not found/i.test(em)) em = t("Photo storage is not set up on this project yet — run supabase/storage.sql in the SQL editor.");
      toast(em);
    }
    else toast(t("Added."));
  });
});

/* ---- start from a photo ----
   The first photo of a physical thing is read by the vision function (verify-item, action
   "describe"), which suggests a title, category and details. Only empty fields are filled, and the
   form says where they came from, so the person checks them rather than trusting them. */
function readPhoto(url) {
  var note = $("f-photonote");
  if (!caps.verify || $("f-isasset").checked || $("f-title").value.trim()) return;
  var say = function (msg) { note.textContent = msg; note.hidden = !msg; };
  say(t("Reading your photo…"));
  var cats = [].concat.apply([], GROUPS.map(function (g) { return g[1]; })).filter(function (c) { return c !== "NFTs"; });
  sb.auth.getSession().then(function (sr) {
    var token = sr.data && sr.data.session && sr.data.session.access_token;
    if (!token) throw new Error("no session");
    return fetch(fnUrl("verify"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: cfg.anonKey },
      body: JSON.stringify({ action: "describe", photo_url: url, cats: cats, lang: LANG }) });
  }).then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, j: j || {} }; }); }).then(function (r) {
    // Only the day's allowance is worth saying; anything else (an older function that doesn't read
    // photos yet, a hiccup) just leaves the form for the person to fill in.
    if (!r.ok) return say(r.status === 429 ? t("That's enough photo reads for today — fill it in yourself.") : "");
    if (!r.j.sure || !r.j.title) return say(t("Couldn't tell what that is from the photo — name it yourself."));
    var filled = false;
    if (!$("f-title").value.trim()) { $("f-title").value = r.j.title; filled = true; }
    if (r.j.category && $("f-cat").value === "Other" && !$("f-cat").disabled) { $("f-cat").value = r.j.category; filled = true; }
    if (r.j.details && !$("f-desc").value.trim()) { $("f-desc").value = r.j.details; $("f-desc").closest("details").open = true; filled = true; }
    say(filled ? t("Filled in from your photo — check it before you post.") : "");
  }).catch(function () { say(""); });
}
