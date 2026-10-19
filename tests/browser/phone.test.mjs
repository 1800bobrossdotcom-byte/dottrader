// The board on a phone: small cards two to a row that open full width on a tap, a tab bar along
// the bottom where a thumb reaches, and a header with only the name, the language and the wallet.
// On a wide screen nothing of that shows: whole cards, tabs in the header.
import { chromium, VENDOR, OUT, CSP, legacyBoard } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString();
const COLORS = ["#2F56D6", "#E8392B", "#1DB36A", "#FFD23F", "#F2518F", "#27B2E8"];
const pic = (c) => "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="' + c + '"/></svg>');
const TITLES = ["Sega Saturn", "Game Boy Color, Atomic Purple", "Pokémon base set Charizard", "Vintage Polaroid SX-70", "Fender Mustang bass", "Air Jordan 1 Chicago, size 10", "Lego 10179 Millennium Falcon", "Zelda Ocarina of Time cartridge"];
const items = TITLES.map((title, i) => ({ id: "bbbbbbbb-0000-4000-8000-00000000000" + i, owner_id: i % 2 ? A : B, title, descr: "A longer description that only the open card shows, with condition notes.", want: ["N64 games", "Open to offers", "Film cameras", "Anything retro"][i % 4], want_cats: [], open_to_offers: true, cat: "Consoles & Retro", status: "open", photos: i === 3 ? [] : [pic(COLORS[i % 6]), pic(COLORS[(i + 1) % 6])], created_at: now }));
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (c || !x ? "" : "  [" + x + "]"));
const hdr = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

async function open(browser, { width, height, mobile, signedIn = true }) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => res.push("PAGEERROR " + e.message));
  p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  await p.route(/127\.0\.0\.1:8765\/app\.html/, async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, (r) => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, (r) => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\.|functions\/v1/, (r) => r.fulfill({ status: 404, body: "", headers: hdr }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, (r) => {
    const q = r.request(), t = q.url().match(/rest\/v1\/(\w+)/)[1];
    if (q.method() !== "GET" && q.method() !== "HEAD") return r.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers: [], offer_signals: [], profiles: [{ id: A, name: "Alice" }, { id: B, name: "Bartholomew the collector" }] }[t] || []) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ my_matches: [], wanted_counts: [] }[r.request().url().match(/rpc\/(\w+)/)[1]] ?? null) }));
  await p.route(/supabase\.co\/(auth|realtime)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
  await legacyBoard(p);
  await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  if (signedIn) {
    await p.evaluate((s) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), sess);
    await p.goto("about:blank"); await legacyBoard(p);
    await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  }
  await p.waitForTimeout(1800);
  return { ctx, p };
}
const box = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom }; });
const card = (title) => `#feed .item:has(h3:text-is("${title}"))`;

const browser = await chromium.launch({});

