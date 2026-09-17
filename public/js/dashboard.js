(() => {
  'use strict';

  /* =========================
     AUTH
  ========================= */

  const token =
    localStorage.getItem('dp_token') ||
    localStorage.getItem('daftari_token');

  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  const $ = (id) => document.getElementById(id);

  const money = (value) =>
    Math.round(Number(value) || 0).toLocaleString('en-US');

  const esc = (value) =>
    String(value ?? '').replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[c]));

  let products = [];
  let sales = [];
  let expenses = [];
  let debts = [];

  let currentRange = {
    from: '',
    to: ''
  };

  /* =========================
     API
  ========================= */

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? {
          'Content-Type': 'application/json'
        } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      localStorage.removeItem('dp_token');
      localStorage.removeItem('daftari_token');
      localStorage.removeItem('dp_user');
      localStorage.removeItem('daftari_user');

      window.location.href = '/login.html';
      return null;
    }

    const data =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || 'Hitilafu ya server.'
      );
    }

    return data;
  }

  /* =========================
     TOAST
  ========================= */

  function toast(message) {
    const element = $('toast');

    if (!element) return;

    element.textContent = message;
    element.style.display = 'block';

    clearTimeout(window.__dpToast);

    window.__dpToast = setTimeout(() => {
      element.style.display = 'none';
    }, 3200);
  }

  /* =========================
     DATE
  ========================= */

  function dateISO(date) {
    const d = new Date(date);

    return new Date(
      d.getTime() -
      d.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(0, 10);
  }

  function rangeFor(period) {
    const today = new Date();

    today.setHours(
      0,
      0,
      0,
      0
    );

    const from = new Date(today);
    const to = new Date(today);

    if (period === '7d') {
      from.setDate(
        from.getDate() - 6
      );
    }

    if (period === '30d') {
      from.setDate(
        from.getDate() - 29
      );
    }

    if (period === '3m') {
      from.setMonth(
        from.getMonth() - 3
      );
    }

    if (period === '6m') {
      from.setMonth(
        from.getMonth() - 6
      );
    }

    if (period === 'year') {
      from.setFullYear(
        from.getFullYear() - 1
      );
    }

    return {
      from: dateISO(from),
      to: dateISO(to)
    };
  }

  function queryRange() {
    if (
      !currentRange.from ||
      !currentRange.to
    ) {
      return '';
    }

    const params = new URLSearchParams();

    params.set(
      'from',
      currentRange.from
    );

    params.set(
      'to',
      currentRange.to
    );

    return `?${params.toString()}`;
  }

  /* =========================
     USER
  ========================= */

  async function loadMe() {
    const data =
      await api('/api/me');

    if (!data) return;

    const user =
      data.user || {};

    const business =
      data.business || {};

    const name =
      user.full_name ||
      'Owner';

    const userName =
      $('userName');

    if (userName) {
      userName.textContent = name;
    }

    const businessName =
      $('businessName');

    if (businessName) {
      businessName.textContent =
        business.name ||
        'Daftari+';
    }

    const avatar =
      $('avatar');

    if (avatar) {
      const initials =
        name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(
            (part) =>
              part[0]
          )
          .join('')
          .toUpperCase();

      avatar.textContent =
        initials || 'DP';
    }

    const subtitle =
      $('subTitle');

    if (subtitle) {
      subtitle.textContent =
        business.name
          ? `Karibu kwenye ${business.name}`
          : 'Muhtasari wa biashara yako';
    }

    const pill =
      $('tbPill');

    if (pill) {
      pill.textContent =
        `${user.role || 'Owner'} — ${business.name || 'Daftari+'}`;
    }
  }

  /* =========================
     PRODUCTS
  ========================= */

  async function loadProducts() {
    const data =
      await api('/api/products');

    if (!data) return;

    products =
      Array.isArray(data.products)
        ? data.products
        : [];

    const productsKpi =
      $('kpiProducts');

    if (productsKpi) {
      productsKpi.textContent =
        products.length;
    }

    const stockValue =
      products.reduce(
        (total, product) =>
          total +
          Number(product.quantity || 0) *
          Number(product.buy_price || 0),
        0
      );

    const stockKpi =
      $('kpiStock');

    if (stockKpi) {
      stockKpi.textContent =
        money(stockValue);
    }

    const lowCount =
      products.filter(
        (product) =>
          Number(product.quantity || 0) <=
          Number(product.min_stock || 0)
      ).length;

    const lowKpi =
      $('kpiLow');

    if (lowKpi) {
      lowKpi.textContent =
        lowCount;
    }

    const reportStock =
      $('rStock');

    if (reportStock) {
      reportStock.textContent =
        money(stockValue);
    }

    const reportStockCost =
      $('rStockCost');

    if (reportStockCost) {
      reportStockCost.textContent =
        `Cost: ${money(stockValue)}`;
    }

    renderProducts();
    renderLow();
    renderInsights();
  }

  function renderProducts() {
    const table =
      $('productsTable');

    if (!table) return;

    if (!products.length) {
      table.innerHTML = `
        <tr>
          <td colspan="8" class="empty">
            Hakuna bidhaa.
          </td>
        </tr>
      `;

      return;
    }

    table.innerHTML =
      products
        .map(
          (product) => `
            <tr>
              <td>
                <b>${esc(product.name)}</b>
              </td>

              <td>
                ${esc(product.category_name || '—')}
              </td>

              <td>
                ${money(product.buy_price)}
              </td>

              <td>
                ${money(product.sell_price)}
              </td>

              <td>
                ${money(product.quantity)}
              </td>

              <td>
                ${money(
                  Number(product.quantity || 0) *
                  Number(product.buy_price || 0)
                )}
              </td>

              <td>
                ${
                  Number(product.quantity || 0) <=
                  Number(product.min_stock || 0)
                    ? '<span class="pill warn">Low</span>'
                    : '<span class="pill good">Healthy</span>'
                }
              </td>

              <td>
                <button
                  type="button"
                  class="btn"
                  data-edit-product="${product.id}">
                  Edit
                </button>
              </td>
            </tr>
          `
        )
        .join('');
  }

  function renderLow() {
    const list =
      $('lowList');

    if (!list) return;

    const low =
      products
        .filter(
          (product) =>
            Number(product.quantity || 0) <=
            Number(product.min_stock || 0)
        )
        .sort(
          (a, b) =>
            Number(a.quantity || 0) -
            Number(b.quantity || 0)
        )
        .slice(0, 8);

    if (!low.length) {
      list.innerHTML = `
        <div class="empty">
          Stock iko vizuri 🎉
        </div>
      `;

      return;
    }

    list.innerHTML =
      low
        .map(
          (product) => `
            <div class="row">
              <div>
                <div class="name">
                  ${esc(product.name)}
                </div>

                <div class="meta">
                  Minimum ${money(product.min_stock)}
                </div>
              </div>

              <span class="pill ${
                Number(product.quantity || 0) === 0
                  ? 'bad'
                  : 'warn'
              }">
                ${
                  Number(product.quantity || 0) === 0
                    ? 'OUT'
                    : money(product.quantity)
                }
              </span>
            </div>
          `
        )
        .join('');
  }

  /* =========================
     REPORTS
  ========================= */

  async function loadReports() {
    const data =
      await api(
        '/api/reports' +
        queryRange()
      );

    if (!data) return;

    sales =
      Array.isArray(data.sales)
        ? data.sales
        : [];

    expenses =
      Array.isArray(data.expenses)
        ? data.expenses
        : [];

    const summary =
      data.summary || {};

    const revenue =
      Number(summary.revenue || 0);

    const grossProfit =
      Number(summary.grossProfit || 0);

    const totalExpenses =
      Number(summary.expenses || 0);

    const profit =
      Number(summary.profit || 0);

    const margin =
      Number(summary.margin || 0);

    const salesKpi =
      $('kpiSales');

    if (salesKpi) {
      salesKpi.textContent =
        money(revenue);
    }

    const profitKpi =
      $('kpiProfit');

    if (profitKpi) {
      profitKpi.textContent =
        money(profit);
    }

    const expenseKpi =
      $('kpiExpenses');

    if (expenseKpi) {
      expenseKpi.textContent =
        money(totalExpenses);
    }

    const marginKpi =
      $('kpiMargin');

    if (marginKpi) {
      marginKpi.textContent =
        `${margin.toFixed(1)}%`;
    }

    const rRevenue =
      $('rRevenue');

    if (rRevenue) {
      rRevenue.textContent =
        money(revenue);
    }

    const rGross =
      $('rGross');

    if (rGross) {
      rGross.textContent =
        money(grossProfit);
    }

    const rExpenses =
      $('rExpenses');

    if (rExpenses) {
      rExpenses.textContent =
        money(totalExpenses);
    }

    const rProfit =
      $('rProfit');

    if (rProfit) {
      rProfit.textContent =
        money(profit);
    }

    const rMargin =
      $('rMargin');

    if (rMargin) {
      rMargin.textContent =
        `${margin.toFixed(1)}%`;
    }

    const period =
      $('reportPeriod');

    if (period) {
      period.textContent =
        data.from && data.to
          ? `${data.from} → ${data.to}`
          : '—';
    }

    renderChart(
      'chart',
      sales,
      expenses
    );

    renderChart(
      'reportChart',
      sales,
      expenses
    );

    renderRecentTransactions();
    renderCategoryDonut();
    renderInsights();
  }

  /* =========================
     CHART
  ========================= */

  function dayKey(value) {
    return dateISO(value);
  }

  function renderChart(
    elementId,
    rows,
    expenseRows
  ) {
    const element =
      $(elementId);

    if (!element) return;

    const map =
      new Map();

    rows.forEach(
      (sale) => {
        const key =
          dayKey(sale.created_at);

        const item =
          map.get(key) || {
            sales: 0,
            profit: 0
          };

        item.sales +=
          Number(sale.total || 0);

        item.profit +=
          (
            Number(sale.sell_price || 0) -
            Number(sale.buy_price || 0)
          ) *
          Number(sale.quantity || 0) -
          Number(sale.discount || 0);

        map.set(
          key,
          item
        );
      }
    );

    expenseRows.forEach(
      (expense) => {
        const key =
          dayKey(expense.created_at);

        const item =
          map.get(key) || {
            sales: 0,
            profit: 0
          };

        item.profit -=
          Number(expense.amount || 0);

        map.set(
          key,
          item
        );
      }
    );

    let data =
      [...map.entries()]
        .sort(
          (a, b) =>
            a[0].localeCompare(b[0])
        );

    if (!data.length) {
      element.innerHTML = `
        <div class="empty">
          Hakuna data ya graph kwa kipindi hiki.
        </div>
      `;

      return;
    }

    if (data.length > 31) {
      const bucket =
        new Map();

      data.forEach(
        ([key, value]) => {
          const date =
            new Date(
              key + 'T00:00:00'
            );

          const month =
            `${date.getFullYear()}-${String(
              date.getMonth() + 1
            ).padStart(2, '0')}`;

          const item =
            bucket.get(month) || {
              sales: 0,
              profit: 0
            };

          item.sales +=
            value.sales;

          item.profit +=
            value.profit;

          bucket.set(
            month,
            item
          );
        }
      );

      data =
        [...bucket.entries()];
    }

    const width = 900;
    const height = 250;

    const padding = {
      left: 45,
      right: 15,
      top: 15,
      bottom: 32
    };

    const max =
      Math.max(
        1,
        ...data.map(
          ([, value]) =>
            Math.max(
              value.sales,
              Math.max(
                0,
                value.profit
              )
            )
        )
      );

    const x =
      (index) =>
        padding.left +
        (
          index /
          Math.max(
            1,
            data.length - 1
          )
        ) *
        (
          width -
          padding.left -
          padding.right
        );

    const y =
      (value) =>
        height -
        padding.bottom -
        (
          Math.max(0, value) /
          max
        ) *
        (
          height -
          padding.top -
          padding.bottom
        );

    const salesPoints =
      data
        .map(
          ([, value], index) =>
            `${x(index)},${y(value.sales)}`
        )
        .join(' ');

    const profitPoints =
      data
        .map(
          ([, value], index) =>
            `${x(index)},${y(value.profit)}`
        )
        .join(' ');

    const labels =
      data
        .map(
          ([key], index) => {
            if (
              data.length > 12 &&
              index %
                Math.ceil(
                  data.length / 6
                ) !== 0
            ) {
              return '';
            }

            return `
              <text
                x="${x(index)}"
                y="${height - 8}"
                text-anchor="middle">
                ${esc(key.slice(5))}
              </text>
            `;
          }
        )
        .join('');

    element.innerHTML = `
      <svg
        viewBox="0 0 ${width} ${height}"
        preserveAspectRatio="none">

        <line
          x1="${padding.left}"
          y1="${height - padding.bottom}"
          x2="${width - padding.right}"
          y2="${height - padding.bottom}"
          stroke="#E7E8F2"/>

        <polyline
          class="line-sales"
          points="${salesPoints}"/>

        <polyline
          class="line-profit"
          points="${profitPoints}"/>

        ${data
          .map(
            ([, value], index) => `
              <circle
                class="dot-sales"
                cx="${x(index)}"
                cy="${y(value.sales)}"
                r="3"/>

              <circle
                class="dot-profit"
                cx="${x(index)}"
                cy="${y(value.profit)}"
                r="3"/>
            `
          )
          .join('')}

        ${labels}
      </svg>
    `;
  }

  /* =========================
     INSIGHTS
  ========================= */

  function renderInsights() {
    const sold =
      new Map();

    sales.forEach(
      (sale) => {
        const id =
          Number(sale.product_id);

        sold.set(
          id,
          (
            sold.get(id) || 0
          ) +
          Number(sale.quantity || 0)
        );
      }
    );

    const best =
      products
        .map(
          (product) => ({
            ...product,
            sold:
              sold.get(
                Number(product.id)
              ) || 0
          })
        )
        .filter(
          (product) =>
            product.sold > 0
        )
        .sort(
          (a, b) =>
            b.sold - a.sold
        )
        .slice(0, 6);

    const bestList =
      $('bestList');

    if (bestList) {
      bestList.innerHTML =
        best.length
          ? best
              .map(
                (product, index) => `
                  <div class="row">
                    <div>
                      <div class="name">
                        ${index + 1}. ${esc(product.name)}
                      </div>

                      <div class="meta">
                        ${money(product.sold)} units
                      </div>
                    </div>

                    <b>
                      ${money(
                        product.sold *
                        Number(product.sell_price || 0)
                      )}
                    </b>
                  </div>
                `
              )
              .join('')
          : `
              <div class="empty">
                Hakuna data ya mauzo.
              </div>
            `;
    }

    const never =
      products
        .filter(
          (product) =>
            !sold.has(
              Number(product.id)
            )
        )
        .slice(0, 5);

    const slow =
      products
        .filter(
          (product) =>
            sold.has(
              Number(product.id)
            )
        )
        .map(
          (product) => ({
            ...product,
            sold:
              sold.get(
                Number(product.id)
              )
          })
        )
        .sort(
          (a, b) =>
            a.sold - b.sold
        )
        .slice(0, 5);

    const slowList =
      $('slowList');

    if (slowList) {
      const combined = [
        ...never.map(
          (product) => ({
            ...product,
            label: 'Never sold'
          })
        ),
        ...slow.map(
          (product) => ({
            ...product,
            label:
              `${product.sold} sold`
          })
        )
      ].slice(0, 7);

      slowList.innerHTML =
        combined.length
          ? combined
              .map(
                (product) => `
                  <div class="row">
                    <div>
                      <div class="name">
                        ${esc(product.name)}
                      </div>

                      <div class="meta">
                        ${esc(product.label)}
                      </div>
                    </div>

                    <span class="pill ${
                      product.label === 'Never sold'
                        ? 'bad'
                        : 'warn'
                    }">
                      ${
                        product.label === 'Never sold'
                          ? 'Never'
                          : 'Slow'
                      }
                    </span>
                  </div>
                `
              )
              .join('')
          : `
              <div class="empty">
                Hakuna bidhaa.
              </div>
            `;
    }
  }

  /* =========================
     RECENT TRANSACTIONS
  ========================= */

  function renderRecentTransactions() {
    const table =
      $('recentTxTable');

    if (!table) return;

    const recent =
      sales
        .slice()
        .sort(
          (a, b) =>
            new Date(b.created_at) -
            new Date(a.created_at)
        )
        .slice(0, 8);

    if (!recent.length) {
      table.innerHTML = `
        <tr>
          <td colspan="4" class="empty">
            Hakuna miamala.
          </td>
        </tr>
      `;

      return;
    }

    table.innerHTML =
      recent
        .map(
          (sale) => {
            const profit =
              (
                Number(sale.sell_price || 0) -
                Number(sale.buy_price || 0)
              ) *
              Number(sale.quantity || 0) -
              Number(sale.discount || 0);

            return `
              <tr>
                <td>
                  ${esc(
                    sale.product_name || '—'
                  )}
                </td>

                <td>
                  ${money(sale.quantity)}
                </td>

                <td class="right">
                  ${money(sale.total)}
                </td>

                <td class="right">
                  ${money(profit)}
                </td>
              </tr>
            `;
          }
        )
        .join('');
  }

  /* =========================
     CATEGORY DONUT
  ========================= */

  function renderCategoryDonut() {
    const container =
      $('categoryDonut');

    if (!container) return;

    const categories =
      new Map();

    sales.forEach(
      (sale) => {
        const name =
          sale.category_name ||
          'Other';

        categories.set(
          name,
          (
            categories.get(name) || 0
          ) +
          Number(sale.total || 0)
        );
      }
    );

    const entries =
      [...categories.entries()]
        .sort(
          (a, b) =>
            b[1] - a[1]
        )
        .slice(0, 6);

    if (!entries.length) {
      container.innerHTML = `
        <div class="empty">
          Hakuna data ya category.
        </div>
      `;

      return;
    }

    const total =
      entries.reduce(
        (sum, [, value]) =>
          sum + value,
        0
      );

    let current =
      0;

    const radius = 70;
    const circumference =
      2 * Math.PI * radius;

    const colors = [
      '#8B7CF6',
      '#0FA968',
      '#3B82F6',
      '#D97706',
      '#DC2626',
      '#14B8A6'
    ];

    const circles =
      entries
        .map(
          ([, value], index) => {
            const percentage =
              value / total;

            const length =
              percentage *
              circumference;

            const dash =
              `${length} ${
                circumference - length
              }`;

            const offset =
              -current;

            current += length;

            return `
              <circle
                cx="100"
                cy="100"
                r="${radius}"
                fill="none"
                stroke="${colors[index % colors.length]}"
                stroke-width="24"
                stroke-dasharray="${dash}"
                stroke-dashoffset="${offset}"
                transform="rotate(-90 100 100)"/>
            `;
          }
        )
        .join('');

    const legend =
      entries
        .map(
          ([name, value], index) => `
            <div class="drow">
              <div class="dname">
                <i style="background:${colors[index % colors.length]}"></i>
                <span>${esc(name)}</span>
              </div>

              <span class="dpct">
                ${(
                  value /
                  total *
                  100
                ).toFixed(1)}%
              </span>
            </div>
          `
        )
        .join('');

    container.innerHTML = `
      <div class="donut-wrap">
        <svg
          viewBox="0 0 200 200"
          aria-label="Sales by category">

          <circle
            cx="100"
            cy="100"
            r="${radius}"
            fill="none"
            stroke="#E7E8F2"
            stroke-width="24"/>

          ${circles}

          <text
            x="100"
            y="96"
            text-anchor="middle"
            font-size="11"
            fill="#6B7290">
            SALES
          </text>

          <text
            x="100"
            y="116"
            text-anchor="middle"
            font-size="16"
            font-weight="700"
            fill="#171A2B">
            ${money(total)}
          </text>
        </svg>

        <div class="donut-legend">
          ${legend}
        </div>
      </div>
    `;
  }

  /* =========================
     SALES
  ========================= */

  function renderSales() {
    const table =
      $('salesTable');

    if (!table) return;

    const rows =
      sales
        .slice()
        .sort(
          (a, b) =>
            new Date(b.created_at) -
            new Date(a.created_at)
        )
        .slice(0, 100);

    if (!rows.length) {
      table.innerHTML = `
        <tr>
          <td colspan="8" class="empty">
            Hakuna mauzo kwa kipindi hiki.
          </td>
        </tr>
      `;

      return;
    }

    table.innerHTML =
      rows
        .map(
          (sale) => `
            <tr>
              <td>#${sale.id}</td>

              <td>
                ${esc(sale.product_name || '—')}
              </td>

              <td>
                ${esc(
                  sale.customer_name || 'Cash'
                )}
              </td>

              <td>
                ${money(sale.quantity)}
              </td>

              <td>
                ${money(sale.total)}
              </td>

              <td>
                ${esc(
                  sale.sold_by_name || '—'
                )}
              </td>

              <td>
                ${formatDate(
                  sale.created_at
                )}
              </td>

              <td>
                <button
                  type="button"
                  class="btn danger"
                  data-void-sale="${sale.id}">
                  Undo
                </button>
              </td>
            </tr>
          `
        )
        .join('');
  }

  function formatDate(value) {
    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '—';
    }

    return date.toLocaleString(
      'sw-TZ',
      {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }
    );
  }

  /* =========================
     EXPENSES
  ========================= */

  function renderExpenses() {
    const table =
      $('expensesTable');

    if (!table) return;

    if (!expenses.length) {
      table.innerHTML = `
        <tr>
          <td colspan="5" class="empty">
            Hakuna matumizi kwa kipindi hiki.
          </td>
        </tr>
      `;

      return;
    }

    table.innerHTML =
      expenses
        .slice()
        .reverse()
        .slice(0, 100)
        .map(
          (expense) => `
            <tr>
              <td>
                ${esc(
                  expense.description || '—'
                )}
              </td>

              <td>
                ${esc(
                  expense.category || '—'
                )}
              </td>

              <td>
                ${money(expense.amount)}
              </td>

              <td>
                ${esc(
                  expense.created_by_name || '—'
                )}
              </td>

              <td>
                ${formatDate(
                  expense.created_at
                )}
              </td>
            </tr>
          `
        )
        .join('');
  }

  /* =========================
     DEBTS
  ========================= */

  async function loadDebts() {
    const data =
      await api('/api/debts');

    if (!data) return;

    debts =
      Array.isArray(data.debts)
        ? data.debts
        : [];

    const open =
      debts.filter(
        (debt) =>
          debt.status !== 'voided' &&
          Number(debt.amount || 0) >
          Number(debt.paid || 0)
      );

    const outstanding =
      open.reduce(
        (sum, debt) =>
          sum +
          (
            Number(debt.amount || 0) -
            Number(debt.paid || 0)
          ),
        0
      );

    const debtKpi =
      $('kpiDebt');

    if (debtKpi) {
      debtKpi.textContent =
        money(outstanding);
    }

    const debtTotal =
      $('debtTotal');

    if (debtTotal) {
      debtTotal.textContent =
        `Outstanding: ${money(outstanding)}`;
    }

    renderDebts();
  }

  function renderDebts() {
    const table =
      $('debtsTable');

    if (!table) return;

    if (!debts.length) {
      table.innerHTML = `
        <tr>
          <td colspan="8" class="empty">
            Hakuna madeni.
          </td>
        </tr>
      `;

      return;
    }

    table.innerHTML =
      debts
        .map(
          (debt) => {
            const balance =
              Number(debt.amount || 0) -
              Number(debt.paid || 0);

            return `
              <tr>
                <td>
                  ${esc(
                    debt.customer_name ||
                    debt.person_name ||
                    '—'
                  )}
                </td>

                <td>
                  ${esc(
                    debt.description || '—'
                  )}
                </td>

                <td>
                  ${money(debt.amount)}
                </td>

                <td>
                  ${money(debt.paid)}
                </td>

                <td>
                  <b>
                    ${money(
                      Math.max(
                        0,
                        balance
                      )
                    )}
                  </b>
                </td>

                <td>
                  ${esc(
                    debt.due_date || '—'
                  )}
                </td>

                <td>
                  <span class="pill ${
                    debt.status === 'paid'
                      ? 'good'
                      : debt.status === 'voided'
                        ? 'bad'
                        : 'warn'
                  }">
                    ${esc(
                      debt.status || 'open'
                    )}
                  </span>
                </td>

                <td>
                  ${
                    balance > 0 &&
                    debt.status !== 'voided'
                      ? `
                        <button
                          type="button"
                          class="btn"
                          data-pay-debt="${debt.id}">
                          Pay
                        </button>
                      `
                      : ''
                  }
                </td>
              </tr>
            `;
          }
        )
        .join('');
  }

  /* =========================
     PRODUCT MODAL
  ========================= */

  function openEditProduct(id) {
    const product =
      products.find(
        (item) =>
          Number(item.id) ===
          Number(id)
      );

    if (!product) return;

    const title =
      $('productModalTitle');

    if (title) {
      title.textContent =
        'Edit Bidhaa';
    }

    const editId =
      $('editProductId');

    if (editId) {
      editId.value =
        product.id;
    }

    const name =
      $('pName');

    if (name) {
      name.value =
        product.name || '';
    }

    const buy =
      $('pBuy');

    if (buy) {
      buy.value =
        product.buy_price ?? '';
    }

    const sell =
      $('pSell');

    if (sell) {
      sell.value =
        product.sell_price ?? '';
    }

    const quantity =
      $('pQty');

    if (quantity) {
      quantity.value =
        product.quantity ?? 0;
    }

    const minimum =
      $('pMin');

    if (minimum) {
      minimum.value =
        product.min_stock ?? 5;
    }

    const modal =
      $('productModal');

    if (modal) {
      modal.classList.add('show');
    }
  }

  function prepareNewProduct() {
    const editId =
      $('editProductId');

    if (
      editId &&
      editId.value
    ) {
      return;
    }

    const title =
      $('productModalTitle');

    if (title) {
      title.textContent =
        'Ongeza Bidhaa';
    }

    const form =
      $('productForm');

    if (form) {
      form.reset();
    }

    if (editId) {
      editId.value = '';
    }

    const minimum =
      $('pMin');

    if (minimum) {
      minimum.value = 5;
    }
  }

  /* =========================
     REFRESH
  ========================= */

  async function refresh() {
    try {
      await Promise.all([
        loadProducts(),
        loadReports(),
        loadDebts()
      ]);

      renderSales();
      renderExpenses();
    } catch (error) {
      console.error(
        'Daftari+ refresh error:',
        error
      );

      toast(
        error.message ||
        'Hitilafu ya kupakia dashboard.'
      );
    }
  }

  /* =========================
     NAVIGATION
  ========================= */

  function setupNavigation() {
    document
      .querySelectorAll(
        '#nav button'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              document
                .querySelectorAll(
                  '#nav button'
                )
                .forEach(
                  (item) =>
                    item.classList.remove(
                      'active'
                    )
                );

              button.classList.add(
                'active'
              );

              document
                .querySelectorAll(
                  '.section'
                )
                .forEach(
                  (section) =>
                    section.classList.remove(
                      'active'
                    )
                );

              const section =
                $(
                  button.dataset.section
                );

              if (section) {
                section.classList.add(
                  'active'
                );
              }
            }
          );
        }
      );
  }

  /* =========================
     MODALS + ACTIONS
  ========================= */

  function setupGlobalClicks() {
    document.addEventListener(
      'click',
      (event) => {
        const open =
          event.target.closest(
            '[data-open]'
          );

        if (open) {
          const modal =
            $(
              open.dataset.open
            );

          if (modal) {
            modal.classList.add(
              'show'
            );
          }

          if (
            open.dataset.open ===
            'productModal'
          ) {
            prepareNewProduct();
          }

          return;
        }

        const close =
          event.target.closest(
            '[data-close]'
          );

        if (close) {
          const modal =
            $(
              close.dataset.close
            );

          if (modal) {
            modal.classList.remove(
              'show'
            );
          }

          return;
        }

        const edit =
          event.target.closest(
            '[data-edit-product]'
          );

        if (edit) {
          openEditProduct(
            Number(
              edit.dataset.editProduct
            )
          );

          return;
        }

        const voidButton =
          event.target.closest(
            '[data-void-sale]'
          );

        if (voidButton) {
          const id =
            $('voidSaleId');

          const reason =
            $('voidReason');

          if (id) {
            id.value =
              voidButton.dataset.voidSale;
          }

          if (reason) {
            reason.value = '';
          }

          const modal =
            $('voidModal');

          if (modal) {
            modal.classList.add(
              'show'
            );
          }

          return;
        }

        const pay =
          event.target.closest(
            '[data-pay-debt]'
          );

        if (pay) {
          const amount =
            window.prompt(
              'Weka kiasi cha malipo:'
            );

          if (
            amount !== null &&
            amount.trim() !== ''
          ) {
            payDebt(
              Number(
                pay.dataset.payDebt
              ),
              Number(amount)
            );
          }
        }
      }
    );
  }

  /* =========================
     FILTERS
  ========================= */

  function setupFilters() {
    document
      .querySelectorAll(
        '#globalFilters > button'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              document
                .querySelectorAll(
                  '#globalFilters > button'
                )
                .forEach(
                  (item) =>
                    item.classList.remove(
                      'active'
                    )
                );

              button.classList.add(
                'active'
              );

              const period =
                button.dataset.period;

              currentRange =
                rangeFor(
                  period
                );

              refresh();
            }
          );
        }
      );

    const from =
      $('fromDate');

    const to =
      $('toDate');

    if (from) {
      from.addEventListener(
        'change',
        () => {
          if (
            from.value &&
            to &&
            to.value
          ) {
            currentRange = {
              from: from.value,
              to: to.value
            };

            refresh();
          }
        }
      );
    }

    if (to) {
      to.addEventListener(
        'change',
        () => {
          if (
            from &&
            from.value &&
            to.value
          ) {
            currentRange = {
              from: from.value,
              to: to.value
            };

            refresh();
          }
        }
      );
    }
  }

  /* =========================
     PRODUCT FORM
  ========================= */

  function setupProductForm() {
    const form =
      $('productForm');

    if (!form) return;

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        try {
          const id =
            Number(
              $('editProductId')?.value || 0
            );

          const body = {
            name:
              $('pName')?.value?.trim() || '',

            buyPrice:
              Number(
                $('pBuy')?.value || 0
              ),

            sellPrice:
              Number(
                $('pSell')?.value || 0
              ),

            quantity:
              Number(
                $('pQty')?.value || 0
              ),

            minStock:
              Number(
                $('pMin')?.value || 0
              )
          };

          if (!body.name) {
            throw new Error(
              'Weka jina la bidhaa.'
            );
          }

          await api(
            id
              ? `/api/products/${id}`
              : '/api/products',
            {
              method:
                id ? 'PUT' : 'POST',

              body:
                JSON.stringify(body)
            }
          );

          $('productModal')
            ?.classList.remove(
              'show'
            );

          toast(
            id
              ? 'Bidhaa imehaririwa.'
              : 'Bidhaa imeongezwa.'
          );

          await refresh();
        } catch (error) {
          console.error(error);

          toast(
            error.message ||
            'Imeshindikana kuhifadhi bidhaa.'
          );
        }
      }
    );
  }

  /* =========================
     EXPENSE FORM
  ========================= */

  function setupExpenseForm() {
    const form =
      $('expenseForm');

    if (!form) return;

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        try {
          const description =
            $('eDesc')?.value?.trim() || '';

          const category =
            $('eCat')?.value?.trim() || '';

          const amount =
            Number(
              $('eAmount')?.value || 0
            );

          if (!description) {
            throw new Error(
              'Weka maelezo ya matumizi.'
            );
          }

          if (amount <= 0) {
            throw new Error(
              'Kiasi cha matumizi si sahihi.'
            );
          }

          await api(
            '/api/expenses',
            {
              method: 'POST',

              body:
                JSON.stringify({
                  description,
                  category,
                  amount
                })
            }
          );

          $('expenseModal')
            ?.classList.remove(
              'show'
            );

          form.reset();

          toast(
            'Matumizi yamehifadhiwa.'
          );

          await refresh();
        } catch (error) {
          console.error(error);

          toast(
            error.message ||
            'Imeshindikana kuhifadhi matumizi.'
          );
        }
      }
    );
  }

  /* =========================
     VOID SALE
  ========================= */

  function setupVoidForm() {
    const form =
      $('voidForm');

    if (!form) return;

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        try {
          const id =
            Number(
              $('voidSaleId')?.value || 0
            );

          const reason =
            $('voidReason')?.value?.trim() || '';

          if (!id) {
            throw new Error(
              'Sale haijachaguliwa.'
            );
          }

          if (!reason) {
            throw new Error(
              'Weka sababu ya ku-void sale.'
            );
          }

          await api(
            `/api/sales/${id}/void`,
            {
              method: 'POST',

              body:
                JSON.stringify({
                  reason
                })
            }
          );

          $('voidModal')
            ?.classList.remove(
              'show'
            );

          toast(
            'Sale ime-void na stock imerudishwa.'
          );

          await refresh();
        } catch (error) {
          console.error(error);

          toast(
            error.message ||
            'Imeshindikana ku-void sale.'
          );
        }
      }
    );
  }

  /* =========================
     DEBT PAYMENT
  ========================= */

  async function payDebt(
    id,
    amount
  ) {
    try {
      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          'Weka kiasi sahihi.'
        );
      }

      await api(
        `/api/debts/${id}/payments`,
        {
          method: 'POST',

          body:
            JSON.stringify({
              amount
            })
        }
      );

      toast(
        'Malipo ya deni yamehifadhiwa.'
      );

      await loadDebts();
    } catch (error) {
      console.error(error);

      toast(
        error.message ||
        'Imeshindikana kuhifadhi malipo.'
      );
    }
  }

  /* =========================
     LOGOUT
  ========================= */

  function setupLogout() {
    const button =
      $('logout');

    if (!button) return;

    button.addEventListener(
      'click',
      async () => {
        try {
          await api(
            '/api/logout',
            {
              method: 'POST'
            }
          );
        } catch (error) {
          console.warn(
            'Logout API failed:',
            error
          );
        }

        localStorage.removeItem(
          'dp_token'
        );

        localStorage.removeItem(
          'daftari_token'
        );

        localStorage.removeItem(
          'dp_user'
        );

        localStorage.removeItem(
          'daftari_user'
        );

        window.location.href =
          '/login.html';
      }
    );
  }

  /* =========================
     INIT
  ========================= */

  async function init() {
    try {
      currentRange =
        rangeFor('day');

      setupNavigation();
      setupGlobalClicks();
      setupFilters();
      setupProductForm();
      setupExpenseForm();
      setupVoidForm();
      setupLogout();

      await loadMe();
      await refresh();
    } catch (error) {
      console.error(
        'Daftari+ dashboard init error:',
        error
      );

      toast(
        error.message ||
        'Imeshindikana kufungua dashboard.'
      );
    }
  }

  init();

})();
