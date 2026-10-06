// Dot Trading Post — Saving things: posting, profile, editing and removing listings, and loading the board.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

function fail(e) {
  console.error(e);
  toast(e && e.message ? e.message.slice(0, 90) : "That did not save.");
}
function call(fn, id, okMsg) {
  sb.rpc(fn, { p_offer: id }).then(function (r) {
    if (r.error) return fail(r.error);
    if (okMsg) toast(okMsg);
    load();
  });
}

$("postForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if (!uid) return;
  var title = $("f-title").value.trim(); if (!title) return;
  var isAsset = $("f-isasset").checked;
  if (isAsset && !myWallet()) { toast("Connect your wallet first — a digital listing is checked against it."); return; }
  var asset;
  try {
    asset = readAsset({ kind: $("f-kind"), chain: $("f-chain"), contract: $("f-contract"), tokid: $("f-tokid") }, isAsset);
  } catch (e) { toast(e.message); return; }
  var btn = $("postBtn"); btn.disabled = true;
  var rec = {
    owner_id: uid, title: title, descr: $("f-desc").value.trim(),
    want: $("f-want").value.trim(), cat: $("f-cat").value
  };
  // Only sent when there are photos, so a project that has not run storage.sql can still post.
  if (pendingPhotos.length) rec.photos = pendingPhotos.slice(0, 4);
  if (caps.matching) { rec.want_cats = postPicker.get(); rec.open_to_offers = $("f-open").checked; }
  Object.keys(asset).forEach(function (k) { rec[k] = asset[k]; });
  sb.from("items").insert(rec).then(function (r) {
    btn.disabled = false;
    if (r.error) {
      if (/'photos' column/.test(r.error.message || "")) return toast("Photo storage is not set up on this project yet — run supabase/storage.sql in the SQL editor.");
      return fail(r.error);
    }
    $("postForm").reset(); $("f-cat").value = "Other"; $("f-assetfields").hidden = true;
    pendingPhotos = []; paintThumbs();
    postPicker.set([]); $("f-open").checked = true;
    toast("Posted to the board."); show("browse"); load();
  });
});

$("profForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if (!uid) return;
  var rec = {
    id: uid, name: $("p-name").value.trim() || null,
    area: $("p-area").value.trim(), note: $("p-note").value.trim(), updated_at: new Date().toISOString()
  };
  if (pendingLoc !== undefined) { rec.lat = pendingLoc ? pendingLoc.lat : null; rec.lng = pendingLoc ? pendingLoc.lng : null; }
  sb.from("profiles").upsert(rec).then(function (r) {
    if (r.error) {
      if (/'(lat|lng)' column/.test(r.error.message || "")) return toast("Location is not set up on this project yet — run supabase/location.sql in the SQL editor.");
      return fail(r.error);
    }
    pendingLoc = undefined; toast("Profile saved."); load();
  });
});

function openEdit(it) {
  var veil = document.createElement("div"); veil.className = "veil";
  var form = document.createElement("form"); form.className = "sheet f";
  var photos = (it.photos || []).slice();
  form.innerHTML =
    "<h3>Edit listing</h3>" +
    '<div><label for="e-title">What you are offering</label><input id="e-title" maxlength="80" required></div>' +
    '<div><label for="e-desc">Details</label><textarea id="e-desc" maxlength="600"></textarea></div>' +
    '<div class="rowf"><div><label for="e-want">What you want back</label><input id="e-want" maxlength="80"></div>' +
    '<div><label for="e-cat">Category</label><select id="e-cat"></select></div></div>' +
    '<div' + (caps.matching ? "" : " hidden") + '><label>Categories you\u2019d take</label><div class="chips pickchips" id="e-wantcats"></div>' +
      '<label class="tick" style="margin-top:10px"><input type="checkbox" id="e-open"> <span>Open to other offers too</span></label></div>' +
    '<div' + (caps.photos ? "" : " hidden") + '><label>Photos <span class="hint">— up to 4</span></label><div class="thumbs" id="e-thumbs"></div>' +
    '<label class="filebtn" style="margin-top:10px"><span>Add photos</span><input id="e-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div>' +
    '<div class="acts"><button class="btn ok" type="submit">Save changes</button><button class="btn ghost" type="button" data-x>Cancel</button></div>';
  veil.appendChild(form); document.body.appendChild(veil);
  var q = function (id) { return form.querySelector("#" + id); };
  groupedOptions(q("e-cat"), null);
  var editPicker = catPicker(q("e-wantcats"), it.want_cats || []); q("e-open").checked = it.open_to_offers !== false;
  q("e-title").value = it.title || ""; q("e-desc").value = it.descr || ""; q("e-want").value = it.want || ""; q("e-cat").value = it.cat || "Other";
  var close = function () { veil.remove(); };
  form.querySelector("[data-x]").addEventListener("click", close);
  veil.addEventListener("click", function (e) { if (e.target === veil) close(); });
  function paint() {
    var host = q("e-thumbs"); host.innerHTML = "";
    photos.forEach(function (u, i) {
      var w = document.createElement("div"); w.className = "thumb";
      var img = document.createElement("img"); img.src = u; img.alt = "";
      var x = document.createElement("button"); x.type = "button"; x.className = "thumbx"; x.textContent = "×"; x.title = "Remove";
      x.addEventListener("click", function () { photos.splice(i, 1); paint(); });
      w.appendChild(img); w.appendChild(x); host.appendChild(w);
    });
    q("e-photos").disabled = photos.length >= 4;
  }
  paint();
  q("e-photos").addEventListener("change", function (e) {
    var files = Array.prototype.slice.call(e.target.files || []).slice(0, 4 - photos.length); e.target.value = "";
    if (!files.length) return;
    toast("Uploading…");
    Promise.all(files.map(function (f) { return window.DTP_PHOTOS.upload(sb, uid, f).catch(function (err) { toast(err.message || "Upload failed."); return null; }); }))
      .then(function (us) { us.forEach(function (u) { if (u && photos.length < 4) photos.push(u); }); paint(); });
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var title = q("e-title").value.trim(); if (!title) return;
    var rec = { title: title, descr: q("e-desc").value.trim(), want: q("e-want").value.trim(), cat: q("e-cat").value };
    if (caps.matching) { rec.want_cats = editPicker.get(); rec.open_to_offers = q("e-open").checked; }
    // Only send photos when the project has the column (it exists once storage.sql has run).
    if (photos.length || (it.photos && it.photos.length)) rec.photos = photos.slice(0, 4);
    sb.from("items").update(rec).eq("id", it.id).then(function (r) {
      if (r.error) {
        if (/'photos' column/.test(r.error.message || "")) return toast("Photo storage is not set up yet — run supabase/storage.sql.");
        return fail(r.error);
      }
      close(); toast("Saved."); load();
    });
  });
}

