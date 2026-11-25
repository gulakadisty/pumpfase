const $ = (id) => document.getElementById(id);
const EVM_CHAIN_IDS = { ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161, optimism: 10, avalanche: 43114 };
let currentPairs = [];
let currentSecurity = null;
let currentAddress = '';

function clamp(value, min = 0, max = 100) { return Math.max(min, Math.min(max, value)); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function money(value) { const n = num(value); if (!n) return '$0'; if (n < 0.01) return '$' + n.toFixed(8); return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 }); }
function compact(value) { return '$' + num(value).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 }); }
function pct(value) { const n = num(value); return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
function ageText(pair) { if (!pair.pairCreatedAt) return 'Unknown'; const days = Math.max(0, (Date.now() - pair.pairCreatedAt) / 86400000); return days < 1 ? Math.round(days * 24) + 'h' : days.toFixed(days < 10 ? 1 : 0) + 'd'; }
function isEvm(address) { return /^0x[a-fA-F0-9]{40}$/.test(address); }
function isSolana(address) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && !address.startsWith('0x'); }
function detectMode(address, selected) { if (selected !== 'auto') return selected; if (isEvm(address)) return 'evm'; if (isSolana(address)) return 'sol'; return 'invalid'; }
function logScore(value, points) { const v = Math.max(0, num(value)); for (let i = 1; i < points.length; i++) { const [x2, y2] = points[i]; const [x1, y1] = points[i - 1]; if (v <= x2) return y1 + (y2 - y1) * ((Math.log10(v + 1) - Math.log10(x1 + 1)) / (Math.log10(x2 + 1) - Math.log10(x1 + 1))); } return points[points.length - 1][1]; }
function changeScore(change) { return clamp(50 + num(change) * 1.1); }
function buyPressure(pair) { const tx = pair.txns?.h24 || {}; const buys = num(tx.buys); const sells = num(tx.sells); return buys + sells ? (buys / (buys + sells)) * 100 : 50; }
function slippage(pair, trade) { const liq = num(pair.liquidity?.usd); if (!liq) return 'Tidak bisa'; return (trade / (liq + trade) * 100).toFixed(2) + '%'; }

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

function securityFacts(security) {
  if (!security) return { available: false, honeypot: false, creatorPct: null, top10Pct: null, mintable: null, notes: ['GoPlus data tidak tersedia untuk pair ini.'] };
  const holders = security.holders || security.holder || [];
  const top10Pct = Array.isArray(holders) ? holders.slice(0, 10).reduce((sum, h) => sum + num(h.percent ?? h.percentage ?? h.balance_percent), 0) : null;
  const creatorPct = num(security.creator_percent ?? security.creatorPercent ?? security.owner_percent, NaN);
  const honeypot = String(security.is_honeypot ?? security.honeypot ?? '') === '1' || security.is_honeypot === true;
  const mintable = String(security.is_mintable ?? security.mintable ?? '') === '1' || security.is_mintable === true;
  const notes = [];
  if (honeypot) notes.push('GoPlus menandai potensi honeypot.');
  if (Number.isFinite(creatorPct)) notes.push('Creator/owner share sekitar ' + creatorPct.toFixed(2) + '%.');
  if (top10Pct) notes.push('Top holder concentration sekitar ' + top10Pct.toFixed(2) + '%.');
  if (mintable) notes.push('Mint authority masih aktif menurut GoPlus.');
  if (!notes.length) notes.push('Tidak ada red flag besar dari data GoPlus yang tersedia.');
  return { available: true, honeypot, creatorPct: Number.isFinite(creatorPct) ? creatorPct : null, top10Pct, mintable, notes };
}

