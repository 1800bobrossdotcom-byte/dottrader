// Dot Trading Post — the words of the "ways to trade" pages (api/trade.js), in each language.
// Each language has the same shape; i18n/GLOSSARY.md fixes the terms. The HTML in `sections` is
// written here, never built from anything a visitor sent.

const CH = {
  en: "Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche and Zora",
  es: "Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche y Zora",
  ja: "Ethereum、Base、Arbitrum、Optimism、Polygon、BNB Chain、Avalanche、Zora",
  pt: "Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche e Zora",
};

module.exports = {
  en: {
    ui: {
      crumb: "Ways to trade", how: "How it works", safe: "What keeps a trade safe", now: "Up for trade now", first: "Be the first",
      empty: "Nothing listed here yet. Post yours and say what you want for it — the matches come to you.",
      faq: "Questions", ready: "Ready to swap?", readyLede: "Free, no app to install. Sign up with your email and list your first thing in a minute.",
      start: "Start trading — free", list: "List something — free", board: "See the board", more: "More ways to trade", all: "All categories",
      indexH1: "Ways to trade", indexLede: "Dot Trading Post is a barter board: no money, just swaps. Here is how it works for what you trade.",
      indexHow: "How every trade works", indexTitle: "Ways to trade — NFTs, cards, games and more | Dot Trading Post",
      indexDesc: "Trade NFTs for physical items, swap NFTs across chains, trade Pokémon cards, video games and retro consoles — or barter anything. No money.",
    },
    steps: [
      ["List it", "Say what you have and what you'd take for it. No prices — a want can be a thing, a category, or “open to offers”."],
      ["Get matched", "Dot looks for people who have what you want and want what you have, and tells you who they are."],
      ["Swap", "Agree a trade, send your side by the date, and press your dot when theirs arrives. Two dots and it's on both your records."],
    ],
    safe: [
      ["A send-by date", "Every agreed trade has one. Miss it and the other side can close the trade as a no-show — and that goes on your record."],
      ["Proof of sending", "A tracking number for a parcel, or the transaction for an NFT, which the board checks on the chain itself."],
      ["A record on every trader", "Dots come only from finished trades and the people you traded with. Nobody can buy them or give themselves one."],
    ],
    pages: {
      "nfts-for-physical-items": {
        title: "Trade NFTs for physical items — swap an NFT for real things", h1: "Trade NFTs for physical items", short: "NFTs for physical items",
        desc: "Swap an NFT for trading cards, games, consoles or anything real — or a physical item for an NFT. No money between traders, no listing or selling fees; the NFT side is checked on chain.",
        lede: "Swap an NFT for a Pokémon card, a console, a watch — or something real for an NFT. You set what you want; the board finds people who have it, and checks the NFT side on chain.",
        sections: [
          ["How a hybrid swap works", "<p>One side sends an NFT from their wallet; the other posts a parcel (or hands it over, if you're local). Both have the same send-by date. The NFT transfer is read straight from the chain — the board checks it reached the other trader's wallet — and the parcel has a tracking number. When each of you has what you were promised, you both press your dot.</p>"],
          ["Why barter instead of selling", "<p>Selling an NFT to buy a physical thing means two sales, two sets of fees and a cash-out in between. A swap is one trade: you give what you have and get what you want. No prices to argue over, either — just whether the trade is fair to both of you.</p>"],
        ],
        faq: [
          ["Do I need to bridge or sell my NFT first?", "No. You send the NFT itself, on whatever chain it's on. The other side sends their item by post or in person."],
          ["How do I know the NFT was really sent?", "When an NFT side is marked sent, the board reads the transaction from the chain and checks that the token went to the other trader's wallet. It shows as delivered only once that's confirmed."],
          ["What stops someone keeping my NFT and never posting?", "Every agreed trade has a send-by date. If they don't send by then, you close the trade as a no-show and it goes on their public record. Check a trader's dots and finished trades before you agree."],
          ["Does it cost anything?", "No. Listing, matching and trading are free. You pay only your own postage and gas. Two optional extras carry a small flat fee: completing an NFT-for-NFT swap on chain (paid by whoever completes it), and — where offered — protecting a trade with a card hold."],
        ],
      },
      "nft-swap-cross-chain": {
        title: "Swap NFTs across chains — no bridge needed", h1: "Swap NFTs across chains", short: "NFTs across chains",
        desc: "Trade an NFT on one chain for an NFT on another — Ethereum, Base, Zora, Polygon and more. No bridge, no wrapped tokens: each side sends on its own chain and both transfers are checked.",
        lede: "Your NFT is on Base and theirs is on Ethereum? Swap anyway. No bridge and no wrapped tokens — each of you sends on your own chain, and the board checks both transfers on chain.",
        sections: [
          ["How a cross-chain swap works", "<p>Nothing is bridged. When you agree a trade, each side sends their NFT on the chain it already lives on, to the other trader's wallet. The board reads each transaction from its own chain and marks that side delivered once the token has arrived. Works across " + CH.en + ".</p>"],
          ["Same chain? One transaction", "<p>When both NFTs are on the same chain, nobody has to send first: the lister signs a swap and the other side completes it in a single transaction. Both NFTs move together, or neither does.</p>"],
        ],
        faq: [
          ["Which chains can I trade across?", "Any pair of " + CH.en + ". ERC-721 and ERC-1155 tokens both work."],
          ["Is there a bridge or a wrapped token involved?", "No. Each NFT stays on its own chain and goes straight from one wallet to the other."],
          ["How is my side of the swap checked?", "The board reads your transaction from the chain and checks the token was transferred to the other trader's wallet, after the trade was agreed. Anyone can open the transaction on the chain's explorer."],
          ["Do I have to connect a wallet?", "To list or offer an NFT, yes — you link your wallet once by signing a message (free, no transaction), so others can see you really hold it."],
        ],
      },
      "pokemon-cards": {
        title: "Trade Pokémon cards online — swap, don't sell", h1: "Trade Pokémon cards", short: "Pokémon cards",
        desc: "Swap Pokémon cards with collectors by post or locally — Charizard, base set, promos, sealed. Say what you have and want; get matched with people who have it. No money.",
        lede: "Got doubles? Chasing one card? List what you have, say what you're after, and get matched with collectors who have it — by post, or with someone near you.",
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
        title: "Trade video games online — swap games you've finished", h1: "Trade video games", short: "Video games",
        desc: "Swap the games you've finished for ones you want — Switch, PlayStation, Xbox, retro carts. Matched with people who have them, by post or locally. No money.",
        lede: "Finished it? Swap it. List the games you're done with, say what you want next, and trade with someone who has it — by post or locally.",
        sections: [
          ["Names it understands", "<p>“PS5”, “PlayStation 5” and “ps 5” are one thing to the board; so are “Switch” and “Nintendo Switch”. Say it however you say it and the matches still find you.</p>"],
          ["Games for anything", "<p>A game can go for another game, a console, a card, or an NFT. Say what you'd take — or tick “open to other offers” and see what people come up with.</p>"],
        ],
        faq: [
          ["Is it free?", "Yes. No listing fees, no selling fees. You pay only for postage if you post. Two optional extras carry a small flat fee: completing an NFT-for-NFT swap on chain, and — where offered — protecting a trade with a card hold."],
          ["What if the other person doesn't send?", "Every agreed trade has a send-by date. If they miss it, you can close the trade as a no-show and it goes on their record."],
        ],
      },
      "retro-consoles": {
        title: "Trade retro consoles and games — Game Boy, N64, SNES and more", h1: "Trade retro consoles and games", short: "Retro consoles",
        desc: "Swap retro consoles, handhelds and carts — Game Boy, N64, SNES, PS1, Sega. List what you have, say what you want, and trade with collectors. No money.",
        lede: "A Game Boy for an N64? Carts for a handheld? List your retro gear, say what you're hunting, and trade it with someone who has it.",
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
        title: "Barter online — swap things without money", h1: "Barter online, without money", short: "Barter online",
        desc: "A free barter board: list what you have, say what you want, and get matched with people who have it. Physical things and NFTs, by post or locally. No prices, no money.",
        lede: "No prices, no money — just trades. List what you have, say what you'd take for it, and Dot finds people who have what you want and want what you have.",
        sections: [
          ["The double-coincidence problem, solved", "<p>Barter's oldest problem is finding someone who has what you want <em>and</em> wants what you have. Tell Dot both halves and it goes looking — including trades where you both want what the other has.</p>"],
          ["Things, NFTs, or both", "<p>Trade physical things for physical things, NFTs across chains, or one for the other. Every listing says what its owner wants, so you know before you ask.</p>"],
        ],
        faq: [
          ["Is bartering online safe?", "Every trade here has a send-by date, proof of sending (tracking, or the transaction checked on chain), and a public record on each trader — dots for finished trades, and no-shows for trades they didn't send."],
          ["Does it cost anything?", "No. It's free to list, match and trade. Two optional extras carry a small flat fee: completing an NFT-for-NFT swap on chain, and — where offered — protecting a trade with a card hold."],
          ["Do I need to install an app?", "No. It works in your phone's browser — sign up with your email."],
        ],
      },
    },
  },

  es: {
    ui: {
      crumb: "Formas de intercambiar", how: "Cómo funciona", safe: "Qué protege cada intercambio", now: "Para intercambiar ahora", first: "Sé el primero",
      empty: "Todavía no hay nada aquí. Publica lo tuyo y di qué quieres a cambio: las coincidencias te llegan solas.",
      faq: "Preguntas", ready: "¿Listo para intercambiar?", readyLede: "Gratis y sin instalar nada. Regístrate con tu correo y publica tu primera cosa en un minuto.",
      start: "Empieza a intercambiar gratis", list: "Publica algo gratis", board: "Ver el tablón", more: "Más formas de intercambiar", all: "Todas las categorías",
      indexH1: "Formas de intercambiar", indexLede: "Dot Trading Post es un tablón de trueques: sin dinero, solo intercambios. Así funciona según lo que quieras cambiar.",
      indexHow: "Cómo funciona cada intercambio", indexTitle: "Formas de intercambiar: NFTs, cartas, videojuegos y más | Dot Trading Post",
      indexDesc: "Cambia NFTs por objetos físicos, intercambia NFTs entre cadenas, cartas Pokémon, videojuegos y consolas retro, o haz trueque con lo que sea. Sin dinero.",
    },
    steps: [
      ["Publícalo", "Di qué tienes y qué aceptarías a cambio. Sin precios: puedes buscar una cosa concreta, una categoría o estar «abierto a ofertas»."],
      ["Encuentra con quién", "Dot busca a gente que tiene lo que quieres y quiere lo que tienes, y te dice quiénes son."],
      ["Intercambia", "Acuerden el intercambio, envía tu parte antes de la fecha y pulsa tu punto cuando llegue lo suyo. Con los dos puntos, queda en el historial de ambos."],
    ],
    safe: [
      ["Una fecha límite de envío", "Todo intercambio acordado la tiene. Si no envías a tiempo, la otra parte puede cerrarlo como plantón, y eso queda en tu historial."],
      ["Prueba de envío", "Un número de seguimiento para un paquete, o la transacción de un NFT, que el tablón comprueba directamente en la cadena."],
      ["Un historial en cada usuario", "Los puntos solo salen de intercambios terminados y de la gente con la que cambiaste. Nadie puede comprarlos ni dárselos a sí mismo."],
    ],
    pages: {
      "nfts-for-physical-items": {
        title: "Cambia NFTs por objetos físicos: un NFT por cosas reales", h1: "Cambia NFTs por objetos físicos", short: "NFTs por objetos físicos",
        desc: "Cambia un NFT por cartas, videojuegos, consolas o cualquier cosa real, o un objeto físico por un NFT. Sin dinero entre quienes intercambian y sin comisiones por publicar ni vender; la parte NFT se comprueba en la cadena.",
        lede: "Cambia un NFT por una carta Pokémon, una consola o un reloj, o algo real por un NFT. Tú decides qué quieres; el tablón encuentra a quien lo tiene y comprueba la parte NFT en la cadena.",
        sections: [
          ["Cómo funciona un intercambio híbrido", "<p>Una parte envía un NFT desde su wallet; la otra manda un paquete (o lo entrega en mano, si están cerca). Las dos tienen la misma fecha límite de envío. La transferencia del NFT se lee directamente de la cadena —el tablón comprueba que llegó a la wallet de la otra persona— y el paquete lleva número de seguimiento. Cuando cada uno tiene lo prometido, los dos pulsan su punto.</p>"],
          ["Por qué hacer trueque en lugar de vender", "<p>Vender un NFT para comprar algo físico son dos ventas, dos comisiones y pasar por efectivo entre medias. Un trueque es un solo intercambio: das lo que tienes y recibes lo que quieres. Y sin discutir precios: solo si el cambio es justo para los dos.</p>"],
        ],
        faq: [
          ["¿Tengo que pasar mi NFT por un puente o venderlo antes?", "No. Envías el NFT tal cual, en la cadena donde esté. La otra parte envía su artículo por correo o en mano."],
          ["¿Cómo sé que el NFT se envió de verdad?", "Cuando la parte NFT se marca como enviada, el tablón lee la transacción en la cadena y comprueba que el token llegó a la wallet de la otra persona. Solo aparece como entregado cuando eso está confirmado."],
          ["¿Qué impide que alguien se quede mi NFT y nunca envíe nada?", "Todo intercambio acordado tiene fecha límite de envío. Si no envían a tiempo, lo cierras como plantón y queda en su historial público. Mira los puntos y los intercambios terminados de alguien antes de aceptar."],
          ["¿Cuesta algo?", "No. Publicar, encontrar coincidencias e intercambiar es gratis. Solo pagas tu propio envío y el gas. Dos extras opcionales llevan una pequeña comisión fija: completar un intercambio NFT por NFT en la cadena (la paga quien lo completa) y, donde se ofrezca, proteger un intercambio con una retención en la tarjeta."],
        ],
      },
      "nft-swap-cross-chain": {
        title: "Intercambia NFTs entre cadenas, sin puentes", h1: "Intercambia NFTs entre cadenas", short: "NFTs entre cadenas",
        desc: "Cambia un NFT de una cadena por un NFT de otra: Ethereum, Base, Zora, Polygon y más. Sin puentes ni tokens envueltos: cada parte envía en su propia cadena y se comprueban ambas transferencias.",
        lede: "¿Tu NFT está en Base y el suyo en Ethereum? Intercambien igual. Sin puentes ni tokens envueltos: cada uno envía en su propia cadena y el tablón comprueba las dos transferencias.",
        sections: [
          ["Cómo funciona un intercambio entre cadenas", "<p>No se usa ningún puente. Al acordar el intercambio, cada parte envía su NFT en la cadena donde ya está, a la wallet de la otra persona. El tablón lee cada transacción en su propia cadena y marca esa parte como entregada cuando el token ha llegado. Funciona entre " + CH.es + ".</p>"],
          ["¿Misma cadena? Una sola transacción", "<p>Si los dos NFTs están en la misma cadena, nadie tiene que enviar primero: quien publicó firma el intercambio y la otra parte lo completa en una sola transacción. Los dos NFTs se mueven a la vez, o no se mueve ninguno.</p>"],
        ],
        faq: [
          ["¿Entre qué cadenas puedo intercambiar?", "Entre cualquier par de " + CH.es + ". Sirven tokens ERC-721 y ERC-1155."],
          ["¿Hay algún puente o token envuelto de por medio?", "No. Cada NFT se queda en su cadena y va directamente de una wallet a la otra."],
          ["¿Cómo se comprueba mi parte del intercambio?", "El tablón lee tu transacción en la cadena y comprueba que el token se transfirió a la wallet de la otra persona después de acordar el intercambio. Cualquiera puede abrir la transacción en el explorador de la cadena."],
          ["¿Tengo que conectar una wallet?", "Para publicar u ofrecer un NFT, sí: vinculas tu wallet una sola vez firmando un mensaje (gratis, sin transacción), para que los demás vean que de verdad lo tienes."],
        ],
      },
      "pokemon-cards": {
        title: "Intercambia cartas Pokémon online: cambia, no vendas", h1: "Intercambia cartas Pokémon", short: "Cartas Pokémon",
        desc: "Cambia cartas Pokémon con otros coleccionistas por correo o en persona: Charizard, set base, promos, producto sellado. Di qué tienes y qué buscas, y encuentra a quien lo tiene. Sin dinero.",
        lede: "¿Tienes repetidas? ¿Buscas una carta concreta? Publica lo que tienes, di qué te falta y encuentra coleccionistas que la tienen, por correo o cerca de ti.",
        sections: [
          ["Coincidencias que entienden de Pokémon", "<p>Escribe «Charizard», «pkmn», «Pokémon TCG» o «set base»: el tablón entiende que todo son cartas Pokémon. Si buscas un Charizard, te salen Charizards, no todas las cartas del tablón.</p>"],
          ["Por correo o en mano", "<p>Intercambia por correo con número de seguimiento, o marca el anuncio como solo entrega en mano y quedan en persona. En los dos casos hay fecha límite de envío, y los dos pulsan su punto al terminar.</p>"],
        ],
        faq: [
          ["¿Puedo cambiar una carta por varias?", "Sí. Una oferta puede incluir hasta seis de tus anuncios a la vez, o describir con palabras lo que ofreces."],
          ["¿Puedo cambiar cartas por un NFT?", "Sí. Cualquier anuncio se puede cambiar por cualquier otro: cartas por cartas, cartas por un NFT o un NFT por cartas."],
          ["¿Cómo sé si alguien es de fiar?", "Cada usuario tiene un historial: puntos por intercambios terminados, quién lo avaló y si ha dado algún plantón. Aparece en su perfil y en cada anuncio."],
        ],
      },
      "video-games": {
        title: "Intercambia videojuegos online: cambia los que ya terminaste", h1: "Intercambia videojuegos", short: "Videojuegos",
        desc: "Cambia los juegos que ya terminaste por los que quieres: Switch, PlayStation, Xbox, cartuchos retro. Con gente que los tiene, por correo o en persona. Sin dinero.",
        lede: "¿Ya lo terminaste? Cámbialo. Publica los juegos que ya no usas, di cuál quieres después e intercambia con quien lo tenga, por correo o en mano.",
        sections: [
          ["Entiende cómo los llamas", "<p>«PS5», «PlayStation 5» y «ps 5» son lo mismo para el tablón; también «Switch» y «Nintendo Switch». Escríbelo como lo digas tú y las coincidencias te encuentran igual.</p>"],
          ["Juegos por lo que sea", "<p>Un juego se puede cambiar por otro juego, una consola, una carta o un NFT. Di qué aceptarías, o marca «abierto a otras ofertas» y mira qué te proponen.</p>"],
        ],
        faq: [
          ["¿Es gratis?", "Sí. No hay comisiones por publicar ni por vender. Solo pagas el envío si mandas algo por correo. Dos extras opcionales llevan una pequeña comisión fija: completar un intercambio NFT por NFT en la cadena y, donde se ofrezca, proteger un intercambio con una retención en la tarjeta."],
          ["¿Y si la otra persona no envía?", "Todo intercambio acordado tiene fecha límite de envío. Si no la cumple, puedes cerrarlo como plantón y queda en su historial."],
        ],
      },
      "retro-consoles": {
        title: "Intercambia consolas y juegos retro: Game Boy, N64, SNES y más", h1: "Intercambia consolas y juegos retro", short: "Consolas retro",
        desc: "Cambia consolas retro, portátiles y cartuchos: Game Boy, N64, SNES, PS1, Sega. Publica lo que tienes, di qué buscas e intercambia con coleccionistas. Sin dinero.",
        lede: "¿Una Game Boy por una N64? ¿Cartuchos por una portátil? Publica tu material retro, di qué estás buscando y cámbialo con quien lo tenga.",
        sections: [
          ["Pensado para coleccionistas", "<p>Añade fotos y describe el estado, y consigue la insignia de Prueba del artículo fotografiándolo con un código que te da el tablón: así todos saben que de verdad lo tienes.</p>"],
          ["En mano o por correo", "<p>¿Consola voluminosa? Márcala como solo entrega en mano y el tablón muestra a qué distancia está cada usuario. Si no, envíala con seguimiento antes de la fecha límite.</p>"],
        ],
        faq: [
          ["¿Qué es la insignia de Prueba del artículo?", "Una foto del objeto junto a un código que te dio el tablón, comprobada automáticamente. Demuestra que quien lo anuncia lo tiene de verdad."],
          ["¿Puedo cambiar una consola por varios juegos?", "Sí: una oferta puede incluir hasta seis de tus anuncios, o cualquier cosa que describas con palabras."],
        ],
      },
      "barter-online": {
        title: "Trueque online: intercambia cosas sin dinero", h1: "Trueque online, sin dinero", short: "Trueque online",
        desc: "Un tablón de trueques gratis: publica lo que tienes, di qué quieres y encuentra a quien lo tiene. Objetos físicos y NFTs, por correo o en persona. Sin precios ni dinero.",
        lede: "Sin precios y sin dinero: solo intercambios. Publica lo que tienes, di qué aceptarías y Dot encuentra a gente que tiene lo que quieres y quiere lo que tienes.",
        sections: [
          ["El gran problema del trueque, resuelto", "<p>El problema más viejo del trueque es encontrar a alguien que tenga lo que quieres <em>y</em> que quiera lo que tienes. Dile a Dot las dos mitades y se pone a buscar, incluidos los intercambios en los que cada uno quiere justo lo del otro.</p>"],
          ["Cosas, NFTs o las dos", "<p>Cambia cosas físicas por cosas físicas, NFTs entre cadenas, o unas por otros. Cada anuncio dice qué busca su dueño, así que lo sabes antes de preguntar.</p>"],
        ],
        faq: [
          ["¿Es seguro hacer trueque online?", "Cada intercambio aquí tiene fecha límite de envío, prueba de envío (seguimiento, o la transacción comprobada en la cadena) y un historial público de cada usuario: puntos por intercambios terminados y plantones por los que no envió."],
          ["¿Cuesta algo?", "No. Publicar, encontrar coincidencias e intercambiar es gratis. Dos extras opcionales llevan una pequeña comisión fija: completar un intercambio NFT por NFT en la cadena y, donde se ofrezca, proteger un intercambio con una retención en la tarjeta."],
          ["¿Tengo que instalar una app?", "No. Funciona en el navegador del móvil; solo regístrate con tu correo."],
        ],
      },
    },
  },

  ja: {
    ui: {
      crumb: "交換のしかた", how: "使い方", safe: "安心して交換できる仕組み", now: "いま交換できるもの", first: "最初の出品者になろう",
      empty: "まだ出品がありません。出品して欲しいものを書いておけば、マッチする相手が見つかります。",
      faq: "よくある質問", ready: "さっそく交換しませんか？", readyLede: "無料・アプリのインストール不要。メールアドレスで登録すれば、1分で最初の出品ができます。",
      start: "無料で交換をはじめる", list: "無料で出品する", board: "ボードを見る", more: "ほかの交換のしかた", all: "すべてのカテゴリー",
      indexH1: "交換のしかた", indexLede: "Dot Trading Postは物々交換のボードです。お金は使わず、交換だけ。交換したいものごとの使い方をまとめました。",
      indexHow: "交換の流れ", indexTitle: "交換のしかた — NFT・トレカ・ゲームなど | Dot Trading Post",
      indexDesc: "NFTと現物の交換、チェーンをまたいだNFT交換、ポケモンカード・ゲームソフト・レトロゲーム機のトレードなど、何でも物々交換。お金は不要です。",
    },
    steps: [
      ["出品する", "持っているものと、代わりに欲しいものを書くだけ。値段は不要です。欲しいものは具体的な品物でも、カテゴリーでも、「オファー歓迎」でもOK。"],
      ["マッチする", "あなたの欲しいものを持っていて、あなたの持っているものを欲しがっている人を、Dotが探して知らせます。"],
      ["交換する", "交換が成立したら期限までに自分の分を送り、相手の品物が届いたらドットを押します。お互いがドットを押すと、2人の取引履歴に残ります。"],
    ],
    safe: [
      ["発送期限", "成立した交換にはすべて発送期限があります。期限までに送らないと、相手は取引を「未発送」として終了でき、それはあなたの履歴に残ります。"],
      ["発送の証明", "荷物なら追跡番号、NFTならトランザクション。NFTはボードがチェーン上で直接確認します。"],
      ["全員に取引履歴", "ドットは、完了した交換と取引相手からしかもらえません。買うことも、自分で付けることもできません。"],
    ],
    pages: {
      "nfts-for-physical-items": {
        title: "NFTと現物を交換 — NFTをリアルなモノと交換しよう", h1: "NFTと現物を交換する", short: "NFTと現物の交換",
        desc: "NFTをトレカ、ゲーム、ゲーム機など現物と交換。現物をNFTと交換することもできます。交換する相手との間でお金のやり取りはなく、出品手数料も販売手数料もありません。NFT側はオンチェーンで確認されます。",
        lede: "NFTをポケモンカードやゲーム機、腕時計と。あるいは現物をNFTと。欲しいものを書けば、持っている人をボードが見つけ、NFT側はオンチェーンで確認します。",
        sections: [
          ["NFTと現物の交換の流れ", "<p>一方はウォレットからNFTを送り、もう一方は荷物を発送します（近ければ手渡しも可）。発送期限は両者共通です。NFTの送付はチェーンから直接読み取られ、相手のウォレットに届いたことをボードが確認します。荷物には追跡番号があります。お互いが約束のものを受け取ったら、2人ともドットを押します。</p>"],
          ["売るより交換がいい理由", "<p>NFTを売って現物を買うと、売買が2回、手数料も2回、その間に現金化も必要です。交換なら1回で済みます。持っているものを渡して、欲しいものを受け取るだけ。値段の交渉もいりません。大事なのは、お互いにとって公平かどうかだけです。</p>"],
        ],
        faq: [
          ["先にNFTをブリッジしたり売ったりする必要はありますか？", "いいえ。NFTは今あるチェーンのまま、そのまま送ります。相手は品物を郵送か手渡しで送ります。"],
          ["NFTが本当に送られたか、どうやってわかりますか？", "NFT側が発送済みになると、ボードがチェーン上のトランザクションを読み取り、トークンが相手のウォレットに届いたかを確認します。確認できて初めて「受け渡し済み」と表示されます。"],
          ["NFTを受け取ったまま、発送しない人がいたら？", "成立した交換にはすべて発送期限があります。期限までに送られなければ「未発送」として取引を終了でき、相手の公開履歴に残ります。交換に応じる前に、相手のドットと完了した取引数を確認しましょう。"],
          ["費用はかかりますか？", "かかりません。出品・マッチング・交換はすべて無料です。自分の送料とガス代だけご負担ください。任意の追加機能2つだけに少額の固定手数料がかかります。NFT同士の交換をオンチェーンで完了するとき（完了する側が支払います）と、（提供されている場合）カードの仮押さえで取引を保護するときです。"],
        ],
      },
      "nft-swap-cross-chain": {
        title: "チェーンをまたいでNFTを交換 — ブリッジ不要", h1: "チェーンをまたいでNFTを交換する", short: "チェーンをまたいだNFT交換",
        desc: "あるチェーンのNFTを別のチェーンのNFTと交換。Ethereum、Base、Zora、Polygonなどに対応。ブリッジもラップドトークンも不要で、それぞれが自分のチェーンで送り、両方の送付を確認します。",
        lede: "あなたのNFTはBase、相手のはEthereum？それでも交換できます。ブリッジもラップドトークンも不要。それぞれが自分のチェーンで送り、ボードが両方の送付をオンチェーンで確認します。",
        sections: [
          ["チェーンをまたいだ交換の流れ", "<p>ブリッジは使いません。交換が成立したら、それぞれが今あるチェーンのまま、相手のウォレットにNFTを送ります。ボードはそれぞれのトランザクションをそのチェーンから読み取り、トークンが届いた時点でその側を「受け渡し済み」にします。対応チェーン：" + CH.ja + "。</p>"],
          ["同じチェーンなら、トランザクション1回", "<p>両方のNFTが同じチェーンにある場合、どちらかが先に送る必要はありません。出品者がスワップに署名し、相手が1回のトランザクションで完了させます。2つのNFTは同時に動くか、どちらも動かないかのどちらかです。</p>"],
        ],
        faq: [
          ["どのチェーン間で交換できますか？", CH.ja + "のどの組み合わせでもOKです。ERC-721とERC-1155のどちらにも対応しています。"],
          ["ブリッジやラップドトークンは使いますか？", "使いません。それぞれのNFTは自分のチェーンにとどまり、ウォレットからウォレットへ直接送られます。"],
          ["自分の送付はどうやって確認されますか？", "ボードがチェーン上のトランザクションを読み取り、交換成立後にトークンが相手のウォレットへ送られたかを確認します。トランザクションは誰でもチェーンのエクスプローラーで見られます。"],
          ["ウォレットの接続は必要ですか？", "NFTを出品・オファーする場合は必要です。メッセージに署名して一度だけウォレットを連携します（無料・トランザクションなし）。これで、本当に保有していることが他の人にもわかります。"],
        ],
      },
      "pokemon-cards": {
        title: "ポケモンカードをオンラインでトレード — 売らずに交換", h1: "ポケモンカードをトレードする", short: "ポケモンカード",
        desc: "ポケモンカードを郵送や手渡しでコレクター同士トレード。リザードン、旧裏、プロモ、未開封BOXも。持っているカードと欲しいカードを書けば、持っている人とマッチします。お金は不要。",
        lede: "ダブりがある？探しているカードがある？持っているカードと欲しいカードを書けば、そのカードを持っているコレクターとマッチします。郵送でも、近くの人と手渡しでも。",
        sections: [
          ["ポケモンをわかっているマッチング", "<p>「リザードン」「Charizard」「ポケカ」「Pokémon TCG」など、どう書いてもボードはポケモンカードだと理解します。リザードンを探していれば、ボード上のすべてのカードではなく、リザードンとマッチします。</p>"],
          ["郵送でも手渡しでも", "<p>追跡番号つきで郵送してもいいし、「手渡しのみ」にして直接会って交換することもできます。どちらの場合も発送期限があり、交換が終わったら2人ともドットを押します。</p>"],
        ],
        faq: [
          ["1枚のカードを複数枚と交換できますか？", "できます。1つのオファーに自分の出品を最大6つまで入れられます。言葉で説明して提案することもできます。"],
          ["カードをNFTと交換できますか？", "できます。どの出品とも交換可能です。カード同士、カードとNFT、NFTとカード、どれでもOKです。"],
          ["相手が信頼できるか、どうやってわかりますか？", "全員に取引履歴があります。完了した交換で得たドット、誰から評価されたか、未発送の有無。プロフィールとすべての出品に表示されます。"],
        ],
      },
      "video-games": {
        title: "ゲームソフトをオンラインで交換 — クリアしたゲームをトレード", h1: "ゲームソフトを交換する", short: "ゲームソフト",
        desc: "クリアしたゲームを、遊びたいゲームと交換。Switch、PlayStation、Xbox、レトロのカセットも。持っている人とマッチして、郵送か手渡しで交換。お金は不要。",
        lede: "クリアした？なら交換しよう。遊び終わったゲームを出品し、次に遊びたいゲームを書けば、持っている人と郵送か手渡しで交換できます。",
        sections: [
          ["呼び方の違いもわかる", "<p>「PS5」「PlayStation 5」「プレステ5」はボードにとって同じもの。「Switch」と「ニンテンドースイッチ」も同じです。いつもの呼び方で書けば、ちゃんとマッチします。</p>"],
          ["ゲームを何とでも", "<p>ゲームは別のゲームとも、ゲーム機とも、カードとも、NFTとも交換できます。欲しいものを書くか、「ほかのオファーも歓迎」にチェックして、どんな提案が来るか見てみましょう。</p>"],
        ],
        faq: [
          ["無料ですか？", "はい。出品手数料も販売手数料もありません。郵送する場合の送料だけご負担ください。任意の追加機能2つだけに少額の固定手数料がかかります。NFT同士の交換をオンチェーンで完了するときと、（提供されている場合）カードの仮押さえで取引を保護するときです。"],
          ["相手が発送しなかったら？", "成立した交換にはすべて発送期限があります。期限を過ぎたら「未発送」として取引を終了でき、相手の履歴に残ります。"],
        ],
      },
      "retro-consoles": {
        title: "レトロゲーム機・ソフトを交換 — ゲームボーイ、N64、スーファミなど", h1: "レトロゲーム機・ソフトを交換する", short: "レトロゲーム機",
        desc: "レトロゲーム機、携帯ゲーム機、カセットを交換。ゲームボーイ、N64、スーファミ、プレステ、セガなど。持っているものと欲しいものを書いて、コレクターとトレード。お金は不要。",
        lede: "ゲームボーイとN64を交換？カセットと携帯ゲーム機を？手持ちのレトロゲームを出品し、探しているものを書けば、持っている人と交換できます。",
        sections: [
          ["コレクターのために", "<p>写真と状態の説明を載せましょう。ボードが発行するコードと一緒に撮影すれば「現物証明」バッジがもらえ、本当に持っていることが伝わります。</p>"],
          ["手渡しでも郵送でも", "<p>大きなゲーム機なら「手渡しのみ」に。ボードが各トレーダーとの距離を表示します。郵送の場合は、発送期限までに追跡番号つきで送りましょう。</p>"],
        ],
        faq: [
          ["「現物証明」バッジとは？", "ボードが発行したコードと一緒に品物を撮った写真を、自動でチェックしたものです。出品者が本当に持っていることを示します。"],
          ["ゲーム機1台を複数のソフトと交換できますか？", "できます。オファーには自分の出品を最大6つまで入れられ、言葉で説明したものを提案することもできます。"],
        ],
      },
      "barter-online": {
        title: "オンラインで物々交換 — お金を使わずにモノを交換", h1: "オンラインで物々交換、お金は不要", short: "オンライン物々交換",
        desc: "無料の物々交換ボード。持っているものと欲しいものを書けば、持っている人とマッチします。現物もNFTも、郵送でも手渡しでも。値段もお金も不要です。",
        lede: "値段もお金もいりません。交換だけ。持っているものと、代わりに欲しいものを書けば、Dotがあなたの欲しいものを持ち、あなたのものを欲しがっている人を見つけます。",
        sections: [
          ["物々交換の昔からの難問を解決", "<p>物々交換の一番の難しさは、欲しいものを持っていて、<em>しかも</em>自分のものを欲しがっている相手を見つけることです。Dotに両方を伝えれば、探してくれます。お互いが相手のものを欲しがっている、ぴったりの組み合わせも見つかります。</p>"],
          ["モノも、NFTも", "<p>現物同士、チェーンをまたいだNFT同士、現物とNFT。どんな組み合わせでも交換できます。各出品に出品者の希望が書かれているので、聞く前にわかります。</p>"],
        ],
        faq: [
          ["オンラインの物々交換は安全ですか？", "ここでの交換にはすべて、発送期限、発送の証明（追跡番号、またはオンチェーンで確認されたトランザクション）、そして各トレーダーの公開履歴（完了した交換のドットと、送らなかった取引の未発送）があります。"],
          ["費用はかかりますか？", "かかりません。出品・マッチング・交換はすべて無料です。任意の追加機能2つだけに少額の固定手数料がかかります。NFT同士の交換をオンチェーンで完了するときと、（提供されている場合）カードの仮押さえで取引を保護するときです。"],
          ["アプリのインストールは必要ですか？", "不要です。スマホのブラウザで使えます。メールアドレスで登録するだけです。"],
        ],
      },
    },
  },

  pt: {
    ui: {
      crumb: "Jeitos de trocar", how: "Como funciona", safe: "O que protege cada troca", now: "Para trocar agora", first: "Seja o primeiro",
      empty: "Ainda não tem nada aqui. Anuncie o seu e diga o que você quer em troca — as combinações chegam até você.",
      faq: "Perguntas", ready: "Bora trocar?", readyLede: "Grátis e sem instalar nada. Cadastre-se com seu e-mail e anuncie sua primeira coisa em um minuto.",
      start: "Comece a trocar — grátis", list: "Anuncie algo — grátis", board: "Ver o mural", more: "Mais jeitos de trocar", all: "Todas as categorias",
      indexH1: "Jeitos de trocar", indexLede: "O Dot Trading Post é um mural de trocas: sem dinheiro, só escambo. Veja como funciona para o que você quer trocar.",
      indexHow: "Como toda troca funciona", indexTitle: "Jeitos de trocar — NFTs, cards, games e mais | Dot Trading Post",
      indexDesc: "Troque NFTs por itens físicos, troque NFTs entre redes, cards de Pokémon, videogames e consoles retrô — ou faça escambo de qualquer coisa. Sem dinheiro.",
    },
    steps: [
      ["Anuncie", "Diga o que você tem e o que aceitaria em troca. Sem preço — você pode querer uma coisa específica, uma categoria ou ficar “aberto a propostas”."],
      ["Encontre com quem", "O Dot procura gente que tem o que você quer e quer o que você tem, e te mostra quem são."],
      ["Troque", "Fechem a troca, envie a sua parte até o prazo e aperte seu ponto quando a deles chegar. Com os dois pontos, fica no histórico de vocês dois."],
    ],
    safe: [
      ["Um prazo de envio", "Toda troca fechada tem um. Se você não enviar a tempo, a outra pessoa pode encerrar a troca como furo — e isso fica no seu histórico."],
      ["Comprovante de envio", "Um código de rastreio para pacotes, ou a transação de um NFT, que o mural confere direto na blockchain."],
      ["Histórico em cada pessoa", "Os pontos só vêm de trocas concluídas e das pessoas com quem você trocou. Ninguém pode comprar nem dar pontos para si mesmo."],
    ],
    pages: {
      "nfts-for-physical-items": {
        title: "Troque NFTs por itens físicos — um NFT por coisas de verdade", h1: "Troque NFTs por itens físicos", short: "NFTs por itens físicos",
        desc: "Troque um NFT por cards, games, consoles ou qualquer coisa real — ou um item físico por um NFT. Sem dinheiro entre quem troca e sem taxa para anunciar ou vender; o lado NFT é conferido na blockchain.",
        lede: "Troque um NFT por um card de Pokémon, um console, um relógio — ou algo real por um NFT. Você diz o que quer; o mural acha quem tem e confere o lado NFT na blockchain.",
        sections: [
          ["Como funciona uma troca híbrida", "<p>Um lado envia o NFT da carteira; o outro despacha um pacote (ou entrega em mãos, se vocês forem da mesma região). Os dois têm o mesmo prazo de envio. A transferência do NFT é lida direto da blockchain — o mural confere se chegou na carteira da outra pessoa — e o pacote tem código de rastreio. Quando cada um recebe o combinado, os dois apertam seu ponto.</p>"],
          ["Por que trocar em vez de vender", "<p>Vender um NFT para comprar algo físico são duas vendas, duas taxas e um saque no meio do caminho. Uma troca é uma coisa só: você dá o que tem e recebe o que quer. E sem discutir preço — só se a troca é justa para os dois.</p>"],
        ],
        faq: [
          ["Preciso passar meu NFT por uma ponte ou vender antes?", "Não. Você envia o próprio NFT, na rede em que ele estiver. A outra pessoa manda o item dela pelo correio ou em mãos."],
          ["Como eu sei que o NFT foi enviado mesmo?", "Quando o lado NFT é marcado como enviado, o mural lê a transação na blockchain e confere se o token foi para a carteira da outra pessoa. Só aparece como entregue depois que isso é confirmado."],
          ["O que impede alguém de ficar com meu NFT e nunca enviar nada?", "Toda troca fechada tem prazo de envio. Se a pessoa não enviar até lá, você encerra a troca como furo e isso fica no histórico público dela. Veja os pontos e as trocas concluídas de alguém antes de fechar."],
          ["Custa alguma coisa?", "Não. Anunciar, encontrar combinações e trocar é grátis. Você só paga o seu frete e o gas. Dois extras opcionais têm uma pequena taxa fixa: completar uma troca de NFT por NFT na blockchain (paga por quem a completa) e, onde for oferecido, proteger uma troca com uma reserva no cartão."],
        ],
      },
      "nft-swap-cross-chain": {
        title: "Troque NFTs entre redes — sem ponte", h1: "Troque NFTs entre redes", short: "NFTs entre redes",
        desc: "Troque um NFT de uma rede por um NFT de outra — Ethereum, Base, Zora, Polygon e mais. Sem ponte e sem token embrulhado: cada lado envia na sua própria rede e as duas transferências são conferidas.",
        lede: "Seu NFT está na Base e o da outra pessoa na Ethereum? Troquem mesmo assim. Sem ponte e sem token embrulhado — cada um envia na sua própria rede, e o mural confere as duas transferências na blockchain.",
        sections: [
          ["Como funciona uma troca entre redes", "<p>Nada passa por ponte. Quando a troca é fechada, cada lado envia o NFT na rede em que ele já está, para a carteira da outra pessoa. O mural lê cada transação na sua própria rede e marca aquele lado como entregue quando o token chega. Funciona entre " + CH.pt + ".</p>"],
          ["Mesma rede? Uma transação só", "<p>Quando os dois NFTs estão na mesma rede, ninguém precisa enviar primeiro: quem anunciou assina a troca e a outra pessoa conclui numa única transação. Os dois NFTs se movem juntos, ou nenhum se move.</p>"],
        ],
        faq: [
          ["Entre quais redes posso trocar?", "Qualquer par entre " + CH.pt + ". Funciona com tokens ERC-721 e ERC-1155."],
          ["Tem ponte ou token embrulhado no meio?", "Não. Cada NFT fica na sua rede e vai direto de uma carteira para a outra."],
          ["Como o meu lado da troca é conferido?", "O mural lê sua transação na blockchain e confere se o token foi transferido para a carteira da outra pessoa depois que a troca foi fechada. Qualquer um pode abrir a transação no explorador da rede."],
          ["Preciso conectar uma carteira?", "Para anunciar ou propor um NFT, sim — você vincula sua carteira uma única vez assinando uma mensagem (grátis, sem transação), para que os outros vejam que você tem mesmo o NFT."],
        ],
      },
      "pokemon-cards": {
        title: "Troque cards de Pokémon online — troque, não venda", h1: "Troque cards de Pokémon", short: "Cards de Pokémon",
        desc: "Troque cards de Pokémon com colecionadores pelo correio ou em mãos — Charizard, coleção base, promos, selados. Diga o que você tem e o que quer, e encontre quem tem. Sem dinheiro.",
        lede: "Tem repetidas? Está caçando um card específico? Anuncie o que você tem, diga o que procura e encontre colecionadores que têm — pelo correio ou com alguém perto de você.",
        sections: [
          ["Combinações que entendem de Pokémon", "<p>Escreva “Charizard”, “pkmn”, “Pokémon TCG” ou “coleção base” — o mural entende que tudo isso é card de Pokémon. Se você quer um Charizard, aparecem Charizards, não todos os cards do mural.</p>"],
          ["Pelo correio ou em mãos", "<p>Troque pelo correio com código de rastreio, ou marque o anúncio como só retirada em mãos e troquem pessoalmente. Nos dois casos tem prazo de envio, e os dois apertam seu ponto quando a troca termina.</p>"],
        ],
        faq: [
          ["Posso trocar um card por vários?", "Pode. Uma proposta pode incluir até seis dos seus anúncios de uma vez, ou descrever em palavras o que você está oferecendo."],
          ["Posso trocar cards por um NFT?", "Pode. Qualquer anúncio pode ser trocado por qualquer outro — card por card, card por NFT ou NFT por card."],
          ["Como sei se alguém é confiável?", "Toda pessoa tem um histórico: pontos de trocas concluídas, quem deu aval e se já deu algum furo. Aparece no perfil e em cada anúncio."],
        ],
      },
      "video-games": {
        title: "Troque games online — troque os jogos que você já zerou", h1: "Troque videogames", short: "Videogames",
        desc: "Troque os jogos que você já zerou pelos que você quer — Switch, PlayStation, Xbox, cartuchos retrô. Com quem tem, pelo correio ou em mãos. Sem dinheiro.",
        lede: "Zerou? Troca. Anuncie os jogos que você já terminou, diga qual quer jogar agora e troque com quem tem — pelo correio ou em mãos.",
        sections: [
          ["Entende do seu jeito de falar", "<p>“PS5”, “PlayStation 5” e “ps 5” são a mesma coisa para o mural; “Switch” e “Nintendo Switch” também. Escreva do seu jeito e as combinações te encontram do mesmo jeito.</p>"],
          ["Jogos por qualquer coisa", "<p>Um jogo pode ser trocado por outro jogo, um console, um card ou um NFT. Diga o que você aceitaria — ou marque “aberto a outras propostas” e veja o que aparece.</p>"],
        ],
        faq: [
          ["É grátis?", "É. Sem taxa para anunciar e sem taxa de venda. Você só paga o frete se mandar pelo correio. Dois extras opcionais têm uma pequena taxa fixa: completar uma troca de NFT por NFT na blockchain e, onde for oferecido, proteger uma troca com uma reserva no cartão."],
          ["E se a outra pessoa não enviar?", "Toda troca fechada tem prazo de envio. Se a pessoa perder o prazo, você pode encerrar a troca como furo e isso fica no histórico dela."],
        ],
      },
      "retro-consoles": {
        title: "Troque consoles e jogos retrô — Game Boy, N64, Super Nintendo e mais", h1: "Troque consoles e jogos retrô", short: "Consoles retrô",
        desc: "Troque consoles retrô, portáteis e cartuchos — Game Boy, N64, Super Nintendo, PS1, Mega Drive. Anuncie o que você tem, diga o que quer e troque com colecionadores. Sem dinheiro.",
        lede: "Um Game Boy por um N64? Cartuchos por um portátil? Anuncie seus retrôs, diga o que você está caçando e troque com quem tem.",
        sections: [
          ["Feito para colecionadores", "<p>Coloque fotos e descreva o estado, e ganhe o selo de Prova do item fotografando com um código que o mural te dá — assim todo mundo sabe que você tem o item de verdade.</p>"],
          ["Em mãos ou pelo correio", "<p>Console grande? Marque como só retirada em mãos e o mural mostra a distância de cada pessoa. Senão, envie com rastreio antes do prazo de envio.</p>"],
        ],
        faq: [
          ["O que é o selo de Prova do item?", "Uma foto do item ao lado de um código que o mural te deu, conferida automaticamente. Mostra que quem anunciou tem o item de verdade."],
          ["Posso trocar um console por vários jogos?", "Pode — uma proposta pode incluir até seis dos seus anúncios, ou qualquer coisa que você descreva em palavras."],
        ],
      },
      "barter-online": {
        title: "Escambo online — troque coisas sem dinheiro", h1: "Escambo online, sem dinheiro", short: "Escambo online",
        desc: "Um mural de trocas grátis: anuncie o que você tem, diga o que quer e encontre quem tem. Itens físicos e NFTs, pelo correio ou em mãos. Sem preço, sem dinheiro.",
        lede: "Sem preço e sem dinheiro — só trocas. Anuncie o que você tem, diga o que aceitaria e o Dot encontra gente que tem o que você quer e quer o que você tem.",
        sections: [
          ["O velho problema do escambo, resolvido", "<p>O problema mais antigo do escambo é achar alguém que tenha o que você quer <em>e</em> que queira o que você tem. Conte as duas metades para o Dot e ele vai procurar — inclusive trocas em que cada um quer exatamente o que o outro tem.</p>"],
          ["Coisas, NFTs ou os dois", "<p>Troque coisas físicas por coisas físicas, NFTs entre redes, ou um pelo outro. Cada anúncio diz o que o dono quer, então você já sabe antes de perguntar.</p>"],
        ],
        faq: [
          ["Escambo online é seguro?", "Toda troca aqui tem prazo de envio, comprovante de envio (rastreio, ou a transação conferida na blockchain) e um histórico público de cada pessoa — pontos por trocas concluídas e furos pelas que ela não enviou."],
          ["Custa alguma coisa?", "Não. Anunciar, encontrar combinações e trocar é grátis. Dois extras opcionais têm uma pequena taxa fixa: completar uma troca de NFT por NFT na blockchain e, onde for oferecido, proteger uma troca com uma reserva no cartão."],
          ["Preciso instalar um app?", "Não. Funciona no navegador do celular — é só se cadastrar com seu e-mail."],
        ],
      },
    },
  },
};
