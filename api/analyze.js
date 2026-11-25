const { num, detectMode, isEvm, isSolana, fetchSecurity, fetchQuoter, scorePair } = require('./_core');

module.exports = async function handler(req, res) {
  const address = String(req.query.address || '').trim();
  const selectedMode = String(req.query.mode || 'auto');
  const pairAddress = String(req.query.pairAddress || '');
  const mode = detectMode(address, selectedMode);
  if (mode === 'invalid' || (mode === 'evm' && !isEvm(address)) || (mode === 'sol' && !isSolana(address))) {
    return res.status(400).json({ error: 'Format alamat tidak dikenali. Masukkan alamat kontrak EVM (0x…) atau alamat Solana base58.' });
  }
  try {
    const dexRes = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address));
    const json = await dexRes.json();
    const pairs = (json.pairs || []).filter((p) => mode === 'sol' ? p.chainId === 'solana' : p.chainId !== 'solana').sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
    if (!pairs.length) return res.status(200).json({ status: 'not_found', pairs: [] });
    const pair = pairs.find((p) => p.pairAddress === pairAddress) || pairs[0];
    const security = await fetchSecurity(pair, address, mode);
    const quoter = await fetchQuoter(pair, address, mode);
    const scored = scorePair(pair, pairs, security, quoter);
    return res.status(200).json({ status: 'ok', pair, pairs, security, quoter, scored });
  } catch {
    return res.status(502).json({ error: 'Gagal mengambil data pair. Coba lagi sebentar.' });
  }
};
