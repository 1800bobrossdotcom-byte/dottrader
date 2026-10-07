# Translation glossary

Dot Trading Post is written, not machine-translated, in English, Spanish (`es`), Japanese (`ja`) and
Brazilian Portuguese (`pt`, served as `pt-BR`). This file fixes the words each language uses for the
board's own ideas, so the homepage, the public pages, the app and the emails always agree.

## Voice

| | Spanish | Japanese | Portuguese (Brazil) |
|---|---|---|---|
| Address the reader as | **tú** (informal, neutral between Spain and Latin America; plural *ustedes*) | polite **です／ます** | **você** |
| Tone | warm, direct, a bit playful | friendly but polite; no slang | relaxed, conversational |
| Quotes | «comillas» | 「かぎかっこ」 | “aspas” |
| Distances | km | km | km |

## Terms

| English | Spanish | Japanese | Portuguese (Brazil) |
|---|---|---|---|
| Dot Trading Post / Dot | *never translated* | *never translated* | *never translated* |
| barter board / the board | tablón de trueques / el tablón | 物々交換ボード / ボード | mural de trocas / o mural |
| dot(s) | punto(s) | ドット | ponto(s) |
| press your dot | pulsar tu punto | ドットを押す | apertar seu ponto |
| listing / to list | anuncio / publicar | 出品 / 出品する | anúncio / anunciar |
| offer | oferta | オファー | proposta |
| trade, swap (noun) | intercambio, cambio | 交換（トレカでは トレード） | troca |
| to trade, to swap | intercambiar, cambiar | 交換する | trocar |
| barter | trueque | 物々交換 | escambo, troca |
| Wants (on a listing) | Busca | 希望 | Quer |
| Offering (on a listing) | Ofrece | 出品 | Oferece |
| Open to offers | Abierto a ofertas | オファー歓迎 | Aberto a propostas |
| no-show | plantón | 未発送 | furo |
| send-by date | fecha límite de envío | 発送期限 | prazo de envio |
| tracking number | número de seguimiento | 追跡番号 | código de rastreio |
| vouch | avalar / aval | 評価する | dar aval / aval |
| Proof of item | Prueba del artículo | 現物証明 | Prova do item |
| Local pickup only | Solo entrega en mano | 手渡しのみ | Só retirada em mãos |
| match / matches | coincidencia(s) | マッチ / マッチング | combinação / combinações |
| chain | cadena | チェーン | rede |
| bridge | puente | ブリッジ | ponte |
| wallet | wallet | ウォレット | carteira |
| on chain | en la cadena | オンチェーン | na blockchain |
| trading cards | cartas coleccionables | トレーディングカード（トレカ） | cards colecionáveis |
| sticker | pegatina | ステッカー | adesivo |

Category names live in `site/i18n/cats.json` and are shared by every page.

## Where the words are

- Homepage: `i18n/home.<lang>.json`, built into `site/<lang>/index.html` by `node scripts/i18n-home.mjs`.
  The build stops if any English on the page has no translation, or a translation's English is gone.
- Public pages (categories, listings, page frame): `api/_i18n.js`.
- Ways-to-trade pages: `api/_trade_text.js`.
- The board (the app): every sentence is written in English in the code as `t("…")`, and translated in
  `i18n/app.<lang>.json`; `node scripts/i18n-app.mjs` builds `site/js/strings.js` and refuses to if any
  sentence has no translation, or a translation drops a `{placeholder}`.
- Emails: `supabase/functions/notify/index.ts` (the `W` table), sent in the language on the
  recipient's profile (`profiles.lang`).
- Tests (`npm run test:pages`, `npm run test:i18n`, the browser suite `app-languages`) fail if English
  leaks into a translated page or screen.
