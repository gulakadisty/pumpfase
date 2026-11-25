// Pumpfase backend core shared by Vercel serverless functions.
function clamp(value, min = 0, max = 100) { return Math.max(min, Math.min(max, value)); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function money(value) { const n = num(value); if (!n) return '$0'; if (n < 0.01) return '$' + n.toFixed(8); return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 }); }
function compact(value) { return '$' + num(value).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 }); }
function pct(value) { const n = num(value); return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
function pctPlain(value) { const n = num(value); return Number.isFinite(n) ? n.toFixed(2) + '%' : 'Tidak tersedia'; }
function shortAddress(address) { const s = String(address || ''); return s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-4) : s; }
function ageText(pair) { if (!pair.pairCreatedAt) return 'Unknown'; const days = Math.max(0, (Date.now() - pair.pairCreatedAt) / 86400000); return days < 1 ? Math.round(days * 24) + 'h' : days.toFixed(days < 10 ? 1 : 0) + 'd'; }
function ageDays(pair) { return pair.pairCreatedAt ? Math.max(0, (Date.now() - pair.pairCreatedAt) / 86400000) : 0; }
function isEvm(address) { return /^0x[a-fA-F0-9]{40}$/.test(address); }
function isSolana(address) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && !address.startsWith('0x'); }
function detectMode(address, selected) { if (selected !== 'auto') return selected; if (isEvm(address)) return 'evm'; if (isSolana(address)) return 'sol'; return 'invalid'; }
function logScore(value, points) { const v = Math.max(0, num(value)); for (let i = 1; i < points.length; i++) { const [x2, y2] = points[i]; const [x1, y1] = points[i - 1]; if (v <= x2) return y1 + (y2 - y1) * ((Math.log10(v + 1) - Math.log10(x1 + 1)) / (Math.log10(x2 + 1) - Math.log10(x1 + 1))); } return points[points.length - 1][1]; }
function changeScore(change) { return clamp(50 + num(change) * 1.1); }
function txns(pair, key) { const tx = pair.txns?.[key] || {}; return { buys: num(tx.buys), sells: num(tx.sells) }; }
function buyPressure(pair) { const tx = txns(pair, 'h24'); return tx.buys + tx.sells ? (tx.buys / (tx.buys + tx.sells)) * 100 : 50; }
function slippageImpact(pair, trade) { const liq = num(pair.liquidity?.usd); if (!liq) return null; return trade / (liq / 2) * 100; }
function slippageText(pair, trade) { const impact = slippageImpact(pair, trade); return impact === null ? 'Tidak bisa' : impact.toFixed(impact < 1 ? 3 : 2) + '%'; }
function boolValue(value) { if (value === true || value === 1) return true; if (value === false || value === 0) return false; const s = String(value ?? '').toLowerCase(); if (s === '1' || s === 'true' || s === 'yes') return true; if (s === '0' || s === 'false' || s === 'no') return false; return null; }
function firstValue(obj, keys) { for (const key of keys) { if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key]; } return null; }

async function fetchSecurity(pair, address, mode) {
  try {
    if (mode === 'sol') {
      const res = await fetch('https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=' + encodeURIComponent(address));
      const json = await res.json();
      return json?.result?.[address] || null;
    }
    const chainId = EVM_CHAIN_IDS[pair.chainId];
    if (!chainId) return null;
    const res = await fetch('https://api.gopluslabs.io/api/v1/token_security/' + chainId + '?contract_addresses=' + encodeURIComponent(address));
    const json = await res.json();
    return json?.result?.[address.toLowerCase()] || json?.result?.[address] || null;
  } catch { return null; }
}

function pctValue(value) { const n = num(value, NaN); return Number.isFinite(n) ? (n <= 1 ? n * 100 : n) : NaN; }
function normalizeHolders(security) {
  const holders = security?.holders || security?.holder || [];
  if (!Array.isArray(holders)) return [];
  return holders.map((h) => ({
    address: firstValue(h, ['address', 'holder_address', 'wallet']) || '',
    percent: pctValue(firstValue(h, ['percent', 'percentage', 'balance_percent', 'share'])),
    isContract: boolValue(firstValue(h, ['is_contract', 'isContract', 'contract'])),
    isLocked: boolValue(firstValue(h, ['is_locked', 'isLocked', 'locked']))
  })).filter((h) => Number.isFinite(h.percent));
}

