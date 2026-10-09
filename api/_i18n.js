// Dot Trading Post — the public pages in other languages: English at /, Spanish at /es, Japanese at
// /ja, Brazilian Portuguese at /pt. Written, not machine-translated; i18n/GLOSSARY.md fixes the
// words each language uses for the board's own ideas (dots, offers, no-shows…) so they never drift.

const CATS_I18N = require("../site/i18n/cats.json");

const LANGS = ["en", "es", "ja", "pt"];
const META = {
  en: { hreflang: "en", name: "English", og: "en_US", date: "en-US" },
  es: { hreflang: "es", name: "Español", og: "es_ES", date: "es-ES" },
  ja: { hreflang: "ja", name: "日本語", og: "ja_JP", date: "ja-JP" },
  pt: { hreflang: "pt-BR", name: "Português", og: "pt_BR", date: "pt-BR" },
};

const S = {
  // Around every page
  "nav.board": { en: "Open the board", es: "Abrir el tablón", ja: "ボードを開く", pt: "Abrir o mural" },
  "brand.small": { en: "BARTER BOARD", es: "TABLÓN DE TRUEQUES", ja: "物々交換ボード", pt: "MURAL DE TROCAS" },
  "foot.how": { en: "How it works", es: "Cómo funciona", ja: "使い方", pt: "Como funciona" },
  "foot.board": { en: "The board", es: "El tablón", ja: "ボード", pt: "O mural" },
  "foot.ways": { en: "Ways to trade", es: "Formas de intercambiar", ja: "交換のしかた", pt: "Jeitos de trocar" },
  "foot.stickers": { en: "Stickers", es: "Pegatinas", ja: "ステッカー", pt: "Adesivos" },
  "foot.terms": { en: "Terms", es: "Términos", ja: "利用規約", pt: "Termos" },
  "foot.makers": { en: "From the makers of", es: "De los creadores de", ja: "制作：", pt: "Dos criadores do" },
  "foot.lang": { en: "Language", es: "Idioma", ja: "言語", pt: "Idioma" },
  "crumb.home": { en: "Home", es: "Inicio", ja: "ホーム", pt: "Início" },
  "crumb.all": { en: "All categories", es: "Todas las categorías", ja: "すべてのカテゴリー", pt: "Todas as categorias" },
  "share": { en: "Share", es: "Compartir", ja: "シェア", pt: "Compartilhar" },

  // What a listing wants
  "want.open": { en: "Open to offers", es: "Abierto a ofertas", ja: "オファー歓迎", pt: "Aberto a propostas" },
  "want.any": { en: "Any {cats}", es: "Cualquier cosa de {cats}", ja: "{cats}なら何でも", pt: "Qualquer coisa de {cats}" },
  "want.orAny": { en: "or any {cats}", es: "o cualquier cosa de {cats}", ja: "または{cats}なら何でも", pt: "ou qualquer coisa de {cats}" },
  "want.alsoOpen": { en: "open to other offers", es: "abierto a otras ofertas", ja: "ほかのオファーも歓迎", pt: "aberto a outras propostas" },
  "mini.wants": { en: "Wants", es: "Busca", ja: "希望", pt: "Quer" },
  "mini.local": { en: "Local", es: "En mano", ja: "手渡し", pt: "Em mãos" },
  "list.sep": { en: ", ", es: ", ", ja: "、", pt: ", " },

  // Not found / busy
  "nf.title": { en: "Not here — Dot Trading Post", es: "No está aquí — Dot Trading Post", ja: "見つかりません — Dot Trading Post", pt: "Não está aqui — Dot Trading Post" },
  "nf.desc": { en: "This page isn't on the board.", es: "Esta página no está en el tablón.", ja: "このページはボードにありません。", pt: "Esta página não está no mural." },
  "nf.gone": { en: "It may have been traded or taken down.", es: "Puede que ya se haya intercambiado o que lo hayan retirado.", ja: "すでに交換済みか、取り下げられた可能性があります。", pt: "Talvez já tenha sido trocado ou retirado." },
  "nf.see": { en: "See what is on the board", es: "Ver lo que hay en el tablón", ja: "ボードを見る", pt: "Ver o que está no mural" },
  "nf.nothing": { en: "Nothing here", es: "Aquí no hay nada", ja: "何もありません", pt: "Nada aqui" },
  "nf.category": { en: "No such category", es: "Esa categoría no existe", ja: "そのカテゴリーはありません", pt: "Essa categoria não existe" },
  "nf.listing": { en: "No such listing", es: "Ese anuncio no existe", ja: "その出品はありません", pt: "Esse anúncio não existe" },
  "nf.removed": { en: "This listing was taken down", es: "Este anuncio se retiró", ja: "この出品は取り下げられました", pt: "Este anúncio foi retirado" },
  "nf.page": { en: "No such page", es: "Esa página no existe", ja: "そのページはありません", pt: "Essa página não existe" },
  "busy.h": { en: "The board is busy", es: "El tablón está ocupado", ja: "ボードが混み合っています", pt: "O mural está ocupado" },
  "busy.p": { en: "Try again in a moment.", es: "Vuelve a intentarlo en un momento.", ja: "少し待ってからもう一度お試しください。", pt: "Tente de novo daqui a pouco." },

  // Category pages
  "c.allH1": { en: "Everything up for trade", es: "Todo lo que se intercambia", ja: "交換できるものすべて", pt: "Tudo o que está para troca" },
  "c.allLede": { en: "Swap what you have for what you want. Pick a corner of the board.", es: "Cambia lo que tienes por lo que quieres. Elige un rincón del tablón.", ja: "持っているものを、欲しいものと交換しましょう。カテゴリーを選んでください。", pt: "Troque o que você tem pelo que você quer. Escolha um canto do mural." },
  "c.allTitle": { en: "Everything up for trade — Dot Trading Post", es: "Todo lo que se intercambia — Dot Trading Post", ja: "交換できるものすべて — Dot Trading Post", pt: "Tudo o que está para troca — Dot Trading Post" },
  "c.allDesc": { en: "Browse what people are swapping on Dot Trading Post: trading cards, video games, retro consoles, collectibles and more. No money — just trades.",
    es: "Mira lo que la gente intercambia en Dot Trading Post: cartas coleccionables, videojuegos, consolas retro, coleccionables y más. Sin dinero, solo trueques.",
    ja: "Dot Trading Postで交換されているものを見てみましょう。トレカ、ゲームソフト、レトロゲーム機、コレクターズアイテムなど。お金は使わず、交換だけ。",
    pt: "Veja o que a galera está trocando no Dot Trading Post: cards colecionáveis, videogames, consoles retrô, colecionáveis e mais. Sem dinheiro — só trocas." },
  "c.h1": { en: "{cat} up for trade", es: "{cat} para intercambiar", ja: "交換できる{cat}", pt: "{cat} para trocar" },
  "c.lede": { en: "Swap for them — no money, just trades. Each listing says what its owner wants.", es: "Consíguelos con un trueque: sin dinero, solo intercambios. Cada anuncio dice qué busca su dueño.", ja: "お金を使わず、交換で手に入れましょう。各出品に、出品者の希望が書かれています。", pt: "Consiga com uma troca — sem dinheiro. Cada anúncio diz o que o dono quer em troca." },
  "c.empty": { en: "Nothing in {cat} right now. Be the first: list something and say what you want for it.", es: "Ahora mismo no hay nada en {cat}. Sé el primero: publica algo y di qué quieres a cambio.", ja: "現在{cat}の出品はありません。最初の出品者になりましょう。出品して、欲しいものを書くだけです。", pt: "Nada em {cat} agora. Seja o primeiro: anuncie algo e diga o que você quer em troca." },
  "c.nftLede": { en: "Swap NFTs across {n} chains, or for physical things. No bridge: each side sends on its own chain and the board checks both. ",
    es: "Intercambia NFTs entre {n} cadenas, o por cosas físicas. Sin puente: cada parte envía en su propia cadena y el tablón comprueba ambos envíos. ",
    ja: "{n}つのチェーンをまたいでNFTを交換したり、現物と交換したりできます。ブリッジは不要。それぞれが自分のチェーンで送り、ボードが両方の送付をオンチェーンで確認します。",
    pt: "Troque NFTs entre {n} redes, ou por coisas físicas. Sem ponte: cada lado envia na sua própria rede e o mural confere os dois envios. " },
  "c.open": { en: "Open these on the board", es: "Verlos en el tablón", ja: "ボードで見る", pt: "Ver no mural" },
  "c.list": { en: "List something", es: "Publicar algo", ja: "出品する", pt: "Anunciar algo" },
  "c.newer": { en: "Newer", es: "Más recientes", ja: "新しい出品", pt: "Mais recentes" },
  "c.older": { en: "Older", es: "Anteriores", ja: "以前の出品", pt: "Anteriores" },
  "c.title": { en: "{cat} up for trade — swap, don't sell | Dot Trading Post", es: "{cat} para intercambiar: cambia, no vendas | Dot Trading Post", ja: "{cat}を交換 — 売らずにトレード | Dot Trading Post", pt: "{cat} para trocar — troque, não venda | Dot Trading Post" },
  "c.desc": { en: "Trade {cat} with people near you or by post. ", es: "Intercambia {cat} con gente cerca de ti o por correo. ", ja: "{cat}を、近くの人と手渡しで、または郵送で交換できます。", pt: "Troque {cat} com gente perto de você ou pelo correio. " },
  "c.descNft": { en: "Swap NFTs across chains, or for physical things — no bridge, no money; every NFT transfer is checked on chain. ",
    es: "Intercambia NFTs entre cadenas, o por cosas físicas: sin puente y sin dinero; cada transferencia de NFT se comprueba en la cadena. ",
    ja: "チェーンをまたいだNFT交換も、現物との交換もOK。ブリッジもお金も不要で、NFTの送付はすべてオンチェーンで確認されます。",
    pt: "Troque NFTs entre redes, ou por coisas físicas — sem ponte, sem dinheiro; toda transferência de NFT é conferida na blockchain. " },
  "c.descN": { en: "{n} listings, each saying what its owner wants in return. ", es: "{n} anuncios, y cada uno dice qué busca su dueño a cambio. ", ja: "{n}件の出品があり、それぞれに出品者の希望が書かれています。", pt: "{n} anúncios, cada um dizendo o que o dono quer em troca. " },
  "c.descEnd": { en: "No money — just swaps, and a trade record on every trader.", es: "Sin dinero: solo trueques, y un historial de intercambios en cada usuario.", ja: "お金は不要。交換だけで、すべてのトレーダーに取引履歴があります。", pt: "Sem dinheiro — só trocas, e um histórico de trocas em cada pessoa." },
  "c.other": { en: "other things", es: "otras cosas", ja: "その他のもの", pt: "outras coisas" },

  // A listing's page
  "kind.erc721": { en: "NFT", es: "NFT", ja: "NFT", pt: "NFT" },
  "kind.erc1155": { en: "Multi-edition NFT", es: "NFT de varias ediciones", ja: "エディションNFT", pt: "NFT de várias edições" },
  "kind.erc20": { en: "Tokens", es: "Tokens", ja: "トークン", pt: "Tokens" },
  "asset.on": { en: "{kind} on {chain}", es: "{kind} en {chain}", ja: "{chain}の{kind}", pt: "{kind} na {chain}" },
  "asset.checks": { en: "— the board checks on chain that the lister still holds it", es: "— el tablón comprueba en la cadena que quien lo anuncia todavía lo tiene", ja: "— 出品者がまだ保有しているか、ボードがオンチェーンで確認します", pt: "— o mural confere na blockchain que quem anunciou ainda tem o item" },
  "state.open": { en: "On the board", es: "En el tablón", ja: "出品中", pt: "No mural" },
  "state.pledged": { en: "Agreed — awaiting delivery", es: "Acordado: pendiente de entrega", ja: "成立 — 受け渡し待ち", pt: "Combinado — aguardando entrega" },
  "state.traded": { en: "Traded", es: "Intercambiado", ja: "交換済み", pt: "Trocado" },
  "i.photos": { en: "{title} photos", es: "Fotos de {title}", ja: "{title}の写真", pt: "Fotos de {title}" },
  "i.photoN": { en: "{title} — photo {i} of {n}", es: "{title}: foto {i} de {n}", ja: "{title} — 写真 {i}/{n}", pt: "{title} — foto {i} de {n}" },
  "i.swipe1": { en: "Swipe for 1 more photo", es: "Desliza para ver 1 foto más", ja: "スワイプでもう1枚", pt: "Deslize para ver mais 1 foto" },
  "i.swipeN": { en: "Swipe for {n} more photos", es: "Desliza para ver {n} fotos más", ja: "スワイプであと{n}枚", pt: "Deslize para ver mais {n} fotos" },
  "i.local": { en: "Local pickup only", es: "Solo entrega en mano", ja: "手渡しのみ", pt: "Só retirada em mãos" },
  "i.localTitle": { en: "No shipping — handed over in person", es: "Sin envío: se entrega en persona", ja: "発送なし — 直接手渡し", pt: "Sem envio — entregue pessoalmente" },
  "i.proof": { en: "Proof of item", es: "Prueba del artículo", ja: "現物証明", pt: "Prova do item" },
  "i.proofTitle": { en: "The lister photographed this item next to a handwritten note with a one-time code.", es: "Quien lo anuncia fotografió el artículo junto a una nota escrita a mano con un código de un solo uso.", ja: "出品者が、ワンタイムコードを手書きしたメモと一緒にこの品物を撮影しています。", pt: "Quem anunciou fotografou o item ao lado de um bilhete escrito à mão com um código de uso único." },
  "i.offering": { en: "Offering", es: "Ofrece", ja: "出品", pt: "Oferece" },
  "i.traded": { en: "Traded for <b>{give}</b> with <b>{who}</b>", es: "Intercambiado por <b>{give}</b> con <b>{who}</b>", ja: "<b>{who}</b>さんと<b>{give}</b>で交換済み", pt: "Trocado por <b>{give}</b> com <b>{who}</b>" },
  "i.another": { en: "another trader", es: "otro usuario", ja: "別のトレーダー", pt: "outra pessoa" },
  "i.aTrader": { en: "A trader", es: "Un usuario", ja: "トレーダー", pt: "Uma pessoa" },
  "i.listedBy": { en: "Listed by <b>{name}</b>", es: "Publicado por <b>{name}</b>", ja: "出品者：<b>{name}</b>", pt: "Anunciado por <b>{name}</b>" },
  "i.offer": { en: "Make an offer", es: "Hacer una oferta", ja: "オファーする", pt: "Fazer uma proposta" },
  "i.seeElse": { en: "See what else is up for trade", es: "Ver qué más se intercambia", ja: "ほかの出品を見る", pt: "Ver o que mais está para troca" },
  "i.fine": { en: "No money changes hands here — it’s a swap. Offers, messages and the trade itself happen on the board, where every trader’s record of trades, no-shows and vouches is on their cards.",
    es: "Aquí no se paga con dinero: es un trueque. Las ofertas, los mensajes y el intercambio se hacen en el tablón, donde cada usuario muestra su historial de intercambios, plantones y avales.",
    ja: "ここではお金のやり取りはありません。交換です。オファー、メッセージ、取引はすべてボード上で行われ、各トレーダーの取引数・未発送・評価がカードに表示されます。",
    pt: "Aqui não rola dinheiro — é troca. Propostas, mensagens e a troca em si acontecem no mural, onde cada pessoa mostra seu histórico de trocas, furos e avais." },
  "i.safely": { en: "Trading safely", es: "Intercambiar con seguridad", ja: "安全な交換のために", pt: "Trocar com segurança" },
  "i.more": { en: "More {cat} up for trade", es: "Más {cat} para intercambiar", ja: "ほかの{cat}の出品", pt: "Mais {cat} para trocar" },
  "i.all": { en: "All {cat}", es: "Todo en {cat}", ja: "{cat}をすべて見る", pt: "Tudo em {cat}" },
  "i.title": { en: "{title} — up for trade", es: "{title}: para intercambiar", ja: "{title} — 交換受付中", pt: "{title} — para trocar" },
  "i.desc": { en: "Up for trade: {title}. ", es: "Para intercambiar: {title}. ", ja: "交換受付中：{title}。", pt: "Para trocar: {title}. " },
  "i.descOpen": { en: "Open to offers.", es: "Abierto a ofertas.", ja: "オファー歓迎。", pt: "Aberto a propostas." },
  "i.descWants": { en: "Wants {want}.", es: "Busca: {want}.", ja: "希望：{want}。", pt: "Quer: {want}." },
};

function langOf(q) { const l = String((q && q.lang) || "").toLowerCase(); return LANGS.includes(l) ? l : "en"; }
const prefix = (lang) => (lang && lang !== "en" ? "/" + lang : "");
function t(lang, key, vars) {
  const e = S[key]; if (!e) throw new Error("no string " + key);
  let s = e[lang] != null ? e[lang] : e.en;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}
function catName(lang, cat) { const c = CATS_I18N.cats[cat]; return (lang !== "en" && c && c[lang]) || cat; }
function groupName(lang, g) { const c = CATS_I18N.groups[g]; return (lang !== "en" && c && c[lang]) || g; }
// "Things up for trade" pages in one language, at the same address in every other.
function alternates(path) { return LANGS.map((l) => ({ lang: META[l].hreflang, href: prefix(l) + (path === "/" && l !== "en" ? "/" : path) })); }

module.exports = { LANGS, META, S, langOf, prefix, t, catName, groupName, alternates };
