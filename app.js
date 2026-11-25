const $ = (id) => document.getElementById(id);
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
const EVM_CHAIN_IDS = { ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161, optimism: 10, avalanche: 43114 };
let currentPairs = [];
let currentSecurity = null;
let currentAddress = '';
let currentMode = 'auto';

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
  return { score, rawScore, cap, capReason, bias, confidence, executable, execution, caps, facts, factors, sniper, quoter, parts: { liquidityScore, momentumScore, marketScore, riskScore } };
}

function bar(label, value) { return '<div class="bar-row"><div class="bar-label"><span>' + esc(label) + '</span><b>' + Math.round(value) + '</b></div><div class="bar"><i style="width:' + clamp(value) + '%"></i></div></div>'; }
function factorCard(factor) {
  return '<article class="factor-card"><div class="factor-head"><b>' + esc(factor.label) + '</b><span>' + factor.score + '/100 · bobot ' + factor.weight + '% · ' + factor.points + ' poin</span></div>' + bar(factor.label, factor.score) + '<ul>' + factor.notes.map((note) => '<li>' + esc(note) + '</li>').join('') + '</ul></article>';
}
function yesNo(value) { return value === true ? 'Ya' : value === false ? 'Tidak' : 'Tidak tersedia'; }

function render(pair, scored) {
  const token = pair.baseToken || {};
  const quoteSymbol = pair.quoteToken?.symbol || '';
  const pairOptions = currentPairs.slice(0, 12).map((p, i) => '<option value="' + i + '"' + (p === pair ? ' selected' : '') + '>' + esc(p.chainId) + ' · ' + esc(p.dexId || 'DEX') + (p.quoteToken?.symbol ? ' · ' + esc(p.quoteToken.symbol) : '') + ' · ' + compact(p.liquidity?.usd) + '</option>').join('');
  const capHtml = scored.capReason ? '<div class="cap"><b>Kenapa score dibatasi</b><br>Raw score ' + scored.rawScore + ' dibatasi ke ' + scored.cap + '. ' + esc(scored.capReason) + '</div>' : '';
  const holdersHtml = scored.facts.topHolders.length ? '<div class="panel wide"><span>Top holders</span><table><tr><th>Wallet</th><th>Share</th><th>Type</th></tr>' + scored.facts.topHolders.map((h) => '<tr><td>' + esc(shortAddress(h.address)) + '</td><td>' + h.percent.toFixed(2) + '%</td><td>' + (h.isLocked ? 'Locked' : h.isContract ? 'Contract' : 'Wallet') + '</td></tr>').join('') + '</table></div>' : '';
  const sniperHtml = '<div class="panel wide"><span>Kepemilikan sniper</span><p>Fase: ' + esc(scored.sniper.phase) + '<br>Share sniper-like: ' + (scored.sniper.sharePct === null ? 'Tidak terdeteksi' : scored.sniper.sharePct.toFixed(1) + '%') + '<br>Wallet sniper-like: ' + scored.sniper.walletCount + '<br>Level: ' + esc(scored.sniper.level) + '<br>Volume 1 jam terakhir: ' + (scored.sniper.firstHourVolumeSharePct === null ? 'Tidak tersedia' : scored.sniper.firstHourVolumeSharePct.toFixed(1) + '% dari volume 24 jam') + '</p>' + (scored.sniper.wallets.length ? '<table><tr><th>Wallet sniper-like</th><th>Share</th></tr>' + scored.sniper.wallets.map((w) => '<tr><td>' + esc(shortAddress(w.address)) + '</td><td>' + w.percent.toFixed(2) + '%</td></tr>').join('') + '</table>' : '') + '<ul>' + scored.sniper.notes.map((note) => '<li>' + esc(note) + '</li>').join('') + '</ul><p class="muted">Heuristik dari top holder saat ini, bukan pelacakan transaksi pertama.</p></div>';
  const q = scored.quoter;
  const quoterHtml = '<div class="panel wide"><span>Cek Swap Nyata (Quoter)</span>' + (q ? '<p>' + esc(q.verdict) + '<br>Beli ±$100: ' + (q.buy ? esc(q.buy.route) + ' · impact ' + q.buy.priceImpactPct.toFixed(2) + '%' : 'route tidak ditemukan') + '<br>Jual ±$100: ' + (q.sell ? esc(q.sell.route) + ' · impact ' + q.sell.priceImpactPct.toFixed(2) + '%' : 'route tidak ditemukan') + '<br>Sumber: ' + esc(q.source) + ' · Counter: ' + esc(q.counterSymbol) + '</p>' : '<p>Quoter tidak tersedia saat ini — status eksekusi memakai heuristik likuiditas.</p>') + '</div>';
  const chartHtml = '<div class="panel wide"><span>Chart mini</span><div class="chart-switch"><button type="button" data-range="24J">24J</button><button type="button" data-range="7H">7H</button><button type="button" data-range="30H">30H</button></div><div id="chartBox"><p class="muted">Memuat chart...</p></div></div>';
  $('result').innerHTML = '<div class="dashboard">' +
    '<div class="token-head"><div class="token-title">' + (pair.info?.imageUrl ? '<img src="' + esc(pair.info.imageUrl) + '" alt="" />' : '') + '<div><h2>' + esc(token.name || 'Token') + ' <span class="muted">' + esc(token.symbol || '') + '</span></h2><p>' + esc(pair.chainId) + ' · ' + esc(pair.dexId || 'DEX') + (quoteSymbol ? ' · ' + esc(quoteSymbol) : '') + ' · Pair age ' + ageText(pair) + '</p><p><a href="' + esc(pair.url || '#') + '" target="_blank" rel="noreferrer">Lihat pair di DexScreener</a> · Pair ' + esc(shortAddress(pair.pairAddress)) + '</p></div></div>' +
    '<label>Pair <select id="pairSelect">' + pairOptions + '</select></label></div>' +
    '<div class="score-grid"><div><div class="score-ring" style="--score:' + scored.score + '"><div><span><b>' + scored.score + '</b><br>Score</span></div></div></div><div>' +
    '<div class="badges"><span class="badge ' + (scored.bias === 'Naik' ? 'good' : scored.bias === 'Turun' ? 'bad' : 'warn') + '">Bias ' + scored.bias + '</span><span class="badge">Confidence ' + scored.confidence + '</span><span class="badge ' + (scored.executable ? 'good' : 'bad') + '">' + scored.execution.status + '</span></div>' +
    '<p class="execution-detail">' + esc(scored.execution.detail) + '</p>' + capHtml + '</div></div>' +
    '<div class="factor-grid">' + scored.factors.map(factorCard).join('') + '</div>' +
    '<div class="metrics">' +
    '<div class="metric"><span>Price</span><b>' + money(pair.priceUsd) + '</b></div>' +
    '<div class="metric"><span>Liquidity</span><b>' + compact(pair.liquidity?.usd) + '</b></div>' +
    '<div class="metric"><span>FDV</span><b>' + compact(pair.fdv || pair.marketCap) + '</b></div>' +
    '<div class="metric"><span>Market cap</span><b>' + compact(pair.marketCap || pair.fdv) + '</b></div>' +
    '<div class="metric"><span>Volume 1h</span><b>' + compact(pair.volume?.h1) + '</b></div>' +
    '<div class="metric"><span>Volume 6h</span><b>' + compact(pair.volume?.h6) + '</b></div>' +
    '<div class="metric"><span>Volume 24h</span><b>' + compact(pair.volume?.h24) + '</b></div>' +
    '<div class="metric"><span>Buy pressure 24h</span><b>' + buyPressure(pair).toFixed(1) + '%</b></div>' +
    '<div class="metric"><span>5m</span><b>' + pct(pair.priceChange?.m5) + '</b></div>' +
    '<div class="metric"><span>1h</span><b>' + pct(pair.priceChange?.h1) + '</b></div>' +
    '<div class="metric"><span>6h</span><b>' + pct(pair.priceChange?.h6) + '</b></div>' +
    '<div class="metric"><span>24h</span><b>' + pct(pair.priceChange?.h24) + '</b></div></div>' +
    '<div class="panels"><div class="panel"><span>Estimasi slippage</span><table><tr><th>Trade</th><th>Impact</th></tr><tr><td>$10</td><td>' + slippageText(pair, 10) + '</td></tr><tr><td>$100</td><td>' + slippageText(pair, 100) + '</td></tr><tr><td>$1,000</td><td>' + slippageText(pair, 1000) + '</td></tr></table></div>' +
    '<div class="panel"><span>Creator</span><p>Creator: ' + esc(shortAddress(scored.facts.creatorAddress) || 'Tidak tersedia') + '<br>Creator share: ' + (scored.facts.creatorPct === null ? 'Tidak tersedia' : scored.facts.creatorPct.toFixed(2) + '%') + '<br>Owner: ' + esc(shortAddress(scored.facts.ownerAddress) || 'Tidak tersedia') + '<br>Mintable: ' + yesNo(scored.facts.mintable) + ' · Proxy: ' + yesNo(scored.facts.proxy) + ' · Open source: ' + yesNo(scored.facts.openSource) + '</p></div>' +
    '<div class="panel"><span>Bundle heuristic</span><p>Bundle share: ' + (scored.facts.bundleSharePct === null ? 'Tidak tersedia' : '±' + scored.facts.bundleSharePct.toFixed(1) + '%') + '<br>Bundle wallets: ' + scored.facts.bundleWalletCount + '<br>Top 10: ' + (scored.facts.top10Pct === null ? 'Tidak tersedia' : scored.facts.top10Pct.toFixed(1) + '%') + '<br>Top 10 non-contract: ' + (scored.facts.top10NonContractPct === null ? 'Tidak tersedia' : scored.facts.top10NonContractPct.toFixed(1) + '%') + '<br>Holders: ' + (scored.facts.holderCount === null ? 'Tidak tersedia' : scored.facts.holderCount.toLocaleString('en-US')) + '</p></div>' +
    '<div class="panel"><span>Security</span><p>Honeypot: ' + yesNo(scored.facts.honeypot) + '<br>Cannot sell all: ' + yesNo(scored.facts.cannotSellAll) + '<br>Buy tax: ' + (scored.facts.buyTaxPct === null ? 'Tidak tersedia' : scored.facts.buyTaxPct.toFixed(2) + '%') + '<br>Sell tax: ' + (scored.facts.sellTaxPct === null ? 'Tidak tersedia' : scored.facts.sellTaxPct.toFixed(2) + '%') + '<br>Mint authority: ' + yesNo(scored.facts.mintAuthorityActive) + '<br>Freeze authority: ' + yesNo(scored.facts.freezeAuthorityActive) + '</p></div>' + holdersHtml + sniperHtml + quoterHtml + chartHtml + '</div>' +
    '<p class="muted">Source: DexScreener' + (scored.facts.available ? ' + GoPlus' : '') + ' · Updated ' + new Date().toLocaleString('id-ID') + ' · Score adalah signal, bukan nasihat finansial.</p></div>';
  $('result').classList.remove('hidden');
  $('pairSelect').addEventListener('change', async (event) => { const next = currentPairs[Number(event.target.value)]; currentSecurity = await fetchSecurity(next, currentAddress, currentMode); const quoter = await fetchQuoter(next, currentAddress, currentMode); render(next, scorePair(next, currentPairs, currentSecurity, quoter)); });
  document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => loadChart(pair, button.dataset.range)));
  loadChart(pair, '24J');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
