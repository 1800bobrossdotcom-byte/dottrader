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
    rs.forEach(function (r) { if (r.ok && pendingPhotos.length < 4) pendingPhotos.push(r.url); });
    paintThumbs();
    if (bad.length) {
      var em = bad[0].err && bad[0].err.message ? bad[0].err.message : t("A photo failed to upload.");
      if (/bucket not found/i.test(em)) em = t("Photo storage is not set up on this project yet — run supabase/storage.sql in the SQL editor.");
      toast(em);
    }
    else toast(t("Added."));
  });
});