function securityFacts(security) {
  if (!security) return { available: false, honeypot: false, cannotSellAll: false, creatorPct: null, creatorAddress: '', ownerAddress: '', top10Pct: null, top10NonContractPct: null, bundleSharePct: null, bundleWalletCount: 0, holderCount: null, mintable: null, proxy: null, openSource: null, buyTaxPct: null, sellTaxPct: null, mintAuthorityActive: null, freezeAuthorityActive: null, topHolders: [], notes: ['GoPlus data tidak tersedia untuk pair ini.'] };
  const topHolders = normalizeHolders(security).slice(0, 10);
  const top10Pct = topHolders.length ? topHolders.reduce((sum, h) => sum + h.percent, 0) : null;
  const nonContract = topHolders.filter((h) => h.isContract !== true && h.isLocked !== true);
  const top10NonContractPct = nonContract.length ? nonContract.reduce((sum, h) => sum + h.percent, 0) : null;
  const sortedNonContract = [...nonContract].sort((a, b) => b.percent - a.percent);
  const bundleHolders = sortedNonContract.length && sortedNonContract[0].percent > 5 ? sortedNonContract.slice(1) : sortedNonContract;
  const bundleSharePct = bundleHolders.length ? bundleHolders.reduce((sum, h) => sum + h.percent, 0) : null;
  const bundleWalletCount = bundleHolders.length;
  const creatorPctRaw = pctValue(firstValue(security, ['creator_percent', 'creatorPercent', 'owner_percent']));
  const creatorPct = Number.isFinite(creatorPctRaw) ? creatorPctRaw : null;
  const honeypot = boolValue(firstValue(security, ['is_honeypot', 'honeypot'])) === true;
  const cannotSellAll = boolValue(firstValue(security, ['cannot_sell_all', 'cannotSellAll'])) === true;
  const mintable = boolValue(firstValue(security, ['is_mintable', 'mintable']));
  const proxy = boolValue(firstValue(security, ['is_proxy', 'proxy']));
  const openSource = boolValue(firstValue(security, ['is_open_source', 'open_source', 'openSource']));
  const buyTaxRaw = num(firstValue(security, ['buy_tax', 'buyTax']), NaN);
  const sellTaxRaw = num(firstValue(security, ['sell_tax', 'sellTax']), NaN);
  const buyTaxPct = Number.isFinite(buyTaxRaw) ? buyTaxRaw * 100 : null;
  const sellTaxPct = Number.isFinite(sellTaxRaw) ? sellTaxRaw * 100 : null;
  const mintAuthority = firstValue(security, ['mint_authority', 'mintAuthority']);
  const freezeAuthority = firstValue(security, ['freeze_authority', 'freezeAuthority']);
  const mintAuthorityActive = mintAuthority === null ? mintable : String(mintAuthority).length > 0 && String(mintAuthority) !== 'null';
  const freezeAuthorityActive = freezeAuthority === null ? null : String(freezeAuthority).length > 0 && String(freezeAuthority) !== 'null';
  const holderCountRaw = num(firstValue(security, ['holder_count', 'holderCount', 'holders_count']), NaN);
  const notes = [];
  if (honeypot) notes.push('GoPlus menandai potensi honeypot.');
  if (cannotSellAll) notes.push('GoPlus menandai token tidak bisa dijual seluruhnya.');
  if (creatorPct !== null) notes.push('Creator hanya memegang ' + creatorPct.toFixed(2) + '% supply — konsentrasi creator ' + (creatorPct > 20 ? 'tinggi' : 'rendah') + '.');
  if (top10Pct) notes.push(top10Pct < 20 ? 'Top 10 holder ' + top10Pct.toFixed(1) + '% supply — distribusi relatif menyebar.' : 'Top 10 holder menguasai ' + top10Pct.toFixed(1) + '% supply.');
  if (bundleSharePct) notes.push(bundleSharePct < 20 ? 'Indikasi bundle ringan: ±' + bundleSharePct.toFixed(1) + '% supply di cluster wallet serupa (heuristik).' : 'Indikasi bundle: ±' + bundleSharePct.toFixed(1) + '% supply di wallet non-kontrak berukuran mirip (heuristik).');
  if (mintable) notes.push('Mint authority masih aktif menurut GoPlus.');
  if (!notes.length) notes.push('Tidak ada red flag besar dari data GoPlus yang tersedia.');
  return { available: true, honeypot, cannotSellAll, creatorPct, creatorAddress: firstValue(security, ['creator_address', 'creatorAddress']) || '', ownerAddress: firstValue(security, ['owner_address', 'ownerAddress']) || '', top10Pct, top10NonContractPct, bundleSharePct, bundleWalletCount, holderCount: Number.isFinite(holderCountRaw) ? holderCountRaw : null, mintable, proxy, openSource, buyTaxPct, sellTaxPct, mintAuthorityActive, freezeAuthorityActive, topHolders, notes };
}