async function fetchChart(pair, range) {
  const network = GT_NETWORKS[pair.chainId];
  if (!network || !pair.pairAddress) return [];
  const cfg = range === '7H' ? ['hour', 1, 168] : range === '30H' ? ['hour', 12, 60] : ['minute', 15, 96];
  try {
    const res = await fetch('https://api.geckoterminal.com/api/v2/networks/' + network + '/pools/' + encodeURIComponent(pair.pairAddress) + '/ohlcv/' + cfg[0] + '?aggregate=' + cfg[1] + '&limit=' + cfg[2]);
    const json = await res.json();
    const list = json.data?.attributes?.ohlcv_list || [];
    return list.map((c) => ({ t: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] })).sort((a, b) => a.t - b.t);
  } catch { return []; }
}
function chartSvg(candles) {
  if (!candles.length) return '<p class="muted">Chart belum tersedia — pool belum terindeks GeckoTerminal.</p>';
  const closes = candles.map((c) => c.c); const min = Math.min(...closes); const max = Math.max(...closes); const span = max - min || max || 1;
  const points = closes.map((v, i) => (i / Math.max(1, closes.length - 1) * 560).toFixed(1) + ',' + (110 - (v - min) / span * 100).toFixed(1)).join(' ');
  const maxVol = Math.max(...candles.map((c) => c.v || 0)) || 1;
  const bars = candles.map((c, i) => '<rect x="' + (i / candles.length * 560).toFixed(1) + '" y="' + (140 - (c.v || 0) / maxVol * 24).toFixed(1) + '" width="3" height="' + ((c.v || 0) / maxVol * 24).toFixed(1) + '" fill="rgba(52,255,140,.35)"/>').join('');
  const change = closes[0] ? (closes[closes.length - 1] / closes[0] - 1) * 100 : 0;
  return '<svg viewBox="0 0 560 145" role="img" aria-label="Chart harga"><polyline points="' + points + '" fill="none" stroke="#34ff8c" stroke-width="2"/>' + bars + '</svg><p class="muted">' + candles.length + ' candle · perubahan ' + change.toFixed(2) + '%</p>';
}
async function loadChart(pair, range) {
  const box = $('chartBox'); if (!box) return;
  box.innerHTML = '<p class="muted">Memuat chart...</p>';
  box.innerHTML = chartSvg(await fetchChart(pair, range));
}