// A phone
{
  const { ctx, p } = await open(browser, { width: 390, height: 844, mobile: true });
  const tabs = await box(p, "#tabs");
  ok("the tabs sit along the bottom of the screen", Math.abs(tabs.b - 844) < 2 && tabs.w >= 389, JSON.stringify(tabs));
  ok("…with Profile among them", await p.isVisible("#t-profile"));
  const small = await p.$$eval("#t-browse, #t-post, #t-mine, #t-profile", (x) => x.filter((e) => e.getBoundingClientRect().height < 48).length);
  ok("…each tall enough for a thumb", small === 0);
  const head = await box(p, ".top");
  ok("the header is a slim strip", head.h <= 60, String(Math.round(head.h)));
  ok("…without the profile button or sign-out, which have moved", !(await p.isVisible("#profBtn")) && !(await p.isVisible("#signOut")));
  const cards = await p.$$eval("#feed .item", (x) => x.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), h: Math.round(r.height) }; }));
  ok("listings come two to a row", cards.length === 8 && cards[0].y === cards[1].y && cards[1].x > cards[0].x, JSON.stringify(cards.slice(0, 2)));
  ok("…each small enough that a screen holds several", cards.every((c) => c.h < 330), cards.map((c) => c.h).join(","));
  const first = card(TITLES[1]);
  ok("a small card shows the title, what they want and the trader's dots", await p.isVisible(first + " h3") && await p.isVisible(first + " .side.w") && await p.isVisible(first + " .who .dots"));
  ok("…but not the description or the buttons", !(await p.isVisible(first + " .desc")) && !(await p.isVisible(first + " .share")) && !(await p.isVisible(first + " .gdots")));
  await p.screenshot({ path: OUT + "/phone-board.png" });
  await p.click(first + " .peek"); await p.waitForTimeout(500);
  const opened = await box(p, first);
  ok("tapping a card opens it full width", opened.w > 340 && await p.$eval(first, (e) => e.classList.contains("open")), JSON.stringify(opened));
  ok("…with everything: the description, the photos to swipe, Offer a trade and Share", await p.isVisible(first + " .desc") && await p.isVisible(first + " .gdots") && await p.isVisible(first + " button:has-text('Share')") && !(await p.isVisible(first + " .peek")));
  ok("…scrolled into view below the header", opened.y >= 40 && opened.y < 200, String(Math.round(opened.y)));
  await p.screenshot({ path: OUT + "/phone-open.png" });
  await p.click(card(TITLES[2]) + " .peek"); await p.waitForTimeout(400);
  ok("opening another closes the first", (await p.$$("#feed .item.open")).length === 1 && await p.$eval(card(TITLES[2]), (e) => e.classList.contains("open")));
  await p.click(card(TITLES[2]) + " .shut"); await p.waitForTimeout(300);
  ok("the close button puts it back", (await p.$$("#feed .item.open")).length === 0);
  // the bar works
  await p.click("#t-profile"); await p.waitForTimeout(300);
  ok("Profile in the bar opens the profile page", await p.isVisible("#profile") && (await p.getAttribute("#t-profile", "aria-selected")) === "true");
  ok("…which has the sign-out", await p.isVisible("#signOutP"));
  await p.click("#t-mine"); await p.waitForTimeout(300);
  ok("My trades in the bar", await p.isVisible("#mine"));
  await p.click("#t-post"); await p.waitForTimeout(300);
  ok("the post form fits the screen, with nothing sticking out sideways", await p.isVisible("#postForm") && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), String(await p.evaluate(() => document.documentElement.scrollWidth)));
  await p.evaluate(() => toast("A message"));
  ok("a message pops up above the bar, not over it", (await box(p, ".toast")).b <= (await box(p, "#tabs")).y);
  ok("nothing on the page is hidden behind the bar", await p.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom) >= document.getElementById("tabs").getBoundingClientRect().height - 1));
  await ctx.close();
}

// A visitor's phone: Profile asks for an account
{
  const { ctx, p } = await open(browser, { width: 390, height: 844, mobile: true, signedIn: false });
  await p.click("#t-profile"); await p.waitForTimeout(300);
  ok("a visitor tapping Profile is asked to make an account", !(await p.isVisible("#profile")) && await p.isVisible(".sheet, .veil, #gate").catch(() => false));
  await ctx.close();
}

// A wide screen keeps whole cards and the tabs in the header
{
  const { ctx, p } = await open(browser, { width: 1100, height: 900, mobile: false });
  ok("desktop: the tabs stay in the header", (await box(p, "#tabs")).y < 80 && !(await p.isVisible("#t-profile")));
  ok("desktop: cards are whole, with no tap-to-open layer", await p.isVisible(card(TITLES[1]) + " .desc") && !(await p.isVisible(card(TITLES[1]) + " .peek")));
  ok("desktop: the header keeps profile and sign-out", await p.isVisible("#profBtn") && await p.isVisible("#signOut") && !(await p.isVisible("#signOutP")));
  await ctx.close();
}

await browser.close();
console.log(res.join("\n"));
process.exit(res.some((r) => !r.startsWith("PASS")) ? 1 : 0);
