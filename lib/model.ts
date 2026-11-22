// Token Radar's fitted value model: one snapshot in, one ranked board out.
//
// The board ranks ALL 758 protocols in the snapshot. A protocol's implied value is either the
// market's own number (its recorded market cap, when it has one) or the model's claim. A protocol
// that records no token but is, by its category or name, a wrapped, staked, bridged or exchange
// product of a token that already trades is set aside with the live ones: its token already
// trades in another form, so it is not a protocol still waiting on a launch.
//
//   log(mcap / tvl) = global + category adjustment + size + growth + age + chains
//
//   global      the median log multiple of the 128 token protocols with a positive market cap
//   category    the category's median log multiple, shrunk toward the global median with
//               weight n / (n + 5), so a category with one protocol barely moves the model
//   size        fitted: larger TVL trades at a lower multiple (OLS, -0.32 per log unit)
//   growth      fitted: the 7-day TVL change, clamped to [-60, 120] per cent
//   age         fitted: log days since first listed (a protocol's time running with no token)
//   chains      fitted: log number of chains the protocol's TVL sits on
//
// The four fitted coefficients come from an OLS regression of the residuals (after the category
// medians) on the centred features, run on winsorised log multiples (5th/95th percentiles). The
// validation is honest 5-fold cross-validation by slug order: fit on four folds, predict the fifth,
// pool all 128 predictions. Median absolute error is about 87% in value terms, because market
// cap / TVL multiples genuinely span four orders of magnitude; the ranking is a prior built from
// category-typical multiples, not a price target. The dashboard states the number.
//
// No protocol name is ever special-cased. Verdicts and farm plans are rules over the snapshot's
// own fields (category, chains, TVL, age, growth, token status) and the fitted numbers.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One fitted category adjustment, as the dashboard's model section shows it. */
export interface CategoryAdjustment {
  category: string;
  n: number;
  adjustment: number;
  multiple: number;
}

/** The fitted model, as the dashboard states it. */
export interface FittedModel {
  global_log_multiple: number;
  global_multiple: number;
  coefficients: { intercept: number; growth: number; log_age: number; log_chains: number; log_tvl: number };
  centers: { growth: number; log_age: number; log_chains: number; log_tvl: number };
  winsor: { lo: number; hi: number };
  medians: { age_days: number; growth_pct: number };
  category_adjustments: CategoryAdjustment[];
  comp_count: number;
}

/** Out-of-sample validation, pooled over the five folds. */
export interface ModelValidation {
  method: string;
  folds: number;
  n: number;
  median_abs_log_error: number;
  median_abs_pct_error: number;
  median_signed_log_error: number;
  mean_abs_log_error: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  pre_token_rank: number | null;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token' | 'live';
  value_basis: 'model' | 'market-cap' | 'model-no-mcap';
  implied_value_usd: number;
  multiple: number;
  verdict: 'farm' | 'thin' | 'skip';
  verdict_reason: string;
  components: {
    global_multiple: number;
    category_factor: number;
    growth_factor: number;
    age_factor: number;
    chain_factor: number;
    size_factor: number;
    intercept_factor: number;
    clamp_factor: number;
  } | null;
  farm_steps: string[];
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: FittedModel;
  validation: ModelValidation;
  watchlist_size: number;
  board_size: number;
  pre_token_size: number;
  live_size: number;
  live_with_mcap: number;
  early_size: number;
  median_multiple_pre_token: number;
  top_pre_token: { slug: string; name: string; implied_value_usd: number };
  rows: BoardRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2-fitted';

const DAY_MS = 86_400_000;
const GROWTH_FLOOR = -60;
const GROWTH_CAP = 120;
const LOG_MULT_FLOOR = -4;
const LOG_MULT_CAP = 2;
const SHRINK_K = 5;
const CAT_ADJ_CAP = 1.5;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The median of a non-empty list, deterministic: the sorted list's middle element. */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)]!;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all (no market cap, no CoinGecko id, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name that says the product is wrapped, staked or staking something else's token. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/** Categories whose product is, by definition, another token's wrapper, stake or bridge. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol's farm plan must say skip for a structural reason, with the reason. */
export function structuralSkip(p: SnapshotProtocol): string | null {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) {
    if (p.category === 'CEX') return 'a centralised exchange: its token, if any, is the exchange\'s own, not a protocol launch to farm';
    return `a ${p.category} product: a wrapped, staked or bridged form of a token that already trades, not a launch of its own`;
  }
  if (WRAPPED_OR_STAKED.test(p.name)) return 'its name marks it a wrapped or staked product of a token that already trades';
  if (VERSIONED.test(p.name)) return 'its name ends in a version marker: a pool of another protocol, not a launch of its own';
  return null;
}