function scorePair(pair, pairs, security) {
  const facts = securityFacts(security);
  const liquidity = num(pair.liquidity?.usd);
  const fdv = num(pair.fdv || pair.marketCap);
  const liqRatio = fdv ? liquidity / fdv : 0;
  const volume24 = num(pair.volume?.h24);
  const h1 = num(pair.priceChange?.h1); const h6 = num(pair.priceChange?.h6); const h24 = num(pair.priceChange?.h24);
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 86400000 : 0;
  let liquidityScore = logScore(liquidity, [[0,0],[1000,20],[10000,45],[100000,70],[1000000,90],[10000000,100]]);
  if (liqRatio && liqRatio < 0.01) liquidityScore = Math.min(liquidityScore, 35);
  const momentumScore = clamp(changeScore(h1) * 0.3 + changeScore(h6) * 0.3 + changeScore(h24) * 0.2 + buyPressure(pair) * 0.2);
  const volRatio = liquidity ? volume24 / liquidity : 0;
  let marketScore = 45 + Math.min(25, pairs.length * 4) + Math.min(20, ageDays * 2);
  if (volRatio > 0.05 && volRatio < 3) marketScore += 10; if (volRatio >= 3) marketScore -= 8;
  marketScore = clamp(marketScore);
  let riskScore = 72;
  if (liquidity < 10000) riskScore -= 18;
  if (liqRatio && liqRatio < 0.01) riskScore -= 20;
  if (h1 > 100 && liquidity < 50000) riskScore -= 18;
  if (facts.honeypot) riskScore = 0;
  if (facts.creatorPct !== null && facts.creatorPct > 20) riskScore -= 18;
  if (facts.top10Pct && facts.top10Pct > 50) riskScore -= 16;
  if (facts.mintable) riskScore -= 8;
  riskScore = clamp(riskScore);
  let score = liquidityScore * 0.35 + momentumScore * 0.25 + marketScore * 0.2 + riskScore * 0.2;
  const caps = [];
  if (liquidity < 1000) { score = Math.min(score, 20); caps.push('Likuiditas di bawah $1.000, score dibatasi 20 dan status tidak bisa dieksekusi.'); }
  if (facts.honeypot) { score = Math.min(score, 20); caps.push('Sinyal honeypot membuat score dibatasi 20.'); }
  if (liqRatio && liqRatio < 0.01) { score = Math.min(score, 35); caps.push('Rasio likuiditas/FDV di bawah 1%, score dibatasi 35.'); }
  if (h1 > 100 && liquidity < 50000) { score = Math.min(score, 45); caps.push('Pump 1 jam sangat tinggi di likuiditas tipis, score dibatasi 45.'); }
  score = Math.round(clamp(score));
  const executable = liquidity >= 1000 && !facts.honeypot;
  const bias = score >= 70 ? 'Naik' : score >= 45 ? 'Netral' : 'Turun';
  const confidence = !executable ? 'Rendah' : (ageDays > 7 && volume24 > 10000 && facts.available ? 'Tinggi' : ageDays > 1 && volume24 > 1000 ? 'Sedang' : 'Rendah');
  return { score, bias, confidence, executable, caps, facts, parts: { liquidityScore, momentumScore, marketScore, riskScore } };
}

function bar(label, value) { return '<div class="bar-row"><div class="bar-label"><span>' + label + '</span><b>' + Math.round(value) + '</b></div><div class="bar"><i style="width:' + clamp(value) + '%"></i></div></div>'; }

