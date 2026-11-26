const { fetchCreatorHistory } = require('./_core');

module.exports = async (req, res) => {
  try {
    const chainId = String(req.query.chainId || '');
    const creator = String(req.query.creator || '');
    const pair = { chainId };
    const facts = { creatorAddress: creator };
    const data = await fetchCreatorHistory(pair, facts);
    res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
  } catch {
    res.status(200).json({ available: false, balanceText: null, creations: [], source: '' });
  }
};