function scorePair(pair, pairs, security, quoter) {
  const facts = securityFacts(security);
  const liquidity = num(pair.liquidity?.usd);
  const fdv = num(pair.fdv || pair.marketCap);
  const liqRatio = fdv ? liquidity / fdv : 0;
  const volumeH1 = num(pair.volume?.h1); const volumeH6 = num(pair.volume?.h6); const volume24 = num(pair.volume?.h24);
  const m5 = num(pair.priceChange?.m5); const h1 = num(pair.priceChange?.h1); const h6 = num(pair.priceChange?.h6); const h24 = num(pair.priceChange?.h24);
  const tx24 = txns(pair, 'h24'); const pressure = buyPressure(pair);
  const age = ageDays(pair);
  const turnover = liquidity ? volume24 / liquidity : 0;

  let liquidityScore = logScore(liquidity, [[0,0],[1000,12],[10000,30],[100000,51],[1000000,72],[10000000,88],[50000000,100]]);
  if (liqRatio >= 0.05) liquidityScore += 6;
  if (liqRatio && liqRatio < 0.005) liquidityScore = Math.min(liquidityScore, 53);
  else if (liqRatio && liqRatio < 0.02) liquidityScore = Math.min(liquidityScore, 72);
  liquidityScore = clamp(liquidityScore);
  const liquidityNotes = [];
  if (liqRatio) liquidityNotes.push('Rasio likuiditas/FDV ' + (liqRatio * 100).toFixed(1) + '% — ' + (liqRatio >= 0.05 ? 'cukup.' : liqRatio >= 0.02 ? 'cukup sehat untuk ukuran pasar ini.' : 'tipis, harga gampang digerakkan.'));
  liquidityNotes.push(liquidity >= 100000 ? 'Likuiditas dalam — slippage relatif kecil untuk ukuran ritel.' : liquidity >= 10000 ? 'Likuiditas ada, tapi ukuran trade besar tetap bisa menggerakkan harga.' : 'Likuiditas tipis — eksekusi ritel berisiko slippage besar.');

  let momentumScore = changeScore(m5) * 0.15 + changeScore(h1) * 0.3 + changeScore(h6) * 0.25 + changeScore(h24) * 0.15 + pressure * 0.15;
  if (m5 > 0 && h1 > 0 && h6 > 0 && h24 > 0) momentumScore += 3;
  if (m5 < 0 && h1 < 0 && h6 < 0 && h24 < 0) momentumScore -= 3;
  if (volume24 && volumeH1 > volume24 / 12) momentumScore += 4;
  momentumScore = clamp(momentumScore);
  const momentumNotes = [];
  if (m5 > 0 && h1 > 0 && h6 > 0 && h24 > 0) momentumNotes.push('Harga naik konsisten di semua timeframe (5m–24j).');
  else if (m5 < 0 && h1 < 0 && h6 < 0 && h24 < 0) momentumNotes.push('Harga turun konsisten di semua timeframe (5m–24j).');
  else momentumNotes.push('Arah harga campur antar-timeframe — belum ada tren yang bersih.');
  momentumNotes.push('Tekanan beli 24j ' + pressure.toFixed(0) + '% (' + tx24.buys + ' beli vs ' + tx24.sells + ' jual).');
  if (volume24 && volumeH1 < volume24 / 24) momentumNotes.push('Volume 1 jam terakhir di bawah rata-rata — minat mendingin.');
  else if (volume24 && volumeH1 > volume24 / 12) momentumNotes.push('Volume 1 jam terakhir di atas rata-rata — minat sedang naik.');

  const ageScore = Math.min(15, Math.log10(age + 1) * 5);
  const turnoverScore = turnover < 0.1 ? 5 : turnover < 0.5 ? 10 : turnover <= 3 ? 18 : 29;
  const pairScore = Math.min(15, pairs.length * 0.5);
  const fdvScore = liqRatio >= 0.05 ? 15 : liqRatio >= 0.01 ? 10 : liqRatio >= 0.005 ? 5 : 3;
  let marketScore = clamp(20 + ageScore + turnoverScore + pairScore + fdvScore);
  const fdvNote = liqRatio && liqRatio < 0.005 ? 'FDV ' + Math.round(1 / liqRatio) + 'x lipat likuiditas — valuasi jauh di atas uang yang benar-benar ada di pool.' : 'FDV masih masuk akal dibanding likuiditas.';
  const marketNotes = ['Pair berumur ' + Math.round(age) + ' hari.', 'Turnover volume/likuiditas ' + turnover.toFixed(2) + 'x per 24j — ' + (turnover < 0.1 ? 'pasar sepi untuk ukuran likuiditasnya.' : turnover > 0.5 ? 'pasar aktif.' : 'aktivitas pasar masih masuk akal.'), 'Token punya ' + pairs.length + ' pair terdaftar di DexScreener.', fdvNote];

  let riskScore = 75;
  riskScore -= Math.max(0, ((facts.top10Pct || 0) - 15) * 0.8);
  riskScore -= Math.max(0, ((facts.bundleSharePct || 0) - 10) * 0.7);
  if (facts.creatorPct !== null && facts.creatorPct > 20) riskScore -= 18;
  else if (facts.creatorPct !== null && facts.creatorPct > 10) riskScore -= 8;
  if (liqRatio && liqRatio < 0.005) riskScore -= 5;
  else if (liqRatio && liqRatio < 0.02) riskScore -= 4;
  if (age < 7) riskScore -= 9;
  else if (age < 30) riskScore -= 4;
  if (liquidity < 10000) riskScore -= 10;
  if (h1 > 100 && liquidity < 50000) riskScore -= 10;
  if (facts.honeypot || facts.cannotSellAll) riskScore = 0;
  if (facts.mintable || facts.mintAuthorityActive) riskScore -= 8;
  if (facts.freezeAuthorityActive) riskScore -= 6;
  if (facts.proxy) riskScore -= 6;
  if (facts.openSource === false) riskScore -= 6;
  if ((facts.buyTaxPct || 0) > 5 || (facts.sellTaxPct || 0) > 5) riskScore -= 8;
  riskScore = clamp(riskScore);

  const factors = [
    { key: 'liquidity', label: 'Likuiditas & Eksekusi', rawScore: liquidityScore, weight: 35, notes: liquidityNotes },
    { key: 'momentum', label: 'Momentum', rawScore: momentumScore, weight: 25, notes: momentumNotes },
    { key: 'marketQuality', label: 'Kualitas Pasar', rawScore: marketScore, weight: 20, notes: marketNotes },
    { key: 'risk', label: 'Risiko Creator & Bundle', rawScore: riskScore, weight: 20, notes: facts.notes }
  ].map((f) => ({ ...f, score: Math.round(f.rawScore), points: Number((f.rawScore * f.weight / 100).toFixed(1)) }));
  const rawScore = Math.round(factors.reduce((sum, f) => sum + f.points, 0));
  let score = rawScore;
  let cap = null; let capReason = null;
  const caps = [];
  if (liquidity < 1000) { cap = 20; capReason = 'Likuiditas di bawah $1.000, score dibatasi 20 dan status tidak bisa dieksekusi.'; caps.push(capReason); }
  if (facts.honeypot || facts.cannotSellAll) { cap = 20; capReason = 'Sinyal honeypot / tidak bisa dijual membuat score dibatasi 20.'; caps.push(capReason); }
  const quoterMaxImpact = quoter ? Math.max(num(quoter.buy?.priceImpactPct, 0), num(quoter.sell?.priceImpactPct, 0)) : null;
  if (quoter && quoter.supported && (!quoter.buy || !quoter.sell)) { cap = 20; capReason = 'Route swap nyata tidak ditemukan via quoter ' + quoter.source + ' untuk ±$100 — score dibatasi 20.'; caps.push(capReason); }
  else if (quoter && quoterMaxImpact !== null && quoterMaxImpact > 25) { cap = 45; capReason = 'Price impact quoter di atas 25% untuk ±$100 — score dibatasi 45.'; caps.push(capReason); }
  if (cap !== null) score = Math.min(score, cap);
  score = Math.round(clamp(score));
  const executable = liquidity >= 1000 && !facts.honeypot && !facts.cannotSellAll && !(quoter && quoter.supported && (!quoter.buy || !quoter.sell));
  const execution = quoter && quoter.supported && quoter.buy && quoter.sell && quoterMaxImpact > 25 ? { status: 'Likuiditas sangat tipis', detail: 'Route swap nyata ditemukan via quoter ' + quoter.source + ', tapi price impact ±$100 di atas 25% — swap kecil pun menggerakkan harga secara ekstrem.' } : quoter && quoter.supported && quoter.buy && quoter.sell ? { status: 'Bisa dieksekusi', detail: 'Route swap nyata ditemukan via quoter ' + quoter.source + ' untuk beli & jual (±$100) — terverifikasi bisa dieksekusi, bukan cuma dari likuiditas pair.' } : { status: executable ? 'Bisa dieksekusi' : 'Tidak bisa dieksekusi', detail: executable ? 'Pair aktif dengan likuiditas yang cukup untuk dieksekusi pada ukuran ritel.' : 'Pair tidak punya likuiditas aktif yang cukup atau terdeteksi risiko jual, jadi swap tidak dianggap aman dieksekusi.' };
  const bias = score >= 70 ? 'Naik' : score >= 45 ? 'Netral' : 'Turun';
  const confidence = !executable ? 'Rendah' : (facts.available && volume24 > 10000 ? 'Tinggi' : volume24 > 1000 ? 'Sedang' : 'Rendah');
  const sniperWalletsAll = facts.topHolders.filter((h) => !h.isContract && !h.isLocked && h.percent >= 0.5 && (!facts.creatorAddress || String(h.address).toLowerCase() !== String(facts.creatorAddress).toLowerCase()));
  const sniperShare = sniperWalletsAll.length ? Math.round(sniperWalletsAll.reduce((sum, h) => sum + h.percent, 0) * 10) / 10 : null;
  const pairAgeHours = pair.pairCreatedAt ? Math.round((Date.now() - pair.pairCreatedAt) / 360000) / 10 : null;
  const sniperPhase = pairAgeHours !== null && pairAgeHours < 1 ? 'Fase sniper aktif' : pairAgeHours !== null && pairAgeHours < 24 ? 'Fase awal' : 'Lewat fase awal';
  const firstHourVolumeSharePct = volume24 > 0 ? Math.round(num(pair.volume?.h1) / volume24 * 1000) / 10 : null;
  const sniperNotes = [];
  sniperNotes.push(sniperPhase === 'Fase sniper aktif' ? 'Pair berumur di bawah 1 jam — jendela sniper masih terbuka. Holder besar non-kontrak saat ini hampir pasti masuk di blok-blok pertama setelah launch.' : sniperPhase === 'Fase awal' ? 'Pair berumur di bawah 24 jam — kepemilikan sniper awal masih relevan dibaca dari holder besar non-kontrak saat ini.' : 'Pair sudah lewat 24 jam — sniper awal biasanya sudah keluar, jadi angka ini dibaca sebagai konsentrasi wallet non-kontrak di top holder saat ini (proxy), bukan pelacakan sniper asli.');
  sniperNotes.push(sniperWalletsAll.length ? sniperWalletsAll.length + ' wallet non-kontrak berukuran sniper (masing-masing ≥0,5% supply) di top holder menguasai total ' + sniperShare.toFixed(1) + '% supply — makin besar, makin besar risiko dump mendadak dari pembeli awal.' : 'Tidak ada wallet non-kontrak berukuran sniper (≥0,5% supply) di top holder selain creator — kepemilikan awal terlihat menyebar.');
  if (firstHourVolumeSharePct !== null && firstHourVolumeSharePct >= 50) sniperNotes.push(firstHourVolumeSharePct.toFixed(1) + '% volume 24 jam terjadi di 1 jam terakhir — aktivitas terkonsentrasi di jendela singkat adalah pola khas perburuan sniper/bot.');
  const sniper = { sharePct: sniperShare, walletCount: sniperWalletsAll.length, wallets: sniperWalletsAll.slice(0, 5).map((h) => ({ address: h.address, percent: h.percent })), phase: sniperPhase, pairAgeHours, firstHourVolumeSharePct, level: sniperShare === null ? 'Tidak terdeteksi' : sniperShare >= 20 ? 'Tinggi' : sniperShare >= 10 ? 'Sedang' : 'Rendah', notes: sniperNotes };
  const rugFlags = [];
  const rugMitigations = [];
  let rugPoints = 0;
  const addRug = (points, text) => { rugPoints += points; rugFlags.push(text); };
  if (facts.honeypot || facts.cannotSellAll) addRug(100, 'Honeypot / tidak bisa dijual terdeteksi.');
  if (quoter && quoter.supported && !quoter.sell) addRug(55, 'Route jual ±$100 tidak ditemukan via quoter.');
  else if (quoter && quoter.supported && !quoter.buy) addRug(35, 'Route beli ±$100 tidak ditemukan via quoter.');
  if (quoterMaxImpact !== null && quoterMaxImpact > 25) addRug(15, 'Price impact quoter di atas 25% untuk ±$100.');
  else if (quoterMaxImpact !== null && quoterMaxImpact > 10) addRug(8, 'Price impact quoter di atas 10% untuk ±$100.');
  if (liquidity < 1000) addRug(35, 'Likuiditas di bawah $1.000.');
  else if (liquidity < 10000) addRug(20, 'Likuiditas di bawah $10.000.');
  else if (liquidity < 50000) addRug(10, 'Likuiditas di bawah $50.000.');
  if (liqRatio && liqRatio < 0.005) addRug(15, 'Rasio likuiditas/FDV di bawah 0,5%.');
  else if (liqRatio && liqRatio < 0.02) addRug(8, 'Rasio likuiditas/FDV di bawah 2%.');
  if (facts.creatorPct !== null && facts.creatorPct > 20) addRug(18, 'Creator memegang lebih dari 20% supply.');
  else if (facts.creatorPct !== null && facts.creatorPct > 10) addRug(10, 'Creator memegang lebih dari 10% supply.');
  if ((facts.top10Pct || 0) > 50) addRug(18, 'Top 10 holder menguasai lebih dari 50% supply.');
  else if ((facts.top10Pct || 0) > 35) addRug(10, 'Top 10 holder menguasai lebih dari 35% supply.');
  if ((facts.bundleSharePct || 0) > 25) addRug(16, 'Indikasi bundle di atas 25% supply.');
  else if ((facts.bundleSharePct || 0) > 15) addRug(8, 'Indikasi bundle di atas 15% supply.');
  if (sniper.level === 'Tinggi') addRug(12, 'Kepemilikan sniper-like tinggi.');
  else if (sniper.level === 'Sedang') addRug(6, 'Kepemilikan sniper-like sedang.');
  if (facts.mintable || facts.mintAuthorityActive) addRug(10, 'Mint authority masih aktif.');
  if (facts.freezeAuthorityActive) addRug(8, 'Freeze authority masih aktif.');
  if (facts.proxy) addRug(6, 'Kontrak proxy terdeteksi.');
  if (facts.openSource === false) addRug(8, 'Kontrak tidak open source menurut data security.');
  if ((facts.buyTaxPct || 0) > 10 || (facts.sellTaxPct || 0) > 10) addRug(14, 'Tax beli/jual di atas 10%.');
  else if ((facts.buyTaxPct || 0) > 5 || (facts.sellTaxPct || 0) > 5) addRug(8, 'Tax beli/jual di atas 5%.');
  const ownerText = String(facts.ownerAddress || '');
  if (ownerText && !/^0x0{40}$/i.test(ownerText)) addRug(4, 'Owner kontrak belum renounced menurut data security.');
  if (pairAgeHours !== null && pairAgeHours < 1) addRug(12, 'Pair berumur di bawah 1 jam.');
  else if (pairAgeHours !== null && pairAgeHours < 24) addRug(7, 'Pair berumur di bawah 24 jam.');
  if (executable && quoter && quoter.buy && quoter.sell) rugMitigations.push('Route beli dan jual ±$100 ditemukan.');
  if (liquidity >= 100000) rugMitigations.push('Likuiditas di atas $100.000.');
  if (facts.creatorPct !== null && facts.creatorPct <= 5) rugMitigations.push('Creator share rendah.');
  if ((facts.top10Pct || 100) <= 35) rugMitigations.push('Konsentrasi top 10 holder tidak ekstrem.');
  if (!facts.mintable && !facts.mintAuthorityActive && !facts.freezeAuthorityActive) rugMitigations.push('Mint/freeze authority tidak aktif menurut data security.');
  if (facts.openSource === true) rugMitigations.push('Kontrak open source menurut data security.');
  if (!rugFlags.length) rugFlags.push('Tidak ada red flag rugpull besar dari data yang tersedia.');
  const rugpull = { level: rugPoints >= 70 ? 'Sangat tinggi' : rugPoints >= 45 ? 'Tinggi' : rugPoints >= 25 ? 'Sedang' : 'Rendah', points: Math.min(100, Math.round(rugPoints)), flags: rugFlags, mitigations: rugMitigations, notes: ['Level ini merangkum red flag rugpull dari data pasar, quoter, dan security yang tersedia.', 'LP lock/burn khusus dan creator sell dari transaksi awal belum dibaca sebagai bukti mutlak.'] };
  const chanceBins = [{ max: 35, up0: 50, up5: 35 }, { max: 45, up0: 50, up5: 27 }, { max: 55, up0: 42, up5: 13 }, { max: 65, up0: 43, up5: 23 }, { max: 75, up0: 40, up5: 27 }, { max: 101, up0: 42, up5: 35 }];
  const chanceBin = chanceBins.find((b) => momentumScore < b.max) || chanceBins[chanceBins.length - 1];
  let upPct = chanceBin.up0 + (score - 55) * 0.18 + (riskScore - 50) * 0.08;
  let up5Pct = chanceBin.up5 + (score - 55) * 0.12 + (riskScore - 50) * 0.05;
  if (confidence === 'Rendah') { upPct = upPct * 0.65 + 43.2 * 0.35; up5Pct = up5Pct * 0.65 + 16.3 * 0.35; }
  if (!executable) { upPct = Math.min(upPct, 15); up5Pct = Math.min(up5Pct, 5); }
  if (rugpull.level === 'Sangat tinggi') { upPct = Math.min(upPct, 25); up5Pct = Math.min(up5Pct, 8); }
  else if (rugpull.level === 'Tinggi') { upPct = Math.min(upPct, 38); up5Pct = Math.min(up5Pct, 15); }
  upPct = clamp(upPct, 3, 75); up5Pct = clamp(up5Pct, 2, 60);
  const upSpread = confidence === 'Tinggi' ? 8 : confidence === 'Sedang' ? 12 : 18;
  const up5Spread = confidence === 'Tinggi' ? 6 : confidence === 'Sedang' ? 9 : 14;
  const chance = { horizon: '24 jam', upPct: Math.round(upPct), up5Pct: Math.round(up5Pct), range: [Math.max(1, Math.round(upPct - upSpread)), Math.min(95, Math.round(upPct + upSpread))], up5Range: [Math.max(1, Math.round(up5Pct - up5Spread)), Math.min(90, Math.round(up5Pct + up5Spread))], basis: 'Backtest momentum historis 12.681 sampel dari 62 pool; base rate naik 43,2% dan naik >5% 16,3%, lalu disesuaikan score, risiko, dan status eksekusi.', notes: ['Estimasi model, bukan probabilitas pasti atau janji harga naik.', 'Naik berarti harga 24 jam lagi lebih tinggi dari sekarang; naik >5% berarti return 24 jam di atas 5%.'] };
  return { score, rawScore, cap, capReason, bias, confidence, executable, execution, caps, facts, factors, sniper, rugpull, chance, quoter, parts: { liquidityScore, momentumScore, marketScore, riskScore } };
}