// ---------------------------------------------------------------- fitting

/** One comparison protocol's features, for the fit. */
interface CompFeatures {
  growth: number;
  logAge: number;
  logChains: number;
  logTvl: number;
  logMult: number;
}

function compFeatures(p: SnapshotProtocol, medAge: number, medGrowth: number, asOf: string): CompFeatures {
  const growth = clamp(finite(p.change_7d, medGrowth), GROWTH_FLOOR, GROWTH_CAP);
  const age = ageDays(asOf, p.listed_at);
  return {
    growth,
    logAge: Math.log(Math.max(age ?? medAge, 1)),
    logChains: Math.log(Math.max(p.chains.length, 1)),
    logTvl: Math.log(Math.max(p.tvl_usd, 1)),
    logMult: Math.log(p.mcap_usd! / p.tvl_usd),
  };
}

/** Ordinary least squares by Gaussian elimination with partial pivoting; rows are {x, y}. */
function ols(rows: { x: number[]; y: number }[]): number[] {
  const n = rows[0]!.x.length;
  const xtx: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const xty: number[] = new Array<number>(n).fill(0);
  for (const r of rows) {
    for (let i = 0; i < n; i++) {
      xty[i]! += r.x[i]! * r.y;
      for (let j = 0; j < n; j++) xtx[i]![j]! += r.x[i]! * r.x[j]!;
    }
  }
  const m = xtx.map((row, i) => [...row, xty[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!;
    m[col] = m[piv]!;
    m[piv] = tmp;
    const d = m[col]![col]!;
    for (let j = col; j <= n; j++) m[col]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      for (let j = col; j <= n; j++) m[r]![j]! -= f * m[col]![j]!;
    }
  }
  return m.map((row) => row[n]!);
}

/** The fitted model, from the token protocols with a positive market cap. */
export function fitModel(protocols: SnapshotProtocol[], asOf: string): FittedModel {
  const comps = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const ages = comps.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medAge = median(ages);
  const growths = comps.map((p) => p.change_7d).filter((g): g is number => g !== null);
  const medGrowth = median(growths);
  const feats = comps.map((p) => compFeatures(p, medAge, medGrowth, asOf));
  const sortedY = feats.map((f) => f.logMult).sort((a, b) => a - b);
  const winsorLo = sortedY[Math.floor(0.05 * sortedY.length)]!;
  const winsorHi = sortedY[Math.floor(0.95 * sortedY.length)]!;
  const win = (y: number): number => clamp(y, winsorLo, winsorHi);

  const globalLog = median(feats.map((f) => win(f.logMult)));
  const byCat = new Map<string, number[]>();
  for (let i = 0; i < comps.length; i++) {
    const cat = comps[i]!.category ?? 'Other';
    const list = byCat.get(cat) ?? [];
    list.push(win(feats[i]!.logMult));
    byCat.set(cat, list);
  }
  const categoryAdjustments: CategoryAdjustment[] = [...byCat.entries()]
    .map(([category, values]) => {
      const adj = clamp((values.length / (values.length + SHRINK_K)) * (median(values) - globalLog), -CAT_ADJ_CAP, CAT_ADJ_CAP);
      return { category, n: values.length, adjustment: round4(adj), multiple: round4(Math.exp(globalLog + adj)) };
    })
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const adjOf = new Map(categoryAdjustments.map((c) => [c.category, c.adjustment]));

  const centers = {
    growth: median(feats.map((f) => f.growth)),
    log_age: median(feats.map((f) => f.logAge)),
    log_chains: median(feats.map((f) => f.logChains)),
    log_tvl: median(feats.map((f) => f.logTvl)),
  };
  const beta = ols(
    feats.map((f, i) => ({
      x: [1, f.growth - centers.growth, f.logAge - centers.log_age, f.logChains - centers.log_chains, f.logTvl - centers.log_tvl],
      y: win(f.logMult) - (globalLog + (adjOf.get(comps[i]!.category ?? 'Other') ?? 0)),
    })),
  );
  return {
    global_log_multiple: round4(globalLog),
    global_multiple: round4(Math.exp(globalLog)),
    coefficients: {
      intercept: round4(beta[0]!),
      growth: round4(beta[1]!),
      log_age: round4(beta[2]!),
      log_chains: round4(beta[3]!),
      log_tvl: round4(beta[4]!),
    },
    centers: {
      growth: round4(centers.growth),
      log_age: round4(centers.log_age),
      log_chains: round4(centers.log_chains),
      log_tvl: round4(centers.log_tvl),
    },
    winsor: { lo: round4(winsorLo), hi: round4(winsorHi) },
    medians: { age_days: medAge, growth_pct: round4(medGrowth) },
    category_adjustments: categoryAdjustments,
    comp_count: comps.length,
  };
}

/** The model's predicted log multiple for one protocol, with its components. The factors multiply:
 * implied = tvl x global_multiple x category_factor x growth_factor x age_factor x chain_factor
 * x size_factor x intercept_factor x clamp_factor. The category factor is the category's lift over
 * the global median (exp of the shrunk adjustment); the category's own absolute multiple is the
 * global multiple times this factor, and the dashboard's model section shows that. The clamp factor
 * is 1 unless the raw log multiple falls outside [-4, 2], in which case it lifts or cuts it to the
 * bound, so the factors always multiply to the implied value the board carries. */
export function predictLogMultiple(
  model: FittedModel,
  p: SnapshotProtocol,
  asOf: string,
): { logMult: number; globalMultiple: number; categoryFactor: number; growthFactor: number; ageFactor: number; chainFactor: number; sizeFactor: number; interceptFactor: number; clampFactor: number } {
  const adj = model.category_adjustments.find((c) => c.category === (p.category ?? 'Other'));
  const adjValue = adj === undefined ? 0 : adj.adjustment;
  const growth = clamp(finite(p.change_7d, model.medians.growth_pct), GROWTH_FLOOR, GROWTH_CAP);
  const age = ageDays(asOf, p.listed_at);
  const logAge = Math.log(Math.max(age ?? model.medians.age_days, 1));
  const logChains = Math.log(Math.max(p.chains.length, 1));
  const logTvl = Math.log(Math.max(p.tvl_usd, 1));
  const c = model.coefficients;
  const growthFactor = Math.exp(c.growth * (growth - model.centers.growth));
  const ageFactor = Math.exp(c.log_age * (logAge - model.centers.log_age));
  const chainFactor = Math.exp(c.log_chains * (logChains - model.centers.log_chains));
  const sizeFactor = Math.exp(c.log_tvl * (logTvl - model.centers.log_tvl));
  const rawLogMult =
    model.global_log_multiple + adjValue + c.intercept + c.growth * (growth - model.centers.growth) + c.log_age * (logAge - model.centers.log_age) + c.log_chains * (logChains - model.centers.log_chains) + c.log_tvl * (logTvl - model.centers.log_tvl);
  const logMult = clamp(rawLogMult, LOG_MULT_FLOOR, LOG_MULT_CAP);
  return {
    logMult,
    globalMultiple: model.global_multiple,
    categoryFactor: round4(Math.exp(adjValue)),
    growthFactor: round4(growthFactor),
    ageFactor: round4(ageFactor),
    chainFactor: round4(chainFactor),
    sizeFactor: round4(sizeFactor),
    interceptFactor: round4(Math.exp(c.intercept)),
    clampFactor: round4(Math.exp(logMult - rawLogMult)),
  };
}

/** Five-fold cross-validation by slug order: fit on four folds, predict the fifth, pool the errors. */
export function validateModel(protocols: SnapshotProtocol[], asOf: string): ModelValidation {
  const comps = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const logErrors: number[] = [];
  const pctErrors: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = comps.filter((_, i) => i % 5 === fold);
    const train = comps.filter((_, i) => i % 5 !== fold);
    const model = fitModel(train, asOf);
    for (const p of test) {
      const actual = Math.log(p.mcap_usd! / p.tvl_usd);
      const predicted = predictLogMultiple(model, p, asOf).logMult;
      logErrors.push(predicted - actual);
      pctErrors.push(Math.abs(Math.exp(predicted) - Math.exp(actual)) / Math.exp(actual));
    }
  }
  return {
    method: '5-fold cross-validation by slug order: fit on four folds, predict the fifth, errors pooled',
    folds: 5,
    n: comps.length,
    median_abs_log_error: round4(median(logErrors.map((e) => Math.abs(e)))),
    median_abs_pct_error: round4(median(pctErrors)),
    median_signed_log_error: round4(median(logErrors)),
    mean_abs_log_error: round4(logErrors.reduce((a, e) => a + Math.abs(e), 0) / logErrors.length),
  };
}

