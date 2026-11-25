# Pumpfase

Read-only EVM and Solana token score analyzer.

Live: https://gulakadisty.github.io/pumpfase/

Paste a token contract address and Pumpfase returns:

- Score 0–100
- Bias: Naik / Netral / Turun
- Confidence
- Execution status
- Pair selector
- Slippage estimates for $10 / $100 / $1,000
- Per-factor score breakdown with notes, weights, and points
- Creator, bundle, security, tax, authority, and top-holder panels
- Trending token leaderboard snapshot with price, 24h change, boost, and Dex links

## Scoring

- Execution gate first: no pair, very low liquidity, or honeypot signals cap the score.
- Liquidity: USD liquidity and liquidity/FDV ratio.
- Momentum: 1h/6h/24h price changes and buy pressure.
- Market quality: pair age, pair count, and volume versus liquidity.
- Creator + bundle risk: GoPlus security/holder signals when available. These are heuristics, not proof.

## Data sources

- DexScreener for pair data.
- GoPlus for security and holder signals when available.

## Run locally

Open `index.html` in a browser, or serve the folder with any static file server.

## Disclaimer

Pumpfase is a signal tool, not a price prediction and not financial advice.
