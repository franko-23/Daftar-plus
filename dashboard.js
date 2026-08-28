const token = localStorage.getItem('daftari_token');
const userRaw = localStorage.getItem('daftari_user');

if (!token || !userRaw) {
  window.location.href = 'login.html';
}

const user = JSON.parse(userRaw);
const isAdmin = user.role === 'admin';

document.getElementById('userBadge').textContent = `${user.full_name} · ${isAdmin ? 'Admin' : 'Muuzaji'}`;
if (!isAdmin) {
  document.getElementById('ripotiTabBtn').style.display = 'none';
  document.getElementById('usersTabBtn').style.display = 'none';
  document.getElementById('addProductCard').style.display = 'none';
  document.querySelectorAll('.admin-only-col').forEach(el => el.style.display = 'none');
} else {
  const bizRaw = localStorage.getItem('daftari_business');
  if (bizRaw) {
    const biz = JSON.parse(bizRaw);
    document.getElementById('bizName').textContent = biz.name;
    document.getElementById('bizCode').textContent = biz.code;
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', 'POST'); } catch {}
  localStorage.removeItem('daftari_token');
  localStorage.removeItem('daftari_user');
  localStorage.removeItem('daftari_business');
  window.location.href = 'login.html';
});

async function api(path, method = 'GET', body = null) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hitilafu imetokea.');
  return data;
}

function fmt(n) {
  return 'TSh ' + Number(n || 0).toLocaleString('en-US');
}

function fmtDate(s) {
  return new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'))
    .toLocaleString('sw-TZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[ch]));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.style.display === 'none') return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'ripoti' && isAdmin && !reportLoaded) loadReports();
    if (btn.dataset.tab === 'watumiaji' && isAdmin && !usersLoaded) loadUsers();
  });
});