async function analyze() {
  const address = $('addressInput').value.trim();
  const mode = detectMode(address, $('chainMode').value);
  $('formError').textContent = '';
  if (mode === 'invalid' || (mode === 'evm' && !isEvm(address)) || (mode === 'sol' && !isSolana(address))) { $('formError').textContent = 'Format alamat tidak dikenali. Masukkan alamat kontrak EVM (0x…) atau alamat Solana base58.'; return; }
  $('analyzeBtn').disabled = true; $('analyzeBtn').textContent = 'Analyzing...';
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address));
    const json = await res.json();
    currentPairs = (json.pairs || []).filter((p) => mode === 'sol' ? p.chainId === 'solana' : p.chainId !== 'solana').sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
    currentAddress = address; currentMode = mode;
    if (!currentPairs.length) { $('result').innerHTML = '<div class="dashboard"><h2>Tidak bisa dieksekusi</h2><p>Tidak ditemukan pair aktif — tidak ada jalur swap yang bisa dipakai.</p><p>Tidak ada pair yang terdaftar untuk alamat ini di DexScreener. Token mungkin belum punya pasar, sudah delisted, atau alamatnya salah. Tanpa pair, tidak ada harga yang bisa dieksekusi — score tidak diterbitkan.</p></div>'; $('result').classList.remove('hidden'); $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const pair = currentPairs[0];
    currentSecurity = await fetchSecurity(pair, address, mode);
    const quoter = await fetchQuoter(pair, address, mode);
    render(pair, scorePair(pair, currentPairs, currentSecurity, quoter));
  } catch { $('formError').textContent = 'Gagal mengambil data pair. Coba lagi sebentar.'; }
  finally { $('analyzeBtn').disabled = false; $('analyzeBtn').innerHTML = 'Analyze <span>→</span>'; }
}