function removeItem(it) {
  if (!confirm("Remove \u201c" + it.title + "\u201d from the board? Pending offers on it go with it.")) return;
  // remove_item() deletes a listing nobody traded on, and otherwise takes it off the board while
  // keeping its trade history (no-shows and finished trades are part of other people's records).
  sb.rpc("remove_item", { p_item: it.id }).then(function (r) {
    if (r.error && r.error.code === "PGRST202") {
      return sb.from("items").delete().eq("id", it.id).then(function (d) { if (d.error) return fail(d.error); toast("Listing removed."); load(); });
    }
    if (r.error) return fail(r.error);
    toast(r.data === "removed" ? "Taken off the board. Its trade history stays on record." : "Listing removed."); load();
  });
}

function load() {
  return Promise.all([
    sb.from("items").select("*").order("created_at", { ascending: false }).limit(400),
    // Only the viewer's own offers come back here — the policy sees to that.
    sb.from("offers").select("*").order("created_at", { ascending: false }).limit(800),
    sb.from("profiles").select("*").limit(800),
    // The public half of every offer: enough to count dots, nothing anyone said.
    sb.from("offer_signals").select("*").limit(2000),
    // Which items carry a proof: the photo and the one-line read, never the code.
    sb.from("verification_badges").select("*").limit(2000),
    // Only threads the viewer is part of — messages.sql makes sure of that.
    uid && caps.messages ? sb.from("messages").select("*").order("created_at", { ascending: true }).limit(3000) : Promise.resolve({ data: [] }),
    uid && caps.bond ? sb.from("bonds").select("*").limit(2000) : Promise.resolve({ data: [] }),
    uid && caps.bond ? sb.from("payouts").select("*").limit(200) : Promise.resolve({ data: [] })
  ]).then(function (r) {
    if (r[0].error || r[1].error || r[2].error) {
      note("Could not load the board. If this is the first run, check the schema was applied in Supabase.", "bad");
      return;
    }
    items = r[0].data || []; offers = r[1].data || [];
    // If privacy.sql has not been run yet the view is missing; fall back to what we can see so
    // the board still works, just with dots counted only from the viewer's own trades.
    signals = r[3].error ? offers : (r[3].data || []);
    // Missing until verify.sql has been run; the board just shows no badges.
    badges = {}; (r[4].error ? [] : (r[4].data || [])).forEach(function (b) { badges[b.item_id] = b; });
    msgs = {}; (r[5].error ? [] : (r[5].data || [])).forEach(function (m) { (msgs[m.offer_id] = msgs[m.offer_id] || []).push(m); });
    bondsBy = {}; (r[6].error ? [] : (r[6].data || [])).forEach(function (b) { (bondsBy[b.offer_id] = bondsBy[b.offer_id] || []).push(b); });
    payouts = r[7].error ? [] : (r[7].data || []);
    profiles = {}; (r[2].data || []).forEach(function (p) { profiles[p.id] = p; });
    if (uid && !profTouched) { profTouched = true; $("profWrap").open = !(profiles[uid] && profiles[uid].name); }
    if (uid) paintLoc();
    if (uid && profiles[uid]) {
      if (!$("p-name").value) $("p-name").value = profiles[uid].name || "";
      if (!$("p-area").value) $("p-area").value = profiles[uid].area || "";
      if (!$("p-note").value) $("p-note").value = profiles[uid].note || "";
    }
    render();
    loadMatches();
  });
}