async function loadSummary() {
  try {
    const { summary } = await api('/api/dashboard');
    let html = `
      <div class="stat"><span class="stat-label">Mauzo</span><span class="stat-value">${summary.totalSales}</span></div>
      <div class="stat"><span class="stat-label">Mapato</span><span class="stat-value">${fmt(summary.totalRevenue)}</span></div>
      <div class="stat"><span class="stat-label">Matumizi</span><span class="stat-value">${fmt(summary.totalExpenses)}</span></div>
      <div class="stat"><span class="stat-label">Madeni</span><span class="stat-value">${fmt(summary.totalDebts)}</span></div>`;
    if (isAdmin) {
      html += `<div class="stat highlight"><span class="stat-label">Faida</span><span class="stat-value">${fmt(summary.totalProfit)}</span></div>`;
    }
    document.getElementById('summaryStrip').innerHTML = html;

    if (isAdmin) {
      document.getElementById('reportGrid').innerHTML = `
        <div class="report-item"><span>Mapato Yote</span><b>${fmt(summary.totalRevenue)}</b></div>
        <div class="report-item"><span>Gharama za Bidhaa</span><b>${fmt(summary.totalCost)}</b></div>
        <div class="report-item"><span>Matumizi</span><b>${fmt(summary.totalExpenses)}</b></div>
        <div class="report-item highlight"><span>Faida Halisi</span><b>${fmt(summary.totalProfit)}</b></div>
        <div class="report-item"><span>Faida %</span><b>${summary.totalRevenue ? ((summary.totalProfit / summary.totalRevenue) * 100).toFixed(1) : '0.0'}%</b></div>
        <div class="report-item"><span>Madeni Yasiyolipwa</span><b>${fmt(summary.totalDebts)}</b></div>
        <div class="report-item"><span>Idadi ya Bidhaa</span><b>${summary.productCount}</b></div>
      `;
      const lowStockBody = document.querySelector('#lowStockTable tbody');
      lowStockBody.innerHTML = summary.lowStock.length
        ? summary.lowStock.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${p.quantity}</td></tr>`).join('')
        : '<tr><td colspan="2" class="empty-row">Hakuna bidhaa zinazokaribia kuisha.</td></tr>';
    }
  } catch (e) { console.error(e); }
}

async function loadProducts() {
  const { products } = await api('/api/products');
  const select = document.getElementById('saleProduct');
  select.innerHTML = products.map(p => `<option value="${p.id}" data-price="${p.sell_price}" data-stock="${p.quantity}">${escapeHtml(p.name)} (${fmt(p.sell_price)}) — stock ${p.quantity}</option>`).join('') || '<option disabled>Hakuna bidhaa</option>';

  const tbody = document.querySelector('#productsTable tbody');
  tbody.innerHTML = products.length ? products.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td class="admin-only-col">${isAdmin ? fmt(p.buy_price) : ''}</td>
      <td>${fmt(p.sell_price)}</td>
      <td>${p.quantity}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty-row">Hakuna bidhaa bado.</td></tr>';

  if (!isAdmin) document.querySelectorAll('.admin-only-col').forEach(el => el.style.display = 'none');
}

document.getElementById('productForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('productMsg');
  msg.className = 'form-msg';
  try {
    await api('/api/products', 'POST', {
      name: document.getElementById('pName').value.trim(),
      buyPrice: Number(document.getElementById('pBuy').value),
      sellPrice: Number(document.getElementById('pSell').value),
      quantity: Number(document.getElementById('pQty').value)
    });
    msg.className = 'form-msg success';
    msg.textContent = 'Bidhaa imeongezwa.';
    document.getElementById('productForm').reset();
    loadProducts(); loadSummary();
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.message;
  }
});

async function loadSales() {
  const { sales } = await api('/api/sales');
  const tbody = document.querySelector('#salesTable tbody');
  tbody.innerHTML = sales.length ? sales.map(s => `
    <tr>
      <td>${escapeHtml(s.product_name)}</td>
      <td>${s.quantity}</td>
      <td>${fmt(s.sell_price)}</td>
      <td>${fmt(s.total)}</td>
      <td>${escapeHtml(s.sold_by_name)}</td>
      <td>${fmtDate(s.created_at)}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty-row">Hakuna mauzo bado.</td></tr>';
}

document.getElementById('saleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('saleMsg');
  msg.className = 'form-msg';
  const select = document.getElementById('saleProduct');
  const productId = Number(select.value);
  const quantity = Number(document.getElementById('saleQty').value);
  try {
    await api('/api/sales', 'POST', { productId, quantity });
    msg.className = 'form-msg success';
    msg.textContent = 'Mauzo yamerekodiwa.';
    document.getElementById('saleQty').value = 1;
    loadSales(); loadProducts(); loadSummary();
    if (isAdmin && reportLoaded) loadReports();
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.message;
  }
});

async function loadExpenses() {
  const { expenses } = await api('/api/expenses');
  const tbody = document.querySelector('#expensesTable tbody');
  tbody.innerHTML = expenses.length ? expenses.map(x => `
    <tr><td>${escapeHtml(x.description)}</td><td>${fmt(x.amount)}</td><td>${escapeHtml(x.created_by_name)}</td><td>${fmtDate(x.created_at)}</td></tr>
  `).join('') : '<tr><td colspan="4" class="empty-row">Hakuna matumizi bado.</td></tr>';
}

document.getElementById('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('expenseMsg');
  msg.className = 'form-msg';
  try {
    await api('/api/expenses', 'POST', {
      description: document.getElementById('eDesc').value.trim(),
      amount: Number(document.getElementById('eAmount').value)
    });
    msg.className = 'form-msg success';
    msg.textContent = 'Matumizi yameongezwa.';
    document.getElementById('expenseForm').reset();
    loadExpenses(); loadSummary();
    if (isAdmin && reportLoaded) loadReports();
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.message;
  }
});

