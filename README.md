# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jawaddevisser-coder/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jawaddevisser-coder/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

The best token launch radar: all 758 protocols in the DefiLlama snapshot, ranked by what a
token would be worth if the protocol's record stayed as it is, with a concrete farm plan for
each one.

## The model

The implied value is **fitted, not hardcoded**. From the 128 protocols that already trade
with a positive market cap, the model fits:

- a **category median multiple** (mcap / TVL), shrunk toward the global median with weight
  n / (n + 5), so a category with one protocol barely moves the model;
- an **OLS adjustment** for size (log TVL), 7-day growth, age since first listed, and number
  of chains, fitted on the residuals after the category medians.

Out-of-sample validation is honest 5-fold cross-validation by slug order: fit on four folds,
predict the fifth, pool all 128 predictions. The median absolute error is about 87% in value
terms — multiples genuinely span four orders of magnitude — so the ranking is a prior built
from category-typical multiples, not a price target. The dashboard states the number.

Live-token protocols are ranked by their recorded market cap where one exists. Wrapped, staked,
bridged and exchange products are set aside with the live ones — their token already trades in
another form (WBTC is Bitcoin on Ethereum) — and are ranked by the model, because no market cap
is recorded for them. A protocol "records no token" when the snapshot carries no market cap,
CoinGecko id or symbol for it; that is a record, never a claim that it has none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json`
(758 rows, every watchlist slug covered), `data.js`, copies `dashboard/` and `screenshots/`,
and writes `dossier.json` with the vendored make.fun library. Two runs write the same bytes.

## The dashboard

A dark terminal page, no network: sortable and filterable board (pre-token / all / live,
category, chain, verdict, search), a detail view per protocol with the model's own components
and the farm plan, and the fitted model's formula, coefficients and validation numbers.

Built for [make.fun bounty token-radar-01](https://make.fun/bounty/token-radar-01).