const EVM_QUOTER = {
  ethereum: { network: 1, wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', rpc: 'https://eth.llamarpc.com' },
  bsc: { network: 56, wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', rpc: 'https://bsc-dataseed.binance.org' },
  base: { network: 8453, wrapped: '0x4200000000000000000000000000000000000006', symbol: 'WETH', rpc: 'https://mainnet.base.org' },
  arbitrum: { network: 42161, wrapped: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', rpc: 'https://arb1.arbitrum.io/rpc' },
  polygon: { network: 137, wrapped: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC', rpc: 'https://polygon-rpc.com' },
  avalanche: { network: 43114, wrapped: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', symbol: 'WAVAX', rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  optimism: { network: 10, wrapped: '0x4200000000000000000000000000000000000006', symbol: 'WETH', rpc: 'https://mainnet.optimism.io' }
};
async function tokenDecimals(rpc, address) {
  try {
    const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: address, data: '0x313ce567' }, 'latest'] }) });
    const json = await res.json();
    const value = parseInt(json.result, 16);
    return Number.isFinite(value) && value >= 0 && value <= 36 ? value : 18;
  } catch { return 18; }
}
function paraswapRoute(route) {
  const exchanges = [];
  for (const hop of route?.bestRoute || []) for (const swap of hop.swaps || []) for (const ex of swap.swapExchanges || []) if (ex.exchange) exchanges.push(ex.exchange);
  return exchanges.length ? [...new Set(exchanges)].join(' → ') : 'ParaSwap';
}
async function paraswapQuote(cfg, srcToken, destToken, amount, srcDecimals, destDecimals) {
  const url = 'https://apiv5.paraswap.io/prices?srcToken=' + srcToken + '&destToken=' + destToken + '&amount=' + amount + '&srcDecimals=' + srcDecimals + '&destDecimals=' + destDecimals + '&side=SELL&network=' + cfg.network;
  const res = await fetch(url);
  const json = await res.json();
  return json.priceRoute || null;
}
async function fetchQuoter(pair, address, mode) {
  const priceUsd = num(pair.priceUsd); const priceNative = num(pair.priceNative);
  if (!priceUsd || !priceNative) return null;
  const tokenUi = 100 / priceUsd;
  try {
    if (mode === 'sol') {
      const solMint = 'So11111111111111111111111111111111111111112';
      const lamports = Math.max(1, Math.round(tokenUi * priceNative * 1e9));
      const jupiterQuote = async (inputMint, outputMint, amount) => {
        const urls = ['https://lite-api.jup.ag/swap/v1/quote', 'https://quote-api.jup.ag/v6/quote'];
        for (const base of urls) {
          try {
            const res = await fetch(base + '?inputMint=' + encodeURIComponent(inputMint) + '&outputMint=' + encodeURIComponent(outputMint) + '&amount=' + amount + '&slippageBps=100');
            const json = await res.json();
            if (json && json.outAmount) return json;
          } catch { /* try next endpoint */ }
        }
        return null;
      };
      const buyJson = await jupiterQuote(solMint, address, lamports);
      const buy = buyJson && buyJson.outAmount ? { inAmount: String(lamports), outAmount: String(buyJson.outAmount), outAmountUi: num(buyJson.outAmount) / 1e6, priceImpactPct: num(buyJson.priceImpactPct), route: (buyJson.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter' } : null;
      let sell = null;
      if (buy) {
        const sellJson = await jupiterQuote(address, solMint, buy.outAmount);
        if (sellJson && sellJson.outAmount) sell = { inAmount: buy.outAmount, outAmount: String(sellJson.outAmount), outAmountUi: num(sellJson.outAmount) / 1e9, priceImpactPct: num(sellJson.priceImpactPct), route: (sellJson.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter' };
      }
      return { supported: true, source: 'Jupiter', counterSymbol: 'SOL', tradeUsd: 100, buy, sell, verdict: buy && sell ? 'Route beli & jual ditemukan via Jupiter — swap ±$100 benar-benar bisa dieksekusi, bukan cuma harga pajangan.' : 'Route swap nyata tidak ditemukan via Jupiter untuk ±$100.' };
    }
    const cfg = EVM_QUOTER[pair.chainId];
    if (!cfg) return { supported: false, source: 'ParaSwap', counterSymbol: pair.quoteToken?.symbol || '', tradeUsd: 100, buy: null, sell: null, verdict: 'Chain ini di luar jangkauan quoter ParaSwap — status eksekusi memakai heuristik likuiditas.' };
    const decimals = await tokenDecimals(cfg.rpc, address);
    const wrappedWei = BigInt(Math.max(1, Math.round(tokenUi * priceNative * 1e18))).toString();
    const buyRoute = await paraswapQuote(cfg, cfg.wrapped, address, wrappedWei, 18, decimals);
    const buy = buyRoute ? { inAmount: wrappedWei, outAmount: String(buyRoute.destAmount), outAmountUi: num(buyRoute.destAmount) / 10 ** decimals, priceImpactPct: Math.round((1 - (num(buyRoute.destAmount) / 10 ** decimals) / tokenUi) * 1000) / 10, route: paraswapRoute(buyRoute) } : null;
    let sell = null;
    if (buy) {
      const sellRoute = await paraswapQuote(cfg, address, cfg.wrapped, buy.outAmount, decimals, 18);
      if (sellRoute) sell = { inAmount: buy.outAmount, outAmount: String(sellRoute.destAmount), outAmountUi: num(sellRoute.destAmount) / 1e18, priceImpactPct: Math.round((1 - (num(sellRoute.destAmount) / 1e18) / (buy.outAmountUi * priceNative)) * 1000) / 10, route: paraswapRoute(sellRoute) };
    }
    return { supported: true, source: 'ParaSwap', counterSymbol: cfg.symbol, tradeUsd: 100, buy, sell, verdict: buy && sell ? 'Route beli & jual ditemukan via ParaSwap — swap ±$100 benar-benar bisa dieksekusi, bukan cuma harga pajangan.' : 'Route swap nyata tidak ditemukan via ParaSwap untuk ±$100.' };
  } catch { return null; }
}
const GT_NETWORKS = { ethereum: 'eth', solana: 'solana', bsc: 'bsc', base: 'base', arbitrum: 'arbitrum', polygon: 'polygon_pos', avalanche: 'avax', optimism: 'optimism' };
async function fetchOhlcv(network, poolAddress, cfg) {
  const res = await fetch('https://api.geckoterminal.com/api/v2/networks/' + network + '/pools/' + encodeURIComponent(poolAddress) + '/ohlcv/' + cfg[0] + '?aggregate=' + cfg[1] + '&limit=' + cfg[2]);
  const json = await res.json();
  const list = json.data?.attributes?.ohlcv_list || [];
  return list.map((c) => ({ t: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] })).sort((a, b) => a.t - b.t);
}
async function fetchChart(pair, range) {
  const network = GT_NETWORKS[pair.chainId];
  if (!network || !pair.pairAddress) return [];
  const cfg = range === '7H' ? ['hour', 1, 168] : range === '30H' ? ['hour', 12, 60] : ['minute', 15, 96];
  try {
    const direct = await fetchOhlcv(network, pair.pairAddress, cfg);
    if (direct.length) return direct;
    const tokenAddress = pair.baseToken?.address;
    if (!tokenAddress) return [];
    const poolsRes = await fetch('https://api.geckoterminal.com/api/v2/networks/' + network + '/tokens/' + encodeURIComponent(tokenAddress) + '/pools');
    const poolsJson = await poolsRes.json();
    const pools = (poolsJson.data || []).map((pool) => ({ address: pool.attributes?.address || String(pool.id || '').split('_').slice(1).join('_'), reserve: num(pool.attributes?.reserve_in_usd) })).filter((pool) => pool.address).sort((a, b) => b.reserve - a.reserve);
    for (const pool of pools) {
      const candles = await fetchOhlcv(network, pool.address, cfg);
      if (candles.length) return candles;
    }
    return [];
  } catch { return []; }
}
module.exports = { num, detectMode, isEvm, isSolana, fetchSecurity, fetchQuoter, scorePair, fetchChart };
