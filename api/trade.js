// Dot Trading Post — ways to trade: /trade lists them, /trade/<page> explains one. Each page answers
// what someone searching for it wants to know (how the swap works, what keeps it safe), then shows
// what is up for trade right now, so it is never a page of words with nothing behind it.

const L = require("./_lib.js");

const NFT_CHAINS = "Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche and Zora";
const STEPS_ANY = [
  ["List it", "Say what you have and what you'd take for it. No prices — a want can be a thing, a category, or “open to offers”."],
  ["Get matched", "Dot looks for people who have what you want and want what you have, and tells you who they are."],
  ["Swap", "Agree a trade, send your side by the date, and press your dot when theirs arrives. Two dots and it's on both your records."],
];
const SAFE_ANY = [
  ["A send-by date", "Every agreed trade has one. Miss it and the other side can close the trade as a no-show — and that goes on your record."],
  ["Proof of sending", "A tracking number for a parcel, or the transaction for an NFT, which the board checks on the chain itself."],
  ["A record on every trader", "Dots come only from finished trades and the people you traded with. Nobody can buy them or give themselves one."],
];

const PAGES = {
  "nfts-for-physical-items": {
    title: "Trade NFTs for physical items — swap an NFT for real things",
    h1: "Trade NFTs for physical items",
    short: "NFTs for physical items",
    desc: "Swap an NFT for trading cards, games, consoles or anything real — or a physical item for an NFT. No money, no marketplace fees; the NFT side is checked on chain.",
    lede: "Swap an NFT for a Pokémon card, a console, a watch — or something real for an NFT. You set what you want; the board finds people who have it, and checks the NFT side on chain.",
    cats: ["NFTs"], also: ["Trading Cards", "Consoles & Retro", "Video Games", "Collectibles"],
    sections: [
      ["How a hybrid swap works", "<p>One side sends an NFT from their wallet; the other posts a parcel (or hands it over, if you're local). Both have the same send-by date. The NFT transfer is read straight from the chain — the board checks it reached the other trader's wallet — and the parcel has a tracking number. When each of you has what you were promised, you both press your dot.</p>"],
      ["Why barter instead of selling", "<p>Selling an NFT to buy a physical thing means two sales, two sets of fees and a cash-out in between. A swap is one trade: you give what you have and get what you want. No prices to argue over, either — just whether the trade is fair to both of you.</p>"],
    ],
    faq: [
      ["Do I need to bridge or sell my NFT first?", "No. You send the NFT itself, on whatever chain it's on. The other side sends their item by post or in person."],
      ["How do I know the NFT was really sent?", "When an NFT side is marked sent, the board reads the transaction from the chain and checks that the token went to the other trader's wallet. It shows as delivered only once that's confirmed."],
      ["What stops someone keeping my NFT and never posting?", "Every agreed trade has a send-by date. If they don't send by then, you close the trade as a no-show and it goes on their public record. Check a trader's dots and finished trades before you agree."],
      ["Does it cost anything?", "No. Listing, matching and trading are free. You pay only your own postage and gas."],
    ],
  },
  "nft-swap-cross-chain": {
    title: "Swap NFTs across chains — no bridge needed",
    h1: "Swap NFTs across chains",
    short: "NFTs across chains",
    desc: "Trade an NFT on one chain for an NFT on another — Ethereum, Base, Zora, Polygon and more. No bridge, no wrapped tokens: each side sends on its own chain and both transfers are checked.",
    lede: "Your NFT is on Base and theirs is on Ethereum? Swap anyway. No bridge and no wrapped tokens — each of you sends on your own chain, and the board checks both transfers on chain.",
    cats: ["NFTs"],
    sections: [
      ["How a cross-chain swap works", "<p>Nothing is bridged. When you agree a trade, each side sends their NFT on the chain it already lives on, to the other trader's wallet. The board reads each transaction from its own chain and marks that side delivered once the token has arrived. Works across " + NFT_CHAINS + ".</p>"],
      ["Same chain? One transaction", "<p>When both NFTs are on the same chain, nobody has to send first: the lister signs a swap and the other side completes it in a single transaction. Both NFTs move together, or neither does.</p>"],
    ],
    faq: [
      ["Which chains can I trade across?", "Any pair of " + NFT_CHAINS + ". ERC-721 and ERC-1155 tokens both work."],
      ["Is there a bridge or a wrapped token involved?", "No. Each NFT stays on its own chain and goes straight from one wallet to the other."],
      ["How is my side of the swap checked?", "The board reads your transaction from the chain and checks the token was transferred to the other trader's wallet, after the trade was agreed. Anyone can open the transaction on the chain's explorer."],
      ["Do I have to connect a wallet?", "To list or offer an NFT, yes — you link your wallet once by signing a message (free, no transaction), so others can see you really hold it."],
    ],
  },
  "pokemon-cards": {
    title: "Trade Pokémon cards online — swap, don't sell",
    h1: "Trade Pokémon cards",
    short: "Pokémon cards",
    desc: "Swap Pokémon cards with collectors by post or locally — Charizard, base set, promos, sealed. Say what you have and want; get matched with people who have it. No money.",
    lede: "Got doubles? Chasing one card? List what you have, say what you're after, and get matched with collectors who have it — by post, or with someone near you.",
    cats: ["Trading Cards"], terms: ["pokemon"],
    sections: [
      ["Matching that knows Pokémon", "<p>Write “Charizard”, “pkmn”, “Pokémon TCG” or “base set” — the board understands they're all Pokémon cards. If you want a Charizard, you're matched with Charizards, not every card on the board.</p>"],
      ["Post it or meet up", "<p>Trade by post with a tracking number, or mark a listing local pickup only and swap in person. Either way there's a send-by date, and both of you press your dot when the trade is done.</p>"],
    ],
    faq: [
      ["Can I trade one card for several?", "Yes. An offer can put in up to six of your listings at once, or describe what you're offering in words."],
      ["Can I trade cards for an NFT?", "Yes. Any listing can be traded for any other — cards for cards, cards for an NFT, or an NFT for cards."],
      ["How do I know a trader is reliable?", "Every trader has a record: dots from finished trades, who vouched for them, and any no-shows. It's on their profile and on every listing."],
    ],
  },
  "video-games": {
    title: "Trade video games online — swap games you've finished",
    h1: "Trade video games",
    short: "Video games",
    desc: "Swap the games you've finished for ones you want — Switch, PlayStation, Xbox, retro carts. Matched with people who have them, by post or locally. No money.",
    lede: "Finished it? Swap it. List the games you're done with, say what you want next, and trade with someone who has it — by post or locally.",
    cats: ["Video Games", "Consoles & Retro"],
    sections: [
      ["Names it understands", "<p>“PS5”, “PlayStation 5” and “ps 5” are one thing to the board; so are “Switch” and “Nintendo Switch”. Say it however you say it and the matches still find you.</p>"],
      ["Games for anything", "<p>A game can go for another game, a console, a card, or an NFT. Say what you'd take — or tick “open to other offers” and see what people come up with.</p>"],
    ],
    faq: [
      ["Is it free?", "Yes. No listing fees, no selling fees. You pay only for postage if you post."],
      ["What if the other person doesn't send?", "Every agreed trade has a send-by date. If they miss it, you can close the trade as a no-show and it goes on their record."],
    ],
  },
  "retro-consoles": {
    title: "Trade retro consoles and games — Game Boy, N64, SNES and more",
    h1: "Trade retro consoles and games",
    short: "Retro consoles",
    desc: "Swap retro consoles, handhelds and carts — Game Boy, N64, SNES, PS1, Sega. List what you have, say what you want, and trade with collectors. No money.",
    lede: "A Game Boy for an N64? Carts for a handheld? List your retro gear, say what you're hunting, and trade it with someone who has it.",
    cats: ["Consoles & Retro"], also: ["Video Games"],
    sections: [
      ["Built for collectors", "<p>Add photos and a description of condition, and get a Proof of item badge by photographing it with a code the board gives you — so people know you really have it.</p>"],
      ["Local or by post", "<p>Bulky console? Mark it local pickup only and the board shows how far away each trader is. Otherwise post it with tracking before the send-by date.</p>"],
    ],
    faq: [
      ["What's a Proof of item badge?", "A photo of the thing next to a code the board gave you, checked automatically. It shows the person listing it really has it."],
      ["Can I swap a console for several games?", "Yes — offers can include up to six of your listings, or anything you describe in words."],
    ],
  },
  "barter-online": {
    title: "Barter online — swap things without money",
    h1: "Barter online, without money",
    short: "Barter online",
    desc: "A free barter board: list what you have, say what you want, and get matched with people who have it. Physical things and NFTs, by post or locally. No prices, no money.",
    lede: "No prices, no money — just trades. List what you have, say what you'd take for it, and Dot finds people who have what you want and want what you have.",
    cats: null,
    sections: [
      ["The double-coincidence problem, solved", "<p>Barter's oldest problem is finding someone who has what you want <em>and</em> wants what you have. Tell Dot both halves and it goes looking — including trades where you both want what the other has.</p>"],
      ["Things, NFTs, or both", "<p>Trade physical things for physical things, NFTs across chains, or one for the other. Every listing says what its owner wants, so you know before you ask.</p>"],
    ],
    faq: [
      ["Is bartering online safe?", "Every trade here has a send-by date, proof of sending (tracking, or the transaction checked on chain), and a public record on each trader — dots for finished trades, and no-shows for trades they didn't send."],
      ["Does it cost anything?", "No. It's free to list, match and trade."],
      ["Do I need to install an app?", "No. It works in your phone's browser — sign up with your email."],
    ],
  },
};
const ORDER = ["nfts-for-physical-items", "nft-swap-cross-chain", "pokemon-cards", "video-games", "retro-consoles", "barter-online"];

