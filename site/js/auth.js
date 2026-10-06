// Dot Trading Post — Accounts: password, emailed code, reset, and what signing in or out changes.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- accounts ----
   Password first: a link-only login means a fresh email every time someone signs out or picks up
   another device, and the link opens in whatever browser the mail app chooses. The emailed code
   is the way in for anyone without a password yet, and it works in any browser. */
var authBox = null, authEmail = "";
function hasAccountHint() { try { return localStorage.getItem("dtp-has-account") === "1"; } catch (e) { return false; } }
function pwAskedKey() { return "dtp-pw-asked-" + uid; }
function authErr(e) {
  var m = (e && e.message) || "That did not work.";
  if (/rate limit/i.test(m)) return "Too many emails in a short time. Wait a minute and try again.";
  if (/invalid login credentials/i.test(m)) return "That email and password don’t match. If you’ve only ever signed in with email links you don’t have a password yet — use “Email me a code”, then set one.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first — the confirmation is in your inbox. Or use “Email me a code”.";
  if (/expired|invalid.*(otp|token)|token.*invalid/i.test(m)) return "That code is wrong or has expired. Send yourself a new one.";
  if (/already (been )?registered/i.test(m)) return "There’s already an account with that email. Sign in instead.";
  if (/password should be/i.test(m)) return "Use at least 8 characters for the password.";
  if (/signups? (not allowed|disabled)/i.test(m)) return "New accounts are switched off on this board right now.";
  return m;
}
function needAccount(reason, then) {
  afterAuth = then || null;
  openAuth(hasAccountHint() ? "signin" : "signup", reason);
}
function closeAuth() { if (authBox) { authBox.veil.remove(); authBox = null; } }
function openAuth(mode, reason) {
  if (!authBox) {
    var veil = document.createElement("div"); veil.className = "veil";
    var form = document.createElement("form"); form.className = "sheet f";
    veil.appendChild(form); document.body.appendChild(veil);
    veil.addEventListener("click", function (e) { if (e.target === veil && authBox && authBox.mode !== "newpass") closeAuth(); });
    authBox = { veil: veil, form: form, sent: false };
  }
  if (mode !== "code") authBox.sent = false;
  authBox.mode = mode;
  if (reason !== undefined) authBox.reason = reason;
  paintAuth();
}
function paintAuth() {
  var b = authBox, f = b.form, m = b.mode;
  var em = function (ac) { return '<div><label for="a-email">Email</label><input id="a-email" type="email" required autocomplete="' + (ac || "email") + '" value="' + esc(authEmail) + '" placeholder="you@example.com"></div>'; };
  var pw = function (ac, label) { return '<div><label for="a-pass">' + (label || "Password") + '</label><input id="a-pass" type="password" required minlength="8" autocomplete="' + ac + '"' + (ac === "new-password" ? ' placeholder="At least 8 characters"' : "") + "></div>"; };
  var links = function (l) { return '<div class="authlinks">' + l.map(function (x) { return '<button type="button" class="linkbtn" data-mode="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>"; };
  var reason = b.reason ? '<p class="hint" style="margin:0">' + esc(b.reason) + "</p>" : "";
  var close = m === "newpass" ? "" : '<button class="btn ghost" type="button" data-x>' + (m === "setpass" ? "Not now" : "Close") + "</button>";
  var h = "";
  if (m === "signin") h = "<h3>Sign in</h3>" + reason + em() + pw("current-password") + msgSlot() +
    '<div class="acts"><button class="btn ok" type="submit">Sign in</button>' + close + "</div>" +
    links([["forgot", "Forgot password?"], ["code", "Email me a code instead"], ["signup", "New here? Create an account"]]);
  else if (m === "signup") h = "<h3>Create an account</h3>" + reason + em() + pw("new-password") + msgSlot() +
    '<p class="hint" style="margin:0">We email you once to confirm it’s really you. After that you just sign in with your password.</p>' +
    '<div class="acts"><button class="btn ok" type="submit">Create account</button>' + close + "</div>" +
    links([["signin", "Already have an account? Sign in"]]);
  else if (m === "code" && !b.sent) h = "<h3>Sign in with a code</h3>" + reason + em() + msgSlot() +
    '<p class="hint" style="margin:0">We email you a short code. Type it here — it works in any browser, so it doesn’t matter where your mail app opens links.</p>' +
    '<div class="acts"><button class="btn ok" type="submit">Email me a code</button>' + close + "</div>" +
    links([["signin", "Use my password instead"]]);
  else if (m === "code") h = "<h3>Enter your code</h3>" +
    '<p class="hint" style="margin:0">Sent to <b>' + esc(authEmail) + "</b>. The email has a link too — either works.</p>" +
    '<div><label for="a-code">Code</label><input id="a-code" class="codein" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,10}" maxlength="10" placeholder="123456"></div>' + msgSlot() +
    '<div class="acts"><button class="btn ok" type="submit">Sign in</button>' + close + "</div>" +
    links([["code-again", "Send a new code"], ["code-other", "Use a different email"]]);
  else if (m === "checkemail") h = "<h3>Check your inbox</h3>" +
    '<p class="hint" style="margin:0">We sent a confirmation to <b>' + esc(authEmail) + "</b>. Tap its link, or type the code from it here. You only do this once — from then on it’s just your password.</p>" +
    '<div><label for="a-code">Code from the email</label><input id="a-code" class="codein" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" placeholder="123456"></div>' + msgSlot() +
    '<div class="acts"><button class="btn ok" type="submit">Confirm</button>' + close + "</div>";
  else if (m === "forgot") h = "<h3>Reset your password</h3>" + em() + msgSlot() +
    '<p class="hint" style="margin:0">We email you a link that brings you back here to choose a new one. If you never set a password, this sets your first.</p>' +
    '<div class="acts"><button class="btn ok" type="submit">Email me a reset link</button>' + close + "</div>" +
    links([["signin", "Back to sign in"]]);
  else if (m === "newpass") h = "<h3>Choose a new password</h3>" + pw("new-password", "New password") + msgSlot() +
    '<div class="acts"><button class="btn ok" type="submit">Save password</button></div>';
  else if (m === "setpass") h = "<h3>You’re in. Make next time one step?</h3>" +
    '<p class="hint" style="margin:0">Set a password and you can sign straight back in, on any device, without waiting for an email.</p>' +
    pw("new-password") + msgSlot() + '<div class="acts"><button class="btn ok" type="submit">Set password</button>' + close + "</div>";
  f.innerHTML = h;
  var e1 = f.querySelector("#a-email"); if (e1) e1.addEventListener("input", function () { authEmail = e1.value.trim(); });
  Array.prototype.forEach.call(f.querySelectorAll("[data-mode]"), function (x) {
    x.addEventListener("click", function () {
      var to = x.getAttribute("data-mode");
      if (to === "code-again" || to === "code-other") { b.sent = false; if (to === "code-other") authEmail = ""; return paintAuth(); }
      openAuth(to);
    });
  });
  var xb = f.querySelector("[data-x]");
  if (xb) xb.addEventListener("click", function () { if (m === "setpass") markPwAsked(); closeAuth(); });
  f.onsubmit = function (e) { e.preventDefault(); submitAuth(); };
  setTimeout(function () {
    var first = f.querySelector(m === "code" && b.sent || m === "checkemail" ? "#a-code" : (authEmail && f.querySelector("#a-pass") ? "#a-pass" : "input"));
    if (first) first.focus();
  }, 30);
}
function msgSlot() { return '<p class="authmsg" id="a-msg" hidden></p>'; }
function say(text, bad) { var el = authBox && authBox.form.querySelector("#a-msg"); if (!el) return toast(text); el.textContent = text; el.className = "authmsg" + (bad ? " bad" : ""); el.hidden = false; }
function markPwAsked() { try { localStorage.setItem(pwAskedKey(), "1"); } catch (e) {} }
function busy(on) { var btn = authBox && authBox.form.querySelector('button[type="submit"]'); if (btn) btn.disabled = on; }
function submitAuth() {
  var b = authBox, f = b.form, m = b.mode;
  var val = function (id) { var el = f.querySelector(id); return el ? el.value : ""; };
  if (f.querySelector("#a-email")) authEmail = val("#a-email").trim();
  var redirect = location.origin + "/app";
  busy(true);
  var done = function (r) { busy(false); return r; };
  if (m === "signin") {
    sb.auth.signInWithPassword({ email: authEmail, password: val("#a-pass") }).then(done).then(function (r) {
      if (r.error) return say(authErr(r.error), true);
      closeAuth();
    });
  } else if (m === "signup") {
    sb.auth.signUp({ email: authEmail, password: val("#a-pass"), options: { emailRedirectTo: redirect } }).then(done).then(function (r) {
      if (r.error) return say(authErr(r.error), true);
      if (r.data && r.data.session) { markPwAsked(); return closeAuth(); }
      // Supabase answers an existing address with an empty identity list rather than an error.
      if (r.data && r.data.user && r.data.user.identities && r.data.user.identities.length === 0)
        return say("There’s already an account with that email. Sign in — or if you’ve only ever used email links, use “Email me a code”.", true);
      openAuth("checkemail");
    });
  } else if (m === "code" && !b.sent) {
    sb.auth.signInWithOtp({ email: authEmail, options: { emailRedirectTo: redirect, shouldCreateUser: true } }).then(done).then(function (r) {
      if (r.error) return say(authErr(r.error), true);
      b.sent = true; paintAuth();
    });
  } else if (m === "code" || m === "checkemail") {
    var token = val("#a-code").replace(/\D/g, "");
    if (!token) { busy(false); return say("Type the code from the email, or tap the link in it.", true); }
    sb.auth.verifyOtp({ email: authEmail, token: token, type: "email" }).then(function (r) {
      return r.error && m === "checkemail" ? sb.auth.verifyOtp({ email: authEmail, token: token, type: "signup" }) : r;
    }).then(done).then(function (r) {
      if (r.error) return say(authErr(r.error), true);
      if (m === "checkemail") { markPwAsked(); return closeAuth(); }
      if (isPwAsked()) return closeAuth();
      openAuth("setpass", "");
    });
  } else if (m === "forgot") {
    sb.auth.resetPasswordForEmail(authEmail, { redirectTo: redirect }).then(done).then(function (r) {
      if (r.error) return say(authErr(r.error), true);
      say("Sent. The link in that email brings you back here to choose a password.");
    });
  } else if (m === "newpass" || m === "setpass") {
    sb.auth.updateUser({ password: val("#a-pass") }).then(done).then(function (r) {
      if (r.error) return say(authErr(r.error), true);
      markPwAsked(); closeAuth(); toast("Password saved. Next time, just sign in with it.");
    });
  }
}
function isPwAsked() { try { return localStorage.getItem(pwAskedKey()) === "1"; } catch (e) { return false; } }
$("signInTop").addEventListener("click", function () { afterAuth = null; openAuth(hasAccountHint() ? "signin" : "signup", ""); });
Array.prototype.forEach.call(document.querySelectorAll("[data-auth]"), function (x) {
  x.addEventListener("click", function () { afterAuth = null; openAuth(x.getAttribute("data-auth"), ""); });
});
$("npBtn").addEventListener("click", function () {
  var pw = $("np-pass").value;
  if (pw.length < 8) return toast("Use at least 8 characters.");
  var b = $("npBtn"); b.disabled = true;
  sb.auth.updateUser({ password: pw }).then(function (r) {
    b.disabled = false;
    if (r.error) return fail(r.error);
    $("np-pass").value = ""; markPwAsked(); toast("Password set. Next time you can sign in with it.");
  });
});
$("signOut").addEventListener("click", function () {
  sb.auth.signOut().then(function () { location.reload(); });
});

// Called on every auth event, including the silent hourly token refresh. Only a change of WHO is
// signed in resets the view — before, every refresh threw people back to the Board tab mid-task.
var lastUid = "boot";
function enter(session) {
  var signedIn = !!(session && session.user);
  var newUid = signedIn ? session.user.id : null;
  var changed = newUid !== lastUid;
  lastUid = newUid; uid = newUid;
  myEmail = signedIn ? (session.user.email || "") : "";
  $("gate").hidden = signedIn;
  // Visitors get the tabs too: the board and its activity are public; posting and trading ask for an account.
  $("tabs").hidden = false;
  $("me").hidden = !signedIn;
  $("signInTop").hidden = signedIn;
  applyCaps();
  if (!changed) return;
  profTouched = false; profNotifySet = false; threadOpen = {}; drafts = {};
  ["p-name", "p-area", "p-note"].forEach(function (id) { $(id).value = ""; });
  if (signedIn) {
    try { localStorage.setItem("dtp-has-account", "1"); } catch (e) {}
    loadSeen();
    $("meName").textContent = "· " + myEmail;
    show("browse");
  } else {
    $("post").hidden = true; $("mine").hidden = true; $("activity").hidden = true; $("browse").hidden = false;
  }
  var then = signedIn ? afterAuth : null; afterAuth = null;
  load().then(function () {
    if (signedIn && (stripeBack.session || stripeBack.cancelled || stripeBack.payout)) {
      var sb2 = stripeBack; stripeBack = {};
      if (sb2.cancelled) toast("No hold was placed.");
      if (sb2.session) bondCall({ action: "confirm", session_id: sb2.session }).then(function (j) {
        toast(j.status === "held" ? "Your bond is in place — the other side can see it." : "The card hold didn’t go through. Nothing was charged."); show("mine"); load();
      }).catch(fail);
      if (sb2.payout) { show("mine"); claimPayout(); }
    }
    if (then) then();
    else if (signedIn && (arrivedBy === "magiclink" || arrivedBy === "signup") && !isPwAsked() && !authBox) openAuth("setpass", "");
    arrivedBy = "";
  });
}
