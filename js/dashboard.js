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
  return new Date(s + 'Z').toLocaleString('sw-TZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.style.display === 'none') return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
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
        <div class="report-item"><span>Madeni Yasiyolipwa</span><b>${fmt(summary.totalDebts)}</b></div>
        <div class="report-item"><span>Idadi ya Bidhaa</span><b>${summary.productCount}</b></div>
      `;
      const lowStockBody = document.querySelector('#lowStockTable tbody');
      lowStockBody.innerHTML = summary.lowStock.length
        ? summary.lowStock.map(p => `<tr><td>${p.name}</td><td>${p.quantity}</td></tr>`).join('')
        : '<tr><td colspan="2" class="empty-row">Hakuna bidhaa zinazokaribia kuisha.</td></tr>';
    }
  } catch (e) { console.error(e); }
}

async function loadProducts() {
  const { products } = await api('/api/products');
  const select = document.getElementById('saleProduct');
  select.innerHTML = products.map(p => `<option value="${p.id}" data-price="${p.sell_price}" data-stock="${p.quantity}">${p.name} (${fmt(p.sell_price)}) — stock ${p.quantity}</option>`).join('') || '<option disabled>Hakuna bidhaa</option>';

  const tbody = document.querySelector('#productsTable tbody');
  tbody.innerHTML = products.length ? products.map(p => `
    <tr>
      <td>${p.name}</td>
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
      <td>${s.product_name}</td>
      <td>${s.quantity}</td>
      <td>${fmt(s.sell_price)}</td>
      <td>${fmt(s.total)}</td>
      <td>${s.sold_by_name}</td>
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
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.message;
  }
});

async function loadExpenses() {
  const { expenses } = await api('/api/expenses');
  const tbody = document.querySelector('#expensesTable tbody');
  tbody.innerHTML = expenses.length ? expenses.map(x => `
    <tr><td>${x.description}</td><td>${fmt(x.amount)}</td><td>${x.created_by_name}</td><td>${fmtDate(x.created_at)}</td></tr>
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
      <td>${d.person_name}</td>
      <td>${d.description || '—'}</td>
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
  catch { localStorage.clear(); window.location.href = 'login.html'; return; }
  loadSummary();
  loadProducts();
  loadSales();
  loadExpenses();
  loadDebts();
})();