const steps = (list) => '<ol class="steps3">' + list.map((s, i) => '<li><span class="n">' + (i + 1) + "</span><b>" + L.esc(s[0]) + "</b><p>" + L.esc(s[1]) + "</p></li>").join("") + "</ol>";
const others = (slug) => '<section class="more"><h2>More ways to trade</h2><div class="cats">' +
  ORDER.filter((s) => s !== slug).map((s) => '<a class="catlink" href="/trade/' + s + '">' + L.esc(PAGES[s].short) + "</a>").join("") +
  '<a class="catlink" href="/c">All categories</a></div></section>';

async function listings(p) {
  const q = "items?select=*&status=eq.open&order=created_at.desc&limit=12";
  const get = (extra) => L.rest(q + extra).catch(() => []);
  const inCats = (cats) => "&cat=in.(" + cats.map((c) => '"' + encodeURIComponent(c) + '"').join(",") + ")";
  let rows = await get(p.cats ? inCats(p.cats) + (p.terms ? "&have_terms=cs.{" + p.terms.join(",") + "}" : "") : "");
  if (rows.length < 12 && p.also) rows = rows.concat((await get(inCats(p.also))).slice(0, 12 - rows.length));
  return rows;
}

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const slug = String(q.page || "").toLowerCase();

  if (!slug) {
    const body = '<section class="head"><h1>Ways to trade</h1><p class="lede">Dot Trading Post is a barter board: no money, just swaps. Here is how it works for what you trade.</p></section>' +
      '<div class="ways">' + ORDER.map((s) => '<a class="way" href="/trade/' + s + '"><b>' + L.esc(PAGES[s].h1) + "</b><span>" + L.esc(PAGES[s].desc) + "</span></a>").join("") + "</div>" +
      '<section class="more"><h2>How every trade works</h2>' + steps(STEPS_ANY) + "</section>";
    return L.send(res, 200, L.page({ path: "/trade", title: "Ways to trade — NFTs, cards, games and more | Dot Trading Post",
      desc: "Trade NFTs for physical items, swap NFTs across chains, trade Pokémon cards, video games and retro consoles — or barter anything. No money.", body,
      ld: [{ "@context": "https://schema.org", "@type": "ItemList", itemListElement: ORDER.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: L.SITE + "/trade/" + s, name: PAGES[s].h1 })) }] }), 3600);
  }

  const p = PAGES[slug];
  if (!p) return L.notFound(res, "No such page");
  const rows = await listings(p);
  const path = "/trade/" + slug;
  const board = p.cats && p.cats.length === 1 ? "/app#cat=" + encodeURIComponent(p.cats[0]) : "/app";
  const body =
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/trade">Ways to trade</a></nav>' +
    '<section class="head"><h1>' + L.esc(p.h1) + '</h1><p class="lede">' + L.esc(p.lede) + "</p>" +
      '<div class="acts"><a class="btn" href="/app#post">List something — free</a><a class="btn ghost" href="' + board + '">See the board</a></div></section>' +
    '<section class="more"><h2>How it works</h2>' + steps(STEPS_ANY) + "</section>" +
    p.sections.map((s) => '<section class="more prose"><h2>' + L.esc(s[0]) + "</h2>" + s[1] + "</section>").join("") +
    '<section class="more"><h2>What keeps a trade safe</h2><ul class="safe3">' + SAFE_ANY.map((s) => "<li><b>" + L.esc(s[0]) + "</b> " + L.esc(s[1]) + "</li>").join("") + "</ul></section>" +
    '<section class="more"><h2>' + (rows.length ? "Up for trade now" : "Be the first") + "</h2>" +
      (rows.length ? '<div class="grid">' + rows.map((m) => L.miniCard(m)).join("") + "</div>"
        : '<p class="lede">Nothing listed here yet. Post yours and say what you want for it — the matches come to you.</p>') + "</section>" +
    '<section class="more faq"><h2>Questions</h2>' + p.faq.map((f) => "<details><summary>" + L.esc(f[0]) + "</summary><p>" + L.esc(f[1]) + "</p></details>").join("") + "</section>" +
    '<section class="cta"><h2>Ready to swap?</h2><p class="lede">Free, no app to install. Sign up with your email and list your first thing in a minute.</p><a class="btn" href="/app#post">Start trading — free</a></section>' +
    others(slug);
  const ld = [
    { "@context": "https://schema.org", "@type": "WebPage", name: p.h1, url: L.SITE + path, description: p.desc,
      isPartOf: { "@type": "WebSite", name: "Dot Trading Post", url: L.SITE + "/" } },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f[0], acceptedAnswer: { "@type": "Answer", text: f[1] } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Dot Trading Post", item: L.SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Ways to trade", item: L.SITE + "/trade" },
      { "@type": "ListItem", position: 3, name: p.h1, item: L.SITE + path } ] },
  ];
  L.send(res, 200, L.page({ path, title: p.title + " | Dot Trading Post", ogTitle: p.title, desc: p.desc, ld, body }), 600);
};
module.exports.PAGES = PAGES;
module.exports.ORDER = ORDER;
