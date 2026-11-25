const { num } = require('./_core');

async function fetchBestPair(address) {
  const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address));
  const json = await res.json();
  return (json.pairs || []).sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0] || null;
}

module.exports = async function handler(req, res) {
  try {
    const boostRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const boostsJson = await boostRes.json();
    const boosts = (Array.isArray(boostsJson) ? boostsJson : []).slice(0, 10);
    const resolved = await Promise.allSettled(boosts.map(async (boost) => {
      const address = boost.tokenAddress || boost.address;
      const pair = address ? await fetchBestPair(address) : null;
      return { boost, address, pair };
    }));
    const tokens = resolved.map((r) => r.status === 'fulfilled' ? r.value : null).filter((r) => r && r.pair).map(({ boost, address, pair }) => ({
      address,
      boostAmount: boost.amount ?? boost.boostAmount ?? null,
      chainId: pair.chainId,
      dexId: pair.dexId,
      name: pair.baseToken?.name || '',
      priceChangeH24: pair.priceChange?.h24 ?? null,
      priceUsd: pair.priceUsd ?? null,
      symbol: pair.baseToken?.symbol || '',
      url: pair.url || ''
    }));
    return res.status(200).json({ tokens });
  } catch {
    return res.status(502).json({ tokens: [] });
  }
};
