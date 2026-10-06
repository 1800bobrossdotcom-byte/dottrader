// Dot Trading Post — The map and the rough location on a profile.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- map ---- */
var mapOn = false, map = null, mapLayer = null, lastShown = [], leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletP) return leafletP;
  leafletP = new Promise(function (res, rej) {
    var css = document.createElement("link"); css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    css.integrity = "sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb"; css.crossOrigin = "anonymous";
    document.head.appendChild(css);
    var js = document.createElement("script"); js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.integrity = "sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO"; js.crossOrigin = "anonymous";
    js.onload = res; js.onerror = function () { leafletP = null; rej(new Error("Could not load the map.")); };
    document.head.appendChild(js);
  });
  return leafletP;
}
$("mapBtn").addEventListener("click", function () {
  mapOn = !mapOn;
  $("mapBtn").setAttribute("aria-pressed", String(mapOn));
  $("mapWrap").hidden = !mapOn;
  if (!mapOn) return;
  loadLeaflet().then(function () {
    if (!map) {
      map = window.L.map("map", { scrollWheelZoom: false });
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      mapLayer = window.L.layerGroup().addTo(map);
    }
    setTimeout(function () { map.invalidateSize(); paintMap(); }, 50);
  }).catch(function (e) { toast(e.message); mapOn = false; $("mapWrap").hidden = true; $("mapBtn").setAttribute("aria-pressed", "false"); });
});
function paintMap() {
  if (!map || !window.L) return;
  mapLayer.clearLayers();
  var pts = [], byOwner = {};
  lastShown.forEach(function (it) {
    var l = locOf(it.owner_id); if (!l) return;
    // Several items from one person share a point; fan them out a touch so each pin is clickable.
    var n = byOwner[it.owner_id] = (byOwner[it.owner_id] || 0) + 1;
    var ang = n * 2.4, r = n > 1 ? 0.004 : 0;
    var lat = l.lat + Math.sin(ang) * r, lng = l.lng + Math.cos(ang) * r;
    var m = window.L.circleMarker([lat, lng], { radius: 9, color: "#121212", weight: 2, fillColor: cssColor(hueOf(it.cat)), fillOpacity: 1 });
    m.bindPopup("<b>" + esc(it.title) + "</b>" + esc(who(it.owner_id)) + (profiles[it.owner_id] && profiles[it.owner_id].area ? " · " + esc(profiles[it.owner_id].area) : "") +
      '<br><a href="#" data-jump="' + esc(it.id) + '">See the listing →</a>');
    mapLayer.addLayer(m); pts.push([lat, lng]);
  });
  var me = locOf(uid);
  if (me) {
    mapLayer.addLayer(window.L.circleMarker([me.lat, me.lng], { radius: 7, color: "#121212", weight: 2, fillColor: "#FFD23F", fillOpacity: 1 }).bindTooltip("You (roughly)"));
    pts.push([me.lat, me.lng]);
  }
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 12 });
  else map.setView([39.5, -98.35], 4);
}
function cssColor(v) {
  // Resolve a var(--x) token to a real colour for Leaflet, which paints SVG attributes.
  var m = /var\((--[\w-]+)\)/.exec(v); if (!m) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#8C867A";
}
document.addEventListener("click", function (e) {
  var j = e.target && e.target.getAttribute && e.target.getAttribute("data-jump");
  if (!j) return;
  e.preventDefault();
  var card = document.querySelector('[data-id="' + j + '"]');
  if (card) { card.scrollIntoView({ block: "center", behavior: "smooth" }); card.classList.add("lit"); setTimeout(function () { card.classList.remove("lit"); }, 2200); }
});

/* ---- location on the profile ---- */
var pendingLoc; // undefined = untouched, null = clear, {lat,lng} = set
function round2(n) { return Math.round(n * 100) / 100; }
function paintLoc() {
  var l = pendingLoc !== undefined ? pendingLoc : locOf(uid);
  $("locState").textContent = l ? "Set · " + l.lat.toFixed(2) + ", " + l.lng.toFixed(2) + (pendingLoc !== undefined ? " (save to keep)" : "") : "Not set";
  $("locClear").hidden = !l;
}
$("locBtn").addEventListener("click", function () {
  if (!navigator.geolocation) return toast("This browser cannot share a location. Try “Find from the area above”.");
  var b = $("locBtn"); b.disabled = true; b.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(function (pos) {
    b.disabled = false; b.textContent = "Use my location";
    pendingLoc = { lat: round2(pos.coords.latitude), lng: round2(pos.coords.longitude) }; paintLoc();
    toast("Got it — rounded to about a kilometre. Save your profile to keep it.");
  }, function (err) {
    b.disabled = false; b.textContent = "Use my location";
    toast(err && err.code === 1 ? "Location was blocked. You can type an area above and use “Find from the area above”." : "Could not get a location.");
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
});
$("locFind").addEventListener("click", function () {
  var q = $("p-area").value.trim(); if (!q) return toast("Type a town or area in “Where you trade” first.");
  var b = $("locFind"); b.disabled = true;
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q), { headers: { "Accept": "application/json" } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      b.disabled = false;
      if (!j || !j[0]) return toast("Could not find that place. Try adding the country or state.");
      pendingLoc = { lat: round2(Number(j[0].lat)), lng: round2(Number(j[0].lon)) }; paintLoc();
      toast("Found " + (j[0].display_name || q).split(",").slice(0, 2).join(",") + ". Save your profile to keep it.");
    }).catch(function () { b.disabled = false; toast("The place lookup did not answer. Try again in a moment."); });
});
$("locClear").addEventListener("click", function () { pendingLoc = null; paintLoc(); });