function render(pair, scored) {
  const token = pair.baseToken || {};
  const pairOptions = currentPairs.map((p, i) => '<option value="' + i + '"' + (p === pair ? ' selected' : '') + '>' + p.chainId + ' · ' + (p.dexId || 'DEX') + ' · ' + compact(p.liquidity?.usd) + '</option>').join('');
  const capHtml = scored.caps.length ? '<div class="cap"><b>Kenapa score dibatasi</b><br>' + scored.caps.join('<br>') + '</div>' : '';
  $('result').innerHTML = '<div class="dashboard">' +
    '<div class="token-head"><div class="token-title">' + (pair.info?.imageUrl ? '<img src="' + pair.info.imageUrl + '" alt="" />' : '') + '<div><h2>' + (token.name || 'Token') + ' <span class="muted">' + (token.symbol || '') + '</span></h2><p>' + pair.chainId + ' · ' + (pair.dexId || 'DEX') + ' · Pair age ' + ageText(pair) + '</p></div></div>' +
    '<label>Pair <select id="pairSelect">' + pairOptions + '</select></label></div>' +
    '<div class="score-grid"><div><div class="score-ring" style="--score:' + scored.score + '"><div><span><b>' + scored.score + '</b><br>Score</span></div></div></div><div>' +
    '<div class="badges"><span class="badge ' + (scored.bias === 'Naik' ? 'good' : scored.bias === 'Turun' ? 'bad' : 'warn') + '">Bias ' + scored.bias + '</span><span class="badge">Confidence ' + scored.confidence + '</span><span class="badge ' + (scored.executable ? 'good' : 'bad') + '">' + (scored.executable ? 'Bisa dieksekusi' : 'Tidak bisa dieksekusi') + '</span></div>' +
    bar('Likuiditas & eksekusi', scored.parts.liquidityScore) + bar('Momentum', scored.parts.momentumScore) + bar('Kualitas pasar', scored.parts.marketScore) + bar('Risiko creator + bundle', scored.parts.riskScore) + capHtml + '</div></div>' +
    '<div class="metrics"><div class="metric"><span>Price</span><b>' + money(pair.priceUsd) + '</b></div><div class="metric"><span>Liquidity</span><b>' + compact(pair.liquidity?.usd) + '</b></div><div class="metric"><span>FDV</span><b>' + compact(pair.fdv || pair.marketCap) + '</b></div><div class="metric"><span>Volume 24h</span><b>' + compact(pair.volume?.h24) + '</b></div><div class="metric"><span>1h</span><b>' + pct(pair.priceChange?.h1) + '</b></div><div class="metric"><span>6h</span><b>' + pct(pair.priceChange?.h6) + '</b></div><div class="metric"><span>24h</span><b>' + pct(pair.priceChange?.h24) + '</b></div><div class="metric"><span>Buy pressure</span><b>' + buyPressure(pair).toFixed(1) + '%</b></div></div>' +
    '<div class="panels"><div class="panel"><span>Estimasi slippage</span><table><tr><th>Trade</th><th>Impact</th></tr><tr><td>$10</td><td>' + slippage(pair, 10) + '</td></tr><tr><td>$100</td><td>' + slippage(pair, 100) + '</td></tr><tr><td>$1,000</td><td>' + slippage(pair, 1000) + '</td></tr></table></div>' +
    '<div class="panel"><span>Creator</span><p>' + (scored.facts.creatorPct === null ? 'Data creator share tidak tersedia.' : 'Creator/owner share sekitar ' + scored.facts.creatorPct.toFixed(2) + '%.') + '</p></div>' +
    '<div class="panel"><span>Bundle heuristic</span><p>' + (scored.facts.top10Pct ? 'Konsentrasi holder teratas sekitar ' + scored.facts.top10Pct.toFixed(2) + '%. Ini heuristik, bukan bukti bundle.' : 'Data konsentrasi holder tidak tersedia.') + '</p></div>' +
    '<div class="panel"><span>Security notes</span><p>' + scored.facts.notes.join(' ') + '</p></div></div>' +
    '<p class="muted">Source: DexScreener' + (scored.facts.available ? ' + GoPlus' : '') + ' · Updated ' + new Date().toLocaleString('id-ID') + ' · Score adalah signal, bukan nasihat finansial.</p></div>';
  $('result').classList.remove('hidden');
  $('pairSelect').addEventListener('change', async (event) => { const next = currentPairs[Number(event.target.value)]; currentSecurity = await fetchSecurity(next, currentAddress, detectMode(currentAddress, $('chainMode').value)); render(next, scorePair(next, currentPairs, currentSecurity)); });
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function analyze() {
  const address = $('addressInput').value.trim();
  const mode = detectMode(address, $('chainMode').value);
  $('formError').textContent = '';
  if (mode === 'invalid' || (mode === 'evm' && !isEvm(address)) || (mode === 'sol' && !isSolana(address))) { $('formError').textContent = 'Format contract address tidak valid untuk mode yang dipilih.'; return; }
  $('analyzeBtn').disabled = true; $('analyzeBtn').textContent = 'Analyzing...';
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address));
    const json = await res.json();
    currentPairs = (json.pairs || []).filter((p) => mode === 'sol' ? p.chainId === 'solana' : p.chainId !== 'solana').sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
    currentAddress = address;
    if (!currentPairs.length) { $('result').innerHTML = '<div class="dashboard"><h2>Tidak bisa dieksekusi</h2><p>Tidak ada pair ditemukan untuk address ini. Score tidak diterbitkan.</p></div>'; $('result').classList.remove('hidden'); return; }
    const pair = currentPairs[0];
    currentSecurity = await fetchSecurity(pair, address, mode);
    render(pair, scorePair(pair, currentPairs, currentSecurity));
  } catch { $('formError').textContent = 'Gagal mengambil data pair. Coba lagi sebentar.'; }
  finally { $('analyzeBtn').disabled = false; $('analyzeBtn').textContent = 'Analyze →'; }
}

$('analyzeBtn').addEventListener('click', analyze);
$('addressInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') analyze(); });
document.querySelectorAll('[data-sample]').forEach((button) => button.addEventListener('click', () => { $('addressInput').value = button.dataset.sample; $('chainMode').value = button.dataset.mode; analyze(); }));
