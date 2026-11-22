// Token Radar's dark dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own components and the protocol's farm plan, and the fitted model's own numbers. No network:
// every byte it shows is in data.js. A protocol "records no token" when the snapshot carries no
// market cap, CoinGecko id or symbol for it; that is a record, never a claim that it has none.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function baseRows() {
    if (state.tab === 'pre-token') return DATA.rows.filter(function (r) { return r.token_status === 'pre-token'; });
    if (state.tab === 'live') return DATA.rows.filter(function (r) { return r.token_status === 'live'; });
    return DATA.rows;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return baseRows().filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else if (key === 'verdict') { av = a.verdict; bv = b.verdict; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Every protocol that records no token, ranked by what its token would be worth' }),
        el('p', null,
          'The watchlist is the floor: ', el('b', { text: DATA.watchlist_size + ' protocols' }),
          ' with at least $50M of TVL and no token on record. The radar adds ',
          el('b', { text: DATA.early_size + ' pre-token protocols below that floor' }),
          ' and ranks all ', el('b', { text: DATA.board_size + ' protocols' }),
          ' in the snapshot. Wrapped, staked, bridged and exchange products are set aside with the live ones — their token already trades in another form — and live-token protocols are ranked by their recorded market cap where one exists.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.pre_token_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols' }), el('b', { text: String(DATA.live_size) + ' (' + DATA.live_with_mcap + ' with a market cap)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Model' }), el('b', { text: 'fitted, not hardcoded' }))
      )
    );
  }

  function kpis() {
    var v = DATA.validation;
    return el('section', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('b', { class: 'accent', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
      el('div', { class: 'kpi' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'protocols ranked' })),
      el('div', { class: 'kpi' }, el('b', { text: fmtUsd(DATA.top_pre_token.implied_value_usd) }), el('span', { text: 'top pre-token: ' + DATA.top_pre_token.name })),
      el('div', { class: 'kpi' }, el('b', { text: fmtMult(DATA.model.global_multiple) }), el('span', { text: 'median mcap / TVL of token protocols' })),
      el('div', { class: 'kpi' }, el('b', { class: 'amber', text: (v.median_abs_pct_error * 100).toFixed(0) + '%' }), el('span', { text: 'out-of-sample median error (5-fold)' })),
      el('div', { class: 'kpi' }, el('b', { text: fmtMult(DATA.median_multiple_pre_token) }), el('span', { text: 'median fitted multiple, pre-token' }))
    );
  }

  function optionList(values, current, allLabel) {
    var opts = [el('option', { value: 'all', text: allLabel })];
    values.forEach(function (v) { opts.push(el('option', { value: v, text: v, selected: v === current ? 'selected' : null })); });
    return opts;
  }

  function controls() {
    var pool = baseRows();
    var categories = Array.from(new Set(pool.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    pool.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); }).slice(0, 24);

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' }, optionList(categories, state.category, 'All categories'));
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' }, optionList(chains, state.chain, 'All chains'));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var verdictSel = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' }, optionList(['farm', 'thin', 'skip'], state.verdict, 'All verdicts'));
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; writeHash(); render(); });

    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('all', 'All 758'), tabBtn('live', 'Live token'))),
      el('span', { class: 'count', text: rows().length + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankCell = r.token_status === 'pre-token'
        ? el('div', { class: 'name' }, el('b', { class: 'num', text: '#' + r.rank }), el('span', { class: 'sub', text: 'pre #' + r.pre_token_rank }))
        : el('div', { class: 'name' }, el('b', { class: 'num', text: '#' + r.rank }), el('span', { class: 'sub', text: 'live' }));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, rankCell),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'verdict ' + r.verdict, text: r.verdict }))
      );
      tbody.appendChild(tr);
    });
    var caption = state.tab === 'pre-token'
      ? 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.'
      : state.tab === 'live'
        ? 'Token live, or a wrapped, staked, bridged or exchange form of one that trades. Market cap is a fact where recorded; the model values the rest. Farm only for yield.'
        : 'All 758 protocols, strongest value first: pre-token rows by the fitted model, live rows by recorded market cap or the model where none is recorded.';
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: caption }),
          el('colgroup', null,
            el('col', { class: 'c-rank' }),
            el('col', null),
            el('col', { class: 'c-tvl' }),
            el('col', { class: 'c-7d' }),
            el('col', { class: 'c-age' }),
            el('col', { class: 'c-mult' }),
            el('col', { class: 'c-implied' }),
            el('col', { class: 'c-verdict' })
          ),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Verdict')
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var v = DATA.validation;
    var cats = m.category_adjustments.slice().sort(function (a, b) { return b.multiple - a.multiple; });
    var topCats = cats.slice(0, 6);
    var bottomCats = cats.slice(-6);
    function catRows(list) {
      return list.map(function (c) {
        return el('div', null, el('span', { text: c.category + ' (n=' + c.n + ')' }), el('b', { text: fmtMult(c.multiple) }));
      });
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', null, 'One fitted model scores every protocol. Its multiples come from the ',
        el('b', { text: m.comp_count + ' protocols that already trade' }),
        ' (positive market cap): the category median multiple, shrunk toward the global median, then adjusted by the fitted effects of size, growth, age and chains. No protocol name is special-cased, and no row is hand-picked.'
      ),
      el('div', { class: 'formula' },
        'log(mcap / tvl) = ', el('b', { text: m.global_log_multiple.toFixed(3) }), ' (global median) + category adj. + ',
        el('b', { text: m.coefficients.intercept.toFixed(3) }), ' + ', el('b', { text: m.coefficients.growth.toFixed(3) }), ' x (growth - ', m.centers.growth.toFixed(1), ') + ',
        el('b', { text: m.coefficients.log_age.toFixed(3) }), ' x (log age - ', m.centers.log_age.toFixed(2), ') + ',
        el('b', { text: m.coefficients.log_chains.toFixed(3) }), ' x (log chains - ', m.centers.log_chains.toFixed(2), ') + ',
        el('b', { text: m.coefficients.log_tvl.toFixed(3) }), ' x (log TVL - ', m.centers.log_tvl.toFixed(2), ')'
      ),
      el('div', { class: 'model-grid' },
        el('div', null,
          el('h3', { text: 'Validation, out of sample' }),
          el('div', { class: 'coeffs' },
            el('div', null, el('span', { text: 'Method' }), el('b', { text: '5-fold by slug' })),
            el('div', null, el('span', { text: 'Protocols held out' }), el('b', { text: String(v.n) })),
            el('div', null, el('span', { text: 'Median |log error|' }), el('b', { text: String(v.median_abs_log_error) })),
            el('div', null, el('span', { text: 'Median |value error|' }), el('b', { text: (v.median_abs_pct_error * 100).toFixed(1) + '%' })),
            el('div', null, el('span', { text: 'Median signed log error' }), el('b', { text: String(v.median_signed_log_error) }))
          )
        ),
        el('div', null,
          el('h3', { text: 'Highest category multiples' }),
          el('div', { class: 'cats' }, catRows(topCats))
        ),
        el('div', null,
          el('h3', { text: 'Lowest category multiples' }),
          el('div', { class: 'cats' }, catRows(bottomCats))
        )
      ),
      el('p', { class: 'caveat' }, 'Read the error before the ranking: multiples span four orders of magnitude, so the median out-of-sample error is about ' + (v.median_abs_pct_error * 100).toFixed(0) + '%. Implied value is a ranking prior, not a price target, and it says nothing about whether or when a token is issued. Growth is clamped to -60..120%, log multiples are winsorised at the 5th and 95th percentiles and the log multiple itself is clamped to -4..2, and an unknown age uses the comparison median of ' + m.medians.age_days + ' days.')
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var head = el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.token_status === 'pre-token' ? ' · pre-token #' + row.pre_token_rank : ' · live token') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
    dialog.appendChild(head);

    var eq = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
      el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
      el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String(row.chains ? row.chains.length : 0) }))
    );
    var valueNote;
    if (row.value_basis === 'market-cap') {
      eq.appendChild(el('div', null, el('span', { text: 'Recorded market cap' }), el('b', { class: 'num', text: fmtUsd(row.mcap_usd) })));
      eq.appendChild(el('div', { class: 'total' }, el('span', { text: 'Value shown' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })));
      valueNote = 'The token already trades, so the value shown is the market cap the snapshot records, not a model. The model never scores a live protocol.';
    } else {
      var comp = row.components;
      var recomputed = Math.round(row.tvl_usd * comp.global_multiple * comp.category_factor * comp.growth_factor * comp.age_factor * comp.chain_factor * comp.size_factor * comp.intercept_factor * comp.clamp_factor);
      eq.appendChild(el('div', null, el('span', { text: 'Global multiple' }), el('b', { class: 'num', text: fmtMult(comp.global_multiple) })));
      eq.appendChild(el('div', null, el('span', { text: 'Category factor' }), el('b', { class: 'num', text: comp.category_factor.toFixed(3) + 'x' })));
      eq.appendChild(el('div', null, el('span', { text: 'Growth factor' }), el('b', { class: 'num', text: comp.growth_factor.toFixed(3) + 'x' })));
      eq.appendChild(el('div', null, el('span', { text: 'Age factor' }), el('b', { class: 'num', text: comp.age_factor.toFixed(3) + 'x' })));
      eq.appendChild(el('div', null, el('span', { text: 'Chain factor' }), el('b', { class: 'num', text: comp.chain_factor.toFixed(3) + 'x' })));
      eq.appendChild(el('div', null, el('span', { text: 'Size factor' }), el('b', { class: 'num', text: comp.size_factor.toFixed(3) + 'x' })));
      eq.appendChild(el('div', null, el('span', { text: 'Intercept factor' }), el('b', { class: 'num', text: comp.intercept_factor.toFixed(3) + 'x' })));
      if (comp.clamp_factor !== 1) {
        eq.appendChild(el('div', null, el('span', { text: 'Clamp factor' }), el('b', { class: 'num', text: comp.clamp_factor.toFixed(3) + 'x' })));
      }
      eq.appendChild(el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })));
      valueNote = row.value_basis === 'model-no-mcap'
        ? row.verdict_reason.charAt(0).toUpperCase() + row.verdict_reason.slice(1) + '. Recomputed from the factors above: ' + fmtUsd(recomputed) + '.'
        : 'Model ' + DATA.model_version + ': the same function scores every protocol — TVL times the factors above. Recomputed from the rounded factors: ' + fmtUsd(recomputed) + ', against ' + fmtUsd(row.implied_value_usd) + ' on the board; the difference is the rounding of the factors' + (row.components.clamp_factor !== 1 ? ', and the clamp factor, which brings this row\u2019s raw log multiple inside the model\u2019s [-4, 2] bounds' : '') + '. This is an estimate, not a price.';
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      eq,
      el('p', { text: valueNote })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'verdict-line' }, el('b', { text: 'Verdict: ' + row.verdict }), ' — ' + row.verdict_reason + '.'),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + DATA.board_size + ' protocols at or above $5M TVL.' }),
      el('span', { text: '"Records no token" means the snapshot carries no market cap, CoinGecko id or symbol for the protocol; it is not proof that no token exists.' }),
      el('span', { text: 'Implied values are the model\u2019s claim, never a price, and say nothing about whether or when a token is issued. No network, no tracking.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(kpis());
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    if (state.tab !== 'live') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