async function loadDebts() {
  const { debts } = await api('/api/debts');
  const tbody = document.querySelector('#debtsTable tbody');
  tbody.innerHTML = debts.length ? debts.map(d => `
    <tr>
      <td>${escapeHtml(d.person_name)}</td>
      <td>${escapeHtml(d.description || '—')}</td>
      <td>${fmt(d.amount)}</td>
      <td><span class="status-pill ${d.status}">${d.status === 'paid' ? 'Imelipwa' : 'Haijalipwa'}</span></td>
      <td>${d.status === 'unpaid' ? `<button class="btn btn-ghost btn-sm" data-id="${d.id}" onclick="markPaid(${d.id})">Weka Imelipwa</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-row">Hakuna madeni bado.</td></tr>';
}

async function markPaid(id) {
  try {
    await api(`/api/debts/${id}`, 'PUT', { status: 'paid' });
    loadDebts(); loadSummary();
  } catch (err) { alert(err.message); }
}

document.getElementById('debtForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('debtMsg');
  msg.className = 'form-msg';
  try {
    await api('/api/debts', 'POST', {
      personName: document.getElementById('dPerson').value.trim(),
      description: document.getElementById('dDesc').value.trim(),
      amount: Number(document.getElementById('dAmount').value)
    });
    msg.className = 'form-msg success';
    msg.textContent = 'Deni limeongezwa.';
    document.getElementById('debtForm').reset();
    loadDebts(); loadSummary();
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.message;
  }
});

/* =========================
   ADMIN REPORTS
   ========================= */
let reportLoaded = false;
let reportData = { sales: [], expenses: [], summary: {}, chart: [] };
let currentReportRange = { from: '', to: '' };
let usersLoaded = false;
let usersData = { users: [], totals: {} };
let currentUsersRange = { from: '', to: '' };

function localDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromInput(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISODate(date) {
  return localDateInputValue(date);
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function shiftMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function setReportYearOptions() {
  const yearSelect = document.getElementById('reportYear');
  const nowYear = new Date().getFullYear();
  const years = [];
  for (let y = nowYear; y >= nowYear - 10; y--) years.push(y);
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelect.value = String(nowYear);
}

function setDefaultReportDates() {
  const today = new Date();
  document.getElementById('reportFrom').value = localDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
  document.getElementById('reportTo').value = localDateInputValue(today);
}

function getReportRange() {
  const period = document.getElementById('reportPeriod').value;
  const today = new Date();
  let from = new Date(today);
  let to = new Date(today);

  if (period === 'day') {
    from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  } else if (period === 'week') {
    from = startOfWeek(today);
  } else if (period === 'month') {
    const year = Number(document.getElementById('reportYear').value);
    from = new Date(year, today.getMonth(), 1);
    to = new Date(year, today.getMonth() + 1, 0);
    if (year === today.getFullYear()) to = today;
  } else if (period === '3months') {
    from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  } else if (period === '6months') {
    from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  } else if (period === 'year') {
    const year = Number(document.getElementById('reportYear').value);
    from = new Date(year, 0, 1);
    to = new Date(year, 11, 31);
    if (year === today.getFullYear()) to = today;
  } else {
    const fromValue = document.getElementById('reportFrom').value;
    const toValue = document.getElementById('reportTo').value;
    if (!fromValue || !toValue) throw new Error('Chagua tarehe ya kuanzia na tarehe ya mwisho.');
    from = dateFromInput(fromValue);
    to = dateFromInput(toValue);
    if (from > to) throw new Error('Tarehe ya kuanzia haiwezi kuwa baada ya tarehe ya mwisho.');
  }

  return { from: toISODate(from), to: toISODate(to) };
}

function updateReportFilterVisibility() {
  const period = document.getElementById('reportPeriod').value;
  const custom = period === 'custom';
  document.getElementById('reportYearWrap').style.display = ['month', 'year'].includes(period) ? '' : 'none';
  document.getElementById('reportFromWrap').style.display = custom ? '' : 'none';
  document.getElementById('reportToWrap').style.display = custom ? '' : 'none';
}

function formatRangeLabel(from, to) {
  const f = dateFromInput(from);
  const t = dateFromInput(to);
  return `${f.toLocaleDateString('sw-TZ', {day:'2-digit', month:'short', year:'numeric'})} — ${t.toLocaleDateString('sw-TZ', {day:'2-digit', month:'short', year:'numeric'})}`;
}

function calcReportSummary(sales, expenses) {
  const revenue = sales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const cost = sales.reduce((sum, s) => sum + Number(s.buy_price || 0) * Number(s.quantity || 0), 0);
  const expensesTotal = expenses.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const grossProfit = revenue - cost;
  const netProfit = grossProfit - expensesTotal;
  const margin = revenue ? (netProfit / revenue) * 100 : 0;
  return {
    revenue, cost, expenses: expensesTotal, grossProfit, netProfit, margin,
    salesCount: sales.length,
    units: sales.reduce((sum, s) => sum + Number(s.quantity || 0), 0)
  };
}

function getBucketKey(date, period, rangeDays) {
  if (period === 'day') return date.toISOString().slice(0, 13) + ':00';
  if (period === 'week' || period === 'month') return localDateInputValue(date);
  if (rangeDays <= 92) return localDateInputValue(startOfWeek(date));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildChartData(sales, expenses, from, to, period) {
  const fromDate = dateFromInput(from);
  const toDate = dateFromInput(to);
  const rangeDays = Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1);
  const map = new Map();

  const ensure = (key, label) => {
    if (!map.has(key)) map.set(key, { key, label, revenue: 0, cost: 0, expenses: 0 });
    return map.get(key);
  };

  sales.forEach(s => {
    const d = new Date(String(s.created_at).replace(' ', 'T') + 'Z');
    const key = getBucketKey(d, period, rangeDays);
    let label = key;
    if (period === 'day') label = d.toLocaleTimeString('sw-TZ', {hour:'2-digit', minute:'2-digit'});
    else if (rangeDays > 92 && !['week','month'].includes(period)) {
      const [y,m] = key.split('-');
      label = new Date(Number(y), Number(m)-1, 1).toLocaleDateString('sw-TZ', {month:'short', year:'2-digit'});
    } else {
      const dd = dateFromInput(key.slice(0,10));
      label = dd.toLocaleDateString('sw-TZ', {day:'2-digit', month:'short'});
    }
    const row = ensure(key, label);
    row.revenue += Number(s.total || 0);
    row.cost += Number(s.buy_price || 0) * Number(s.quantity || 0);
  });

  expenses.forEach(x => {
    const d = new Date(String(x.created_at).replace(' ', 'T') + 'Z');
    const key = getBucketKey(d, period, rangeDays);
    let label = key;
    if (period === 'day') label = d.toLocaleTimeString('sw-TZ', {hour:'2-digit', minute:'2-digit'});
    else if (rangeDays > 92 && !['week','month'].includes(period)) {
      const [y,m] = key.split('-');
      label = new Date(Number(y), Number(m)-1, 1).toLocaleDateString('sw-TZ', {month:'short', year:'2-digit'});
    } else {
      const dd = dateFromInput(key.slice(0,10));
      label = dd.toLocaleDateString('sw-TZ', {day:'2-digit', month:'short'});
    }
    ensure(key, label).expenses += Number(x.amount || 0);
  });

  return [...map.values()].sort((a,b) => a.key.localeCompare(b.key)).map(r => ({
    ...r,
    profit: r.revenue - r.cost - r.expenses,
    margin: r.revenue ? ((r.revenue - r.cost - r.expenses) / r.revenue) * 100 : 0
  }));
}

function niceNumber(n) {
  const value = Math.abs(Number(n || 0));
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
  return Math.round(value).toLocaleString('en-US');
}

function drawAxes(ctx, w, h, pad, maxValue, labels, valuesA, valuesB = null) {
  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = '#5B6470';
  ctx.strokeStyle = '#E3E6EC';
  ctx.lineWidth = 1;

  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH - (plotH * i / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillText(niceNumber(maxValue * i / 4), 6, y + 4);
  }

  const step = labels.length > 10 ? Math.ceil(labels.length / 8) : 1;
  labels.forEach((label, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const x = pad.left + (labels.length === 1 ? plotW / 2 : plotW * i / (labels.length - 1));
    ctx.save();
    ctx.translate(x, h - 8);
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
}

function drawSalesProfitChart(data) {
  const canvas = document.getElementById('salesProfitChart');
  const scroll = canvas.parentElement;
  const width = Math.max(scroll.clientWidth, data.length * 72, 560);
  const height = 300;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = width, h = height, pad = {left:52,right:18,top:20,bottom:42};
  const labels = data.map(x => x.label);
  const valuesA = data.map(x => x.revenue);
  const valuesB = data.map(x => Math.max(0, x.profit));
  const maxValue = Math.max(1, ...valuesA, ...valuesB);

  drawAxes(ctx, w, h, pad, maxValue, labels, valuesA, valuesB);
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const point = (i, v) => ({
    x: pad.left + (labels.length === 1 ? plotW / 2 : plotW * i / (labels.length - 1)),
    y: pad.top + plotH - (plotH * v / maxValue)
  });

  const drawLine = (values, lineWidth) => {
    ctx.beginPath();
    values.forEach((v,i) => {
      const p = point(i,v);
      i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y);
    });
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    values.forEach((v,i) => {
      const p = point(i,v);
      ctx.beginPath(); ctx.arc(p.x,p.y,3.5,0,Math.PI*2); ctx.fill();
    });
  };

  ctx.strokeStyle = '#00274D'; ctx.fillStyle = '#00274D'; drawLine(valuesA, 2.5);
  ctx.strokeStyle = '#F2A93B'; ctx.fillStyle = '#F2A93B'; drawLine(valuesB, 2.5);
}

function drawProfitMarginChart(data) {
  const canvas = document.getElementById('profitMarginChart');
  const scroll = canvas.parentElement;
  const width = Math.max(scroll.clientWidth, data.length * 72, 560);
  const height = 300;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = width, h = height, pad = {left:45,right:18,top:20,bottom:42};
  const labels = data.map(x => x.label);
  const values = data.map(x => x.margin);
  const maxValue = Math.max(10, ...values, 0);
  const minValue = Math.min(0, ...values);
  const range = Math.max(10, maxValue - minValue);

  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = '#5B6470';
  ctx.strokeStyle = '#E3E6EC';
  const plotW = w-pad.left-pad.right, plotH = h-pad.top-pad.bottom;

  for (let i=0;i<=4;i++) {
    const value = minValue + range*i/4;
    const y = pad.top+plotH-(plotH*i/4);
    ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(w-pad.right,y); ctx.stroke();
    ctx.fillText(value.toFixed(0)+'%', 6, y+4);
  }

  const step = labels.length > 10 ? Math.ceil(labels.length/8) : 1;
  const point = (i,v) => ({
    x: pad.left + (labels.length === 1 ? plotW/2 : plotW*i/(labels.length-1)),
    y: pad.top + plotH - ((v-minValue)/range)*plotH
  });

  ctx.strokeStyle = '#1F9D6E';
  ctx.fillStyle = '#1F9D6E';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  values.forEach((v,i)=>{const p=point(i,v); i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});
  ctx.stroke();
  values.forEach((v,i)=>{
    const p=point(i,v);
    ctx.beginPath(); ctx.arc(p.x,p.y,3.5,0,Math.PI*2); ctx.fill();
    if (i % step === 0 || i === labels.length-1) {
      ctx.save(); ctx.fillStyle='#5B6470'; ctx.font='11px Inter, sans-serif'; ctx.textAlign='center';
      ctx.fillText(labels[i], p.x, h-8); ctx.restore();
    }
  });
}

function renderReportTable() {
  const sort = document.getElementById('reportSort').value;
  const rows = [...reportData.sales];
  const value = s => ({
    date: new Date(String(s.created_at).replace(' ','T')+'Z').getTime(),
    sales: Number(s.total || 0),
    profit: Number(s.profit || 0),
    margin: Number(s.margin || 0)
  });

  rows.sort((a,b) => {
    const va=value(a), vb=value(b);
    const [field,dir] = sort.split('-');
    return (va[field]-vb[field]) * (dir === 'asc' ? 1 : -1);
  });

  const tbody = document.querySelector('#reportSalesTable tbody');
  document.getElementById('reportRowCount').textContent = `${rows.length} rekodi · ${reportData.summary.units || 0} bidhaa zilizouzwa`;

  tbody.innerHTML = rows.length ? rows.map(s => `
    <tr>
      <td>${fmtDate(s.created_at)}</td>
      <td>${escapeHtml(s.product_name)}</td>
      <td>${escapeHtml(s.sold_by_name)}</td>
      <td>${s.quantity}</td>
      <td>${fmt(s.sell_price)}</td>
      <td>${fmt(s.total)}</td>
      <td>${fmt(s.cost)}</td>
      <td class="${Number(s.profit) >= 0 ? 'profit-positive' : 'profit-negative'}">${fmt(s.profit)}</td>
      <td>${Number(s.margin || 0).toFixed(1)}%</td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty-row">Hakuna mauzo kwenye kipindi hiki.</td></tr>';
}

function renderReportSummary() {
  const s = reportData.summary;
  document.getElementById('reportGrid').innerHTML = `
    <div class="report-item"><span>Mauzo</span><b>${fmt(s.revenue)}</b></div>
    <div class="report-item"><span>Gharama za Bidhaa</span><b>${fmt(s.cost)}</b></div>
    <div class="report-item"><span>Matumizi</span><b>${fmt(s.expenses)}</b></div>
    <div class="report-item highlight"><span>Faida Halisi</span><b>${fmt(s.netProfit)}</b></div>
    <div class="report-item"><span>Faida %</span><b>${Number(s.margin || 0).toFixed(1)}%</b></div>
    <div class="report-item"><span>Idadi ya Mauzo</span><b>${s.salesCount}</b></div>
  `;
  document.getElementById('chartMarginValue').textContent = `${Number(s.margin || 0).toFixed(1)}%`;
}

function renderCharts() {
  drawSalesProfitChart(reportData.chart);
  drawProfitMarginChart(reportData.chart);
}

async function loadReports() {
  if (!isAdmin) return;
  try {
    const { from, to } = getReportRange();
    currentReportRange = { from, to };
    document.getElementById('reportRangeLabel').textContent = formatRangeLabel(from, to);
    const data = await api(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    reportData = data;
    reportLoaded = true;
    renderReportSummary();
    renderReportTable();
    renderCharts();
  } catch (e) {
    console.error(e);
    document.getElementById('reportRangeLabel').textContent = e.message;
    document.querySelector('#reportSalesTable tbody').innerHTML = `<tr><td colspan="9" class="empty-row">${escapeHtml(e.message)}</td></tr>`;
  }
}

document.getElementById('reportPeriod')?.addEventListener('change', () => {
  updateReportFilterVisibility();
  if (document.getElementById('reportPeriod').value !== 'custom') loadReports();
});
document.getElementById('reportYear')?.addEventListener('change', () => {
  if (['month','year'].includes(document.getElementById('reportPeriod').value)) loadReports();
});
document.getElementById('reportApplyBtn')?.addEventListener('click', loadReports);
document.getElementById('reportRefreshBtn')?.addEventListener('click', loadReports);
document.getElementById('reportSort')?.addEventListener('change', renderReportTable);

window.addEventListener('resize', () => {
  if (isAdmin && reportLoaded) renderCharts();
  if (isAdmin && usersLoaded) drawUserPerformanceChart();
});

/* =========================
   ADMIN USERS & PERFORMANCE
   ========================= */
function setUserYearOptions() {
  const el = document.getElementById('userYear');
  const nowYear = new Date().getFullYear();
  el.innerHTML = Array.from({length: 11}, (_,i) => nowYear-i)
    .map(y => `<option value="${y}">${y}</option>`).join('');
  el.value = String(nowYear);
}

function setDefaultUserDates() {
  const today = new Date();
  document.getElementById('userFrom').value = localDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
  document.getElementById('userTo').value = localDateInputValue(today);
}

function getUserRange() {
  const period = document.getElementById('userPeriod').value;
  const today = new Date();
  let from = new Date(today), to = new Date(today);
  if (period === 'day') from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  else if (period === 'week') from = startOfWeek(today);
  else if (period === 'month') {
    const year = Number(document.getElementById('userYear').value);
    from = new Date(year, today.getMonth(), 1); to = new Date(year, today.getMonth()+1, 0);
    if (year === today.getFullYear()) to = today;
  } else if (period === '3months') from = new Date(today.getFullYear(), today.getMonth()-2, 1);
  else if (period === '6months') from = new Date(today.getFullYear(), today.getMonth()-5, 1);
  else if (period === 'year') {
    const year = Number(document.getElementById('userYear').value);
    from = new Date(year,0,1); to = new Date(year,11,31);
    if (year === today.getFullYear()) to = today;
  } else {
    const f=document.getElementById('userFrom').value, t=document.getElementById('userTo').value;
    if (!f || !t) throw new Error('Chagua tarehe ya kuanzia na tarehe ya mwisho.');
    from=dateFromInput(f); to=dateFromInput(t);
    if (from > to) throw new Error('Tarehe ya kuanzia haiwezi kuwa baada ya tarehe ya mwisho.');
  }
  return {from:toISODate(from),to:toISODate(to)};
}

function updateUserFilterVisibility() {
  const period=document.getElementById('userPeriod').value;
  const custom=period==='custom';
  document.getElementById('userYearWrap').style.display=['month','year'].includes(period)?'':'none';
  document.getElementById('userFromWrap').style.display=custom?'':'none';
  document.getElementById('userToWrap').style.display=custom?'':'none';
}

function renderUsersSummary() {
  const t=usersData.totals||{};
  const active=usersData.users.filter(u=>Number(u.active_sessions)>0).length;
  const top=[...usersData.users].sort((a,b)=>Number(b.revenue)-Number(a.revenue))[0];
  document.getElementById('usersSummaryGrid').innerHTML=`
    <div class="report-item"><span>Watumiaji</span><b>${usersData.users.length}</b></div>
    <div class="report-item"><span>Walio Active</span><b>${active}</b></div>
    <div class="report-item"><span>Mauzo</span><b>${Number(t.sales_count||0).toLocaleString('en-US')}</b></div>
    <div class="report-item"><span>Bidhaa Zilizouzwa</span><b>${Number(t.units_sold||0).toLocaleString('en-US')}</b></div>
    <div class="report-item"><span>Mapato</span><b>${fmt(t.revenue)}</b></div>
    <div class="report-item highlight"><span>Faida ya Mauzo</span><b>${fmt(t.gross_profit)}</b></div>
    <div class="report-item"><span>Matumizi Yaliyoingizwa</span><b>${fmt(t.expenses_total)}</b></div>
    <div class="report-item"><span>Bidhaa Zilizoingizwa</span><b>${Number(t.products_added||0)}</b></div>`;
  document.getElementById('topUserLabel').textContent=top&&Number(top.revenue)>0?`Top: ${escapeHtml(top.full_name)} · ${fmt(top.revenue)}`:'Hakuna mauzo';
}

function renderUserTable() {
  const q=document.getElementById('userSearch').value.trim().toLowerCase();
  const sort=document.getElementById('userSort').value;
  let rows=usersData.users.filter(u=>`${u.full_name} ${u.email} ${u.role}`.toLowerCase().includes(q));
  const val=(u,k)=>({revenue:Number(u.revenue||0),profit:Number(u.gross_profit||0),sales:Number(u.sales_count||0),units:Number(u.units_sold||0),margin:Number(u.profit_margin||0),expenses:Number(u.expenses_total||0),name:String(u.full_name||'').toLowerCase(),login:u.last_login_at?new Date(String(u.last_login_at).replace(' ','T')+'Z').getTime():0}[k]);
  rows.sort((a,b)=>{const [k,d]=sort.split('-'); const A=val(a,k),B=val(b,k); if(typeof A==='string') return A.localeCompare(B)*(d==='asc'?1:-1); return (A-B)*(d==='asc'?1:-1);});
  document.getElementById('usersRowCount').textContent=`${rows.length} / ${usersData.users.length} watumiaji`;
  document.querySelector('#usersTable tbody').innerHTML=rows.length?rows.map(u=>{
    const active=Number(u.active_sessions)>0;
    return `<tr>
      <td><strong>${escapeHtml(u.full_name)}</strong><br><span class="table-muted">${escapeHtml(u.email)}</span></td>
      <td><span class="user-role-pill ${u.role}">${u.role==='admin'?'Admin':'Muuzaji'}</span></td>
      <td>${Number(u.sales_count||0)}</td><td>${Number(u.units_sold||0)}</td>
      <td>${fmt(u.revenue)}</td><td class="${Number(u.gross_profit)>=0?'profit-positive':'profit-negative'}">${fmt(u.gross_profit)}</td>
      <td>${Number(u.profit_margin||0).toFixed(1)}%</td><td>${fmt(u.expenses_total)}</td><td>${Number(u.products_added||0)}</td><td>${Number(u.debts_added||0)}</td>
      <td>${u.last_login_at?fmtDate(u.last_login_at):'—'}</td>
      <td><span class="activity-status ${active?'online':'offline'}"><i></i>${active?'Active':'Offline'}</span></td>
    </tr>`;
  }).join(''):'<tr><td colspan="12" class="empty-row">Hakuna mtumiaji anayelingana na utafutaji.</td></tr>';
}

function drawUserPerformanceChart() {
  const canvas=document.getElementById('userPerformanceChart'); if(!canvas)return;
  const scroll=canvas.parentElement, rows=[...usersData.users].sort((a,b)=>Number(b.revenue)-Number(a.revenue));
  const width=Math.max(scroll.clientWidth, rows.length*110, 560), height=320, dpr=window.devicePixelRatio||1;
  canvas.style.width=width+'px'; canvas.style.height=height+'px'; canvas.width=width*dpr; canvas.height=height*dpr;
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
  const pad={left:58,right:20,top:20,bottom:70}, w=width,h=height,plotW=w-pad.left-pad.right,plotH=h-pad.top-pad.bottom;
  const max=Math.max(1,...rows.map(u=>Number(u.revenue||0)));
  ctx.font='11px Inter, sans-serif'; ctx.fillStyle='#5B6470'; ctx.strokeStyle='#E3E6EC';
  for(let i=0;i<=4;i++){const y=pad.top+plotH-(plotH*i/4);ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke();ctx.fillText(niceNumber(max*i/4),6,y+4);}
  const step=plotW/Math.max(1,rows.length); const barW=Math.min(64,step*0.62);
  rows.forEach((u,i)=>{const value=Number(u.revenue||0), bh=plotH*value/max, x=pad.left+i*step+(step-barW)/2, y=pad.top+plotH-bh;
    ctx.fillStyle='#00274D'; ctx.fillRect(x,y,barW,bh); ctx.fillStyle='#5B6470'; ctx.textAlign='center';
    const name=String(u.full_name||'').split(' ')[0]; ctx.fillText(name.slice(0,10),x+barW/2,h-38); ctx.fillText(niceNumber(value),x+barW/2,Math.max(14,y-6));
  });
}

async function loadUsers() {
  if(!isAdmin)return;
  try{
    const {from,to}=getUserRange(); currentUsersRange={from,to};
    document.getElementById('usersRangeLabel').textContent=formatRangeLabel(from,to);
    usersData=await api(`/api/users?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    usersLoaded=true; renderUsersSummary(); renderUserTable(); drawUserPerformanceChart();
  }catch(e){
    console.error(e); document.getElementById('usersRangeLabel').textContent=e.message;
    document.querySelector('#usersTable tbody').innerHTML=`<tr><td colspan="12" class="empty-row">${escapeHtml(e.message)}</td></tr>`;
  }
}

document.getElementById('userPeriod')?.addEventListener('change',()=>{updateUserFilterVisibility();if(document.getElementById('userPeriod').value!=='custom')loadUsers();});
document.getElementById('userYear')?.addEventListener('change',()=>{if(['month','year'].includes(document.getElementById('userPeriod').value))loadUsers();});
document.getElementById('usersApplyBtn')?.addEventListener('click',loadUsers);
document.getElementById('usersRefreshBtn')?.addEventListener('click',loadUsers);
document.getElementById('userSearch')?.addEventListener('input',renderUserTable);
document.getElementById('userSort')?.addEventListener('change',renderUserTable);

(async function init() {
  try {
    const me = await api('/api/me');
    if (me.business) {
      localStorage.setItem('daftari_business', JSON.stringify(me.business));
      if (isAdmin) {
        document.getElementById('bizName').textContent = me.business.name;
        document.getElementById('bizCode').textContent = me.business.code;
      }
    }
  }
  catch {
    localStorage.clear(); window.location.href = 'login.html'; return;
  }

  if (isAdmin) {
    setReportYearOptions();
    setDefaultReportDates();
    updateReportFilterVisibility();
    setUserYearOptions();
    setDefaultUserDates();
    updateUserFilterVisibility();
  }

  loadSummary();
  loadProducts();
  loadSales();
  loadExpenses();
  loadDebts();
})();
