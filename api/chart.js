const { fetchChart } = require('./_core');

module.exports = async function handler(req, res) {
  const pair = {
    chainId: String(req.query.chainId || ''),
    pairAddress: String(req.query.pairAddress || ''),
    baseToken: { address: String(req.query.tokenAddress || '') }
  };
  const range = String(req.query.range || '24J');
  const candles = await fetchChart(pair, range);
  return res.status(200).json({ candles });
};
