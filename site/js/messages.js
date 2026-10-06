// Dot Trading Post — Private message threads on offers.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- messages ----
   One thread per offer, readable and writable only by its two parties (messages.sql). Agreed
   trades open their thread by default: that is the moment people need to talk. */
function seenKey() { return "dtp-seen-" + uid; }
function loadSeen() { try { seen = JSON.parse(localStorage.getItem(seenKey()) || "{}") || {}; } catch (e) { seen = {}; } }
function markSeen(id) {
  var t = msgs[id] || []; if (!t.length) return;
  seen[id] = t[t.length - 1].created_at;
  try { localStorage.setItem(seenKey(), JSON.stringify(seen)); } catch (e) {}
}
function unreadIn(id) {
  var mark = seen[id] || "";
  return (msgs[id] || []).filter(function (m) { return m.from_id !== uid && m.created_at > mark; }).length;
}
function threadEl(o, other) {
  var t = msgs[o.id] || [];
  var open = threadOpen[o.id] !== undefined ? threadOpen[o.id] : o.status === "agreed";
  var fresh = unreadIn(o.id);
  if (open) markSeen(o.id);
  var box = document.createElement("div"); box.className = "thread";
  var tog = document.createElement("button"); tog.type = "button"; tog.className = "linkbtn threadtog";
  tog.innerHTML = esc(open ? "Hide messages" : (t.length ? "Messages (" + t.length + ")" : "Message " + who(other))) +
    (!open && fresh ? '<span class="newdot">' + fresh + " new</span>" : "");
  tog.addEventListener("click", function () { threadOpen[o.id] = !open; render(); if (!open) setTimeout(function () { var i = $("m-" + o.id); if (i) i.focus(); }, 30); });
  box.appendChild(tog);
  if (!open) return box;
  var list = document.createElement("div"); list.className = "msgs";
  if (!t.length) {
    var hint = document.createElement("p"); hint.className = "threadhint";
    hint.textContent = o.status === "agreed" ? "You've agreed. Sort out where and when to meet, or how you'll each post." : "Ask a question, or suggest a tweak to the offer.";
    list.appendChild(hint);
  }
  t.forEach(function (m) {
    var bub = document.createElement("div"); bub.className = "bub" + (m.from_id === uid ? " me" : "");
    bub.textContent = m.body;
    var when = document.createElement("small"); when.textContent = (m.from_id === uid ? "You" : who(m.from_id)) + " · " + ago(m.created_at);
    bub.appendChild(when); list.appendChild(bub);
  });
  box.appendChild(list);
  requestAnimationFrame(function () { list.scrollTop = list.scrollHeight; });
  var form = document.createElement("form"); form.className = "msgform";
  var input = document.createElement("input"); input.id = "m-" + o.id; input.maxLength = 1000; input.autocomplete = "off";
  input.placeholder = "Write to " + who(other) + "…"; input.value = drafts[o.id] || "";
  input.addEventListener("input", function () { drafts[o.id] = input.value; });
  var send = document.createElement("button"); send.className = "btn ok"; send.type = "submit"; send.textContent = "Send";
  form.appendChild(input); form.appendChild(send);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var body = input.value.trim(); if (!body) return;
    send.disabled = true;
    sb.from("messages").insert({ offer_id: o.id, from_id: uid, body: body }).then(function (r) {
      send.disabled = false;
      if (r.error) return fail(r.error);
      drafts[o.id] = ""; input.value = "";
      (msgs[o.id] = msgs[o.id] || []).push({ offer_id: o.id, from_id: uid, body: body, created_at: new Date().toISOString() });
      render(); setTimeout(function () { var i = $("m-" + o.id); if (i) i.focus(); }, 0);
      load();
    });
  });
  box.appendChild(form);
  return box;
}