// ---------------------------------------------------------------- money and time

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return 'not reported';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A rough gas price in dollars for one transaction on a chain, from the chain's family. */
export function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 8;
  if (c.includes('solana')) return 0.05;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('zksync') || c.includes('blast') || c.includes('linea') || c.includes('scroll') || c.includes('mantle') || c.includes('mode') || c.includes('starknet')) return 0.5;
  if (c.includes('bnb') || c.includes('binance smart') || c.includes('bsc')) return 0.3;
  if (c.includes('polygon') || c.includes('avalanche') || c.includes('tron') || c.includes('sui') || c.includes('aptos') || c.includes('near') || c.includes('fantom') || c.includes('gnosis')) return 1;
  return 2;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable') || c.includes('algo-stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad')) return `Commit $${capital} to a ${name} launch on ${chain} and hold the allocation.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold the shares.`;
  if (c.includes('payment') || c.includes('card')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts.`;
  if (c.includes('ai agent') || c.includes('decentralized ai')) return `Deposit $${capital} into ${name} on ${chain} and run one agent task a week.`;
  if (c.includes('token locker')) return `Lock $${capital} of tokens in ${name} on ${chain} for the full term.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote on one proposal.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan, derived from its own record and the fitted model: the verdict first, then
 * the steps. Costs name dollars and gas on its main chain; times name minutes or days. A skip plan
 * spends almost nothing: the point is to stay out.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, verdict: 'farm' | 'thin' | 'skip', verdictReason: string, implied: number, multiple: number): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasUsd(chain);
  const gasText = gas < 1 ? `$${gas.toFixed(2)}` : `$${gas}`;
  const baseCapital = capitalFor(p);
  const capital = verdict === 'farm' ? baseCapital : verdict === 'thin' ? Math.max(25, Math.round(baseCapital / 2)) : 25;
  const hold = holdDaysFor(age);
  const verdictStep: FarmStep = {
    text: `Verdict: ${verdict} — ${verdictReason}`,
    cost: verdict === 'skip' ? 'nothing committed' : `$${capital} of capital at risk`,
    time: verdict === 'skip' ? 'no waiting' : `${hold} days held`,
  };
  const setup: FarmStep = {
    text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
    cost: `under ${gasText} of gas for the first transaction`,
    time: '5 minutes',
  };
  if (verdict === 'skip') {
    return [
      setup,
      {
        text: `Open ${p.name} on ${chain} with $${capital} only, click through its app once, and close the position the same day: this is reconnaissance, not a farm.`,
        cost: `$${capital} at risk for a day and about ${gasText} of gas`,
        time: '20 minutes',
      },
      verdictStep,
      {
        text: 'Check the protocol\'s own announcements page once a month for a token or points program; never pay anyone to claim for you.',
        cost: 'no fee to check',
        time: '5 minutes a month',
      },
      {
        text: 'Write the wallet, the dates and the verdict in a farm log so you remember why you stayed out.',
        cost: 'nothing but the log',
        time: '5 minutes',
      },
    ];
  }
  const steps: FarmStep[] = [
    setup,
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gasText} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and vary the action so the activity reads as use, not a script.',
      cost: `about ${gasText} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    verdictStep,
  ];
  if (verdict === 'farm') {
    steps.push(
      {
        text: `This is the board's strongest case at this size: fitted multiple ${multiple.toFixed(2)}x on ${fmtUsd(p.tvl_usd)} of TVL, implied ${fmtUsd(implied)}. Size the position to what you can lose outright.`,
        cost: `the $${capital} stays in the position`,
        time: '5 minutes to check the numbers',
      },
      {
        text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.',
        cost: 'no fee to check, and never pay to claim',
        time: '10 minutes',
      },
    );
  } else {
    steps.push({
      text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.',
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    });
  }
  steps.push({
    text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
    cost: 'nothing but the log',
    time: '5 minutes',
  });
  return steps;
}