$('analyzeBtn').addEventListener('click', analyze);
$('addressInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') analyze(); });

async function fetchBestPair(address) {
  const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address));
  const json = await res.json();
  return (json.pairs || []).sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0] || null;
}

async function loadLeaderboard() {
  const box = $('leaderboardList');
  if (!box) return;
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const json = await res.json();
    const boosts = (Array.isArray(json) ? json : []).slice(0, 10);
    const resolved = await Promise.allSettled(boosts.map(async (boost) => {
      const address = boost.tokenAddress || boost.address;
      const pair = address ? await fetchBestPair(address) : null;
      return { boost, address, pair };
    }));
    const rows = resolved.map((r) => r.status === 'fulfilled' ? r.value : null).filter((r) => r && r.pair);
    if (!rows.length) throw new Error('empty');
    box.innerHTML = rows.map(({ boost, address, pair }, i) => {
      const token = pair.baseToken || {};
      const mode = pair.chainId === 'solana' ? 'sol' : 'evm';
      return '<div class="leader-row"><div class="rank">' + (i + 1) + '</div>' +
        '<div class="leader-token"><b>' + esc(token.symbol || token.name || 'Token') + '</b><span>' + esc(token.name || '') + ' · ' + esc(pair.chainId) + '</span></div>' +
        '<div class="leader-stat"><span>Price</span><b>' + money(pair.priceUsd) + '</b></div>' +
        '<div class="leader-stat"><span>24h</span><b>' + pct(pair.priceChange?.h24) + '</b></div>' +
        '<div class="leader-stat"><span>Boost</span><b>' + esc(boost.amount ?? boost.boostAmount ?? '-') + '</b></div>' +
        '<div class="leader-actions"><a href="' + esc(pair.url || '#') + '" target="_blank" rel="noreferrer">Dex</a><button type="button" data-leader-address="' + esc(address) + '" data-leader-mode="' + mode + '">Analyze</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-leader-address]').forEach((button) => button.addEventListener('click', () => { $('addressInput').value = button.dataset.leaderAddress; $('chainMode').value = button.dataset.leaderMode; analyze(); }));
  } catch {
    box.innerHTML = '<p class="muted">Leaderboard live belum tersedia. Pakai Analyze Token untuk cek token secara langsung.</p>';
  }
}

loadLeaderboard();