/** A live-token protocol's plan: the token already trades (or is a wrapped, staked, bridged or
 * exchange form of one that does), so the plan is about yield, not a launch. */
export function liveSteps(p: SnapshotProtocol, age: number | null, verdictReason: string): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasUsd(chain);
  const gasText = gas < 1 ? `$${gas.toFixed(2)}` : `$${gas}`;
  const capital = capitalFor(p);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to use, and keep its seed phrase offline.',
      cost: `under ${gasText} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gasText} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Verdict: skip — ${verdictReason}. Farm only for yield, never for an airdrop.`,
      cost: 'nothing committed for a launch',
      time: 'no waiting',
    },
    {
      text: 'Compare the yield you actually receive against the same deposit on a lending market, and leave when the spread closes.',
      cost: 'about $1 of gas to exit',
      time: '10 minutes a week',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n and pre-token ranks. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const model = fitModel(snapshot.protocols, snapshot.as_of);

  // First pass: score every protocol, so the verdict thresholds can use the board's own medians.
  interface Scored {
    p: SnapshotProtocol;
    age: number | null;
    implied: number;
    multiple: number;
    tokenStatus: 'pre-token' | 'live';
    valueBasis: 'model' | 'market-cap' | 'model-no-mcap';
    components: BoardRow['components'];
  }
  const scored: Scored[] = snapshot.protocols.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    // A wrapped, staked, bridged or exchange product is not a protocol still waiting on a launch:
    // its token already trades in another form (WBTC is Bitcoin on Ethereum, Binance staked ETH is
    // ETH in a staking product). The snapshot's record alone cannot tell that, so the board reads the
    // category and the name as well and sets such a protocol aside with the live ones. This is a rule
    // over the snapshot's own fields, never a list of names.
    const structural = structuralSkip(p);
    const isLive = !isPreToken(p) || structural !== null;
    if (isLive && p.mcap_usd !== null && p.mcap_usd > 0) {
      return {
        p,
        age,
        implied: p.mcap_usd,
        multiple: round4(p.mcap_usd / p.tvl_usd),
        tokenStatus: 'live' as const,
        valueBasis: 'market-cap' as const,
        components: null,
      };
    }
    const pred = predictLogMultiple(model, p, snapshot.as_of);
    const implied = Math.max(1, Math.round(p.tvl_usd * Math.exp(pred.logMult)));
    return {
      p,
      age,
      implied,
      multiple: round4(Math.exp(pred.logMult)),
      tokenStatus: isLive ? ('live' as const) : ('pre-token' as const),
      valueBasis: isLive ? ('model-no-mcap' as const) : ('model' as const),
      components: {
        global_multiple: pred.globalMultiple,
        category_factor: pred.categoryFactor,
        growth_factor: pred.growthFactor,
        age_factor: pred.ageFactor,
        chain_factor: pred.chainFactor,
        size_factor: pred.sizeFactor,
        intercept_factor: pred.interceptFactor,
        clamp_factor: pred.clampFactor,
      },
    };
  });

  const preMultiples = scored.filter((s) => s.tokenStatus === 'pre-token').map((s) => s.multiple);
  const medianPreMultiple = median(preMultiples);

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // A ranking needs strictly falling values: two protocols that tie on value differ by a dollar.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) scored[i]!.implied = Math.max(1, scored[i - 1]!.implied - 1);
  }

  let preRank = 0;
  const rows: BoardRow[] = scored.map((s, i) => {
    if (s.tokenStatus === 'pre-token') preRank += 1;
    const p = s.p;
    let verdict: 'farm' | 'thin' | 'skip';
    let reason: string;
    if (s.tokenStatus === 'live') {
      verdict = 'skip';
      const structural = structuralSkip(p);
      reason = s.valueBasis === 'market-cap'
        ? `the token already trades (market cap ${fmtUsd(p.mcap_usd!)}), so there is no launch left to farm`
        : structural !== null
          ? structural
          : 'the token already trades, but no market cap is recorded, so the model value is a rough guide only';
    } else {
      const skip = structuralSkip(p);
      if (skip !== null) {
        verdict = 'skip';
        reason = skip;
      } else if (s.multiple >= 1.5 * medianPreMultiple && (p.change_7d ?? 0) >= -20) {
        verdict = 'farm';
        reason = `fitted multiple ${s.multiple.toFixed(2)}x, ${s.multiple < medianPreMultiple * 2 ? 'well above' : 'far above'} the pre-token median ${medianPreMultiple.toFixed(2)}x, with 7d growth ${fmtPct(p.change_7d)}`;
      } else if (s.multiple >= 0.8 * medianPreMultiple) {
        verdict = 'thin';
        reason = `fitted multiple ${s.multiple.toFixed(2)}x, near the pre-token median ${medianPreMultiple.toFixed(2)}x: worth a small position, not a large one`;
      } else {
        verdict = 'skip';
        reason = `fitted multiple ${s.multiple.toFixed(2)}x, below the pre-token median ${medianPreMultiple.toFixed(2)}x: the market would pay less for this TVL than for a typical pre-token protocol`;
      }
    }
    const steps = s.tokenStatus === 'live'
      ? liveSteps(p, s.age, reason)
      : farmSteps(p, s.age, verdict, reason, s.implied, s.multiple);
    return {
      rank: i + 1,
      pre_token_rank: s.tokenStatus === 'pre-token' ? preRank : null,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: s.age,
      token_status: s.tokenStatus,
      value_basis: s.valueBasis,
      implied_value_usd: s.implied,
      multiple: s.multiple,
      verdict,
      verdict_reason: reason,
      components: s.components,
      farm_steps: steps.map(stepText),
    };
  });

  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  const slugs = new Set(rows.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) throw new SnapshotError(`watchlist slug ${slug} is not in the snapshot`);
  }
  return rows;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot.protocols, snapshot.as_of);
  const validation = validateModel(snapshot.protocols, snapshot.as_of);
  const board = buildBoard(snapshot);
  const preRows = board.filter((r) => r.token_status === 'pre-token');
  const liveRows = board.filter((r) => r.token_status === 'live');
  const early = preRows.filter((r) => !snapshot.watchlist.includes(r.slug) && r.tvl_usd < snapshot.floor_usd).length;
  const topPre = preRows[0]!;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    pre_token_size: preRows.length,
    live_size: liveRows.length,
    live_with_mcap: liveRows.filter((r) => r.value_basis === 'market-cap').length,
    early_size: early,
    median_multiple_pre_token: round4(median(preRows.map((r) => r.multiple))),
    top_pre_token: { slug: topPre.slug, name: topPre.name, implied_value_usd: topPre.implied_value_usd },
    rows: board,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
