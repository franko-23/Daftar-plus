(() => {
  const token = localStorage.getItem('dp_token'); if(!token){ location.href='/login.html'; return; }
  const $ = id => document.getElementById(id);
  const money = n => Math.round(Number(n)||0).toLocaleString('en-US');
  const esc = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  let products=[], sales=[], expenses=[], debts=[], currentRange={from:'',to:''}, lastReports=null;
  let subPlan=null, subPollTimer=null, subPollTries=0, subCurrentOrderId=null;
  const SUB_MAX_TRIES = 45; // ~45 x 4s = 180s (3 min)
  const SUB_PENDING_KEY = 'dp_pending_sub_order';

  async function api(path, opts={}){
    const r = await fetch(path, {...opts, headers:{'Content-Type':'application/json', ...(opts.headers||{}), Authorization:'Bearer '+token}});
    if(r.status===401){ localStorage.removeItem('dp_token'); location.href='/login.html'; return null; }
    const d = await r.json().catch(()=>({}));
    if(r.status===402){ location.href = d.redirect || '/subscription/subscription.html'; return null; }
    if(!r.ok) throw new Error(d.error || 'Hitilafu ya server.');
    return d;
  }

  function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.style.display='none',3200); }
  function dateISO(d){ const x=new Date(d); return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10); }
  function rangeFor(period){
    const today=new Date(); today.setHours(0,0,0,0);
    let from=new Date(today), to=new Date(today);
    if(period==='7d') from.setDate(from.getDate()-6);
    if(period==='30d') from.setDate(from.getDate()-29);
    if(period==='3m') from.setMonth(from.getMonth()-3);
    if(period==='6m') from.setMonth(from.getMonth()-6);
    if(period==='year') from.setFullYear(from.getFullYear()-1);
    return {from:dateISO(from), to:dateISO(to)};
  }
  function queryRange(){ return currentRange.from && currentRange.to ? `?from=${currentRange.from}&to=${currentRange.to}` : ''; }

  async function loadMe(){
    const d = await api('/api/me'); if(!d) return;
    $('userName').textContent = d.user.full_name || 'Owner';
    $('businessName').textContent = d.business?.name || 'Daftari+';
    const initials = (d.user.full_name||'DP').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    $('avatar').textContent = initials;
    $('subTitle').textContent = `Habari, ${d.user.full_name?.split(' ')[0]||'Owner'} 👋 — ${d.business?.name||''}`;
    $('tbPill').textContent = `Owner — ${d.business?.name || 'Daftari+'}`;
  }

  async function loadProducts(){
    const d = await api('/api/products'); if(!d) return;
    products = d.products || [];
    $('kpiProducts').textContent = products.length;
    $('kpiStock').textContent = money(products.reduce((a,p)=>a+p.quantity*p.buy_price,0));
    $('kpiLow').textContent = products.filter(p=>p.quantity<=p.min_stock).length;
    renderProducts(); renderLow(); renderInsights();
  }

  async function loadReports(){
    const d = await api('/api/reports'+queryRange()); if(!d) return;
    lastReports = d; sales = d.sales||[]; expenses = d.expenses||[];
    const s = d.summary||{};
    $('kpiSales').textContent = money(s.revenue);
    $('kpiProfit').textContent = money(s.profit);
    $('kpiExpenses').textContent = money(s.expenses);
    $('kpiMargin').textContent = `${Number(s.margin||0).toFixed(1)}%`;
    renderChart('chart', sales, expenses);
    renderSales(); renderExpenses(); renderInsights();
    renderCategoryDonut(); renderRecentTx();
    $('rRevenue').textContent = money(s.revenue);
    $('rGross').textContent = money(s.grossProfit);
    $('rExpenses').textContent = money(s.expenses);
    $('rProfit').textContent = money(s.profit);
    $('rMargin').textContent = `${Number(s.margin||0).toFixed(1)}%`;
    const stockValue = products.reduce((a,p)=>a+p.quantity*p.sell_price,0);
    const stockCost = products.reduce((a,p)=>a+p.quantity*p.buy_price,0);
    $('rStock').textContent = money(stockValue);
    $('rStockCost').textContent = `Cost: ${money(stockCost)}`;
    $('reportPeriod').textContent = `${d.from} → ${d.to}`;
    renderChart('reportChart', sales, expenses);
  }

  async function loadDebts(){
    const d = await api('/api/debts'); if(!d) return;
    debts = d.debts || [];
    const open = debts.filter(x=>x.status!=='voided' && Number(x.amount)>Number(x.paid));
    $('kpiDebt').textContent = money(open.reduce((a,x)=>a+(Number(x.amount)-Number(x.paid)),0));
    $('debtTotal').textContent = `Outstanding: ${money(open.reduce((a,x)=>a+(Number(x.amount)-Number(x.paid)),0))}`;
    renderDebts();
  }

  function renderProducts(){
    $('productsTable').innerHTML = products.length ? products.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.category_name||'—')}</td><td>${money(p.buy_price)}</td><td>${money(p.sell_price)}</td><td>${money(p.quantity)}</td><td>${money(p.quantity*p.buy_price)}</td><td>${p.quantity<=p.min_stock?'<span class="pill warn">Low</span>':'<span class="pill good">Healthy</span>'}</td><td><button class="btn" data-edit-product="${p.id}">Edit</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Hakuna bidhaa.</td></tr>';
  }
  function renderLow(){
    const low = products.filter(p=>p.quantity<=p.min_stock).sort((a,b)=>a.quantity-b.quantity).slice(0,8);
    $('lowList').innerHTML = low.length ? low.map(p=>`<div class="row"><div><div class="name">${esc(p.name)}</div><div class="meta">Minimum ${p.min_stock}</div></div><span class="pill ${p.quantity===0?'bad':'warn'}">${p.quantity===0?'OUT':p.quantity}</span></div>`).join('') : '<div class="empty">Stock iko vizuri 🎉</div>';
  }
  function renderInsights(){
    const sold = new Map();
    sales.forEach(s=>{ sold.set(Number(s.product_id),(sold.get(Number(s.product_id))||0)+Number(s.quantity||0)); });
    const best = products.map(p=>({...p, sold:sold.get(p.id)||0})).filter(p=>p.sold>0).sort((a,b)=>b.sold-a.sold).slice(0,6);
    const never = products.filter(p=>!sold.has(p.id)).slice(0,5);
    const slow = products.filter(p=>sold.has(p.id)).map(p=>({...p, sold:sold.get(p.id)})).sort((a,b)=>a.sold-b.sold).slice(0,5);
    $('bestList').innerHTML = best.length ? best.map((p,i)=>`<div class="row"><div><div class="name">${i+1}. ${esc(p.name)}</div><div class="meta">${p.sold} units</div></div><b>${money(p.sold*p.sell_price)}</b></div>`).join('') : '<div class="empty">Hakuna data ya mauzo.</div>';
    const arr = [...never.map(p=>({...p,label:'Never sold'})), ...slow.map(p=>({...p,label:`${p.sold} sold`}))].slice(0,7);
    $('slowList').innerHTML = arr.length ? arr.map(p=>`<div class="row"><div><div class="name">${esc(p.name)}</div><div class="meta">${p.label}</div></div><span class="pill ${p.label==='Never sold'?'bad':'warn'}">${p.label==='Never sold'?'Never':'Slow'}</span></div>`).join('') : '<div class="empty">Hakuna bidhaa.</div>';
  }
  function renderSales(){
    const rows = sales.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,100);
    $('salesTable').innerHTML = rows.length ? rows.map(s=>`<tr><td>#${s.id}</td><td>${esc(s.product_name)} ×${s.quantity}</td><td>${esc(s.customer_name||'Cash')}</td><td>${s.quantity}</td><td>${money(s.total)}</td><td>${esc(s.sold_by_name)}</td><td>${new Date(s.created_at).toLocaleString('sw-TZ',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td><td><button class="btn danger" data-void-sale="${s.id}">Undo</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Hakuna mauzo kwa kipindi hiki.</td></tr>';
  }
  function renderExpenses(){
    $('expensesTable').innerHTML = expenses.length ? expenses.slice().reverse().slice(0,100).map(e=>`<tr><td>${esc(e.description)}</td><td>${esc(e.category||'—')}</td><td>${money(e.amount)}</td><td>${esc(e.created_by_name)}</td><td>${new Date(e.created_at).toLocaleString('sw-TZ',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Hakuna matumizi kwa kipindi hiki.</td></tr>';
  }
  function renderDebts(){
    $('debtsTable').innerHTML = debts.length ? debts.map(d=>{ const bal=Number(d.amount)-Number(d.paid); return `<tr><td>${esc(d.customer_name||d.person_name)}</td><td>${esc(d.description||'—')}</td><td>${money(d.amount)}</td><td>${money(d.paid)}</td><td><b>${money(Math.max(0,bal))}</b></td><td>${esc(d.due_date||'—')}</td><td><span class="pill ${d.status==='paid'?'good':d.status==='voided'?'bad':'warn'}">${esc(d.status)}</span></td><td>${bal>0&&d.status!=='voided'?`<button class="btn" data-pay-debt="${d.id}">Pay</button>`:''}</td></tr>`; }).join('') : '<tr><td colspan="8" class="empty">Hakuna madeni.</td></tr>';
  }
  function dayKey(s){ return dateISO(s); }
  function renderChart(id, rows, exps){
    const el = $(id); if(!el) return;
    const map = new Map();
    rows.forEach(s=>{ const k=dayKey(s.created_at); const v=map.get(k)||{sales:0,profit:0}; v.sales+=Number(s.total||0); v.profit+=(Number(s.sell_price)-Number(s.buy_price))*Number(s.quantity)-Number(s.discount||0); map.set(k,v); });
    exps.forEach(e=>{ const k=dayKey(e.created_at); const v=map.get(k)||{sales:0,profit:0}; v.profit-=Number(e.amount||0); map.set(k,v); });
    let data = [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
    if(!data.length){ el.innerHTML = '<div class="empty">Hakuna data ya graph kwa kipindi hiki.</div>'; return; }
    if(data.length>31){
      const bucket = new Map();
      data.forEach(([k,v])=>{ const d=new Date(k+'T00:00:00'); const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const x=bucket.get(key)||{sales:0,profit:0}; x.sales+=v.sales; x.profit+=v.profit; bucket.set(key,x); });
      data = [...bucket.entries()];
    }
    const w=900,h=250,pad={l:45,r:15,t:15,b:32}, max=Math.max(1,...data.map(x=>Math.max(x[1].sales,Math.max(0,x[1].profit))));
    const x=i=>pad.l+(i/(Math.max(1,data.length-1)))*(w-pad.l-pad.r), y=v=>h-pad.b-(Math.max(0,v)/max)*(h-pad.t-pad.b);
    const salesPts=data.map((d,i)=>`${x(i)},${y(d[1].sales)}`).join(' '), profitPts=data.map((d,i)=>`${x(i)},${y(d[1].profit)}`).join(' ');
    const labels = data.map((d,i)=>{ if(data.length>12 && i%Math.ceil(data.length/6)!==0) return ''; return `<text x="${x(i)}" y="${h-8}" text-anchor="middle">${esc(d[0].slice(5))}</text>`; }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="${pad.l}" y1="${h-pad.b}" x2="${w-pad.r}" y2="${h-pad.b}" stroke="#28304a"/><polyline class="line-sales" points="${salesPts}"/><polyline class="line-profit" points="${profitPts}"/>${data.map((d,i)=>`<circle class="dot-sales" cx="${x(i)}" cy="${y(d[1].sales)}" r="3"/><circle class="dot-profit" cx="${x(i)}" cy="${y(d[1].profit)}" r="3"/>`).join('')}${labels}</svg>`;
  }

  function renderCategoryDonut(){
    const el = $('categoryDonut'); if(!el) return;
    const map = new Map();
    sales.forEach(s=>{
      const p = products.find(x=>x.id===s.product_id);
      const cat = (p && p.category_name) || 'Bila Category';
      map.set(cat, (map.get(cat)||0) + Number(s.total||0));
    });
    const entries = [...map.entries()].sort((a,b)=>b[1]-a[1]);
    const total = entries.reduce((a,[,v])=>a+v,0);
    if(!entries.length || !total){ el.innerHTML = '<div class="empty">Hakuna data ya mauzo kwa kipindi hiki.</div>'; return; }
    const colors = ['#8B7CF6','#0FA968','#3B82F6','#D97706','#DC2626','#14B8A6','#EC4899','#F59E0B'];
    const r=80, cx=100, cy=100, circumference=2*Math.PI*r;
    let acc=0;
    const arcs = entries.map(([name,val],i)=>{
      const frac = val/total;
      const dash = frac*circumference;
      const gap = circumference-dash;
      const offset = circumference*(1-acc);
      acc += frac;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="28" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    }).join('');
    const legend = entries.map(([name,val],i)=>`<div class="drow"><div class="dname"><i style="background:${colors[i%colors.length]}"></i>${esc(name)}</div><div class="dpct">${money(val)} (${Math.round(val/total*100)}%)</div></div>`).join('');
    el.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 200 200">${arcs}</svg><div class="donut-legend">${legend}</div></div>`;
  }

  function renderRecentTx(){
    const el = $('recentTxTable'); if(!el) return;
    const rows = sales.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,8);
    el.innerHTML = rows.length ? rows.map(s=>{
      const profit = (Number(s.sell_price)-Number(s.buy_price))*Number(s.quantity) - Number(s.discount||0);
      return `<tr><td>${esc(s.product_name)}</td><td>${s.quantity}</td><td class="right">${money(s.total)}</td><td class="right goodtxt">${money(profit)}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty">Hakuna miamala.</td></tr>';
  }

  // ===== Subscription =====
  function renderSubStatus(sub){
    const box = $('subStatus'), expiryEl = $('subExpiry');
    box.classList.remove('goodtxt','badtxt','warntxt');
    if(sub.active){
      const exp = new Date(sub.subscription.expires_at);
      const daysLeft = Math.max(0, Math.ceil((exp-new Date())/86400000));
      box.textContent = 'ACTIVE';
      box.classList.add('goodtxt');
      expiryEl.textContent = `${sub.subscription.plan_name} — inaisha baada ya ${daysLeft} siku (${exp.toLocaleDateString('sw-TZ')})`;
    } else if(sub.status === 'EXPIRED'){
      box.textContent = 'IMEISHA';
      box.classList.add('badtxt');
      expiryEl.textContent = 'Subscription yako imeisha muda wake. Lipa tena ili kuendelea.';
    } else {
      box.textContent = 'HAJAWAHI KULIPIA';
      box.classList.add('warntxt');
      expiryEl.textContent = 'Lipa ili kuanza kutumia Daftari+.';
    }
  }
  function setSubNotice(text, cls){
    const el = $('subNotice');
    el.className = cls || '';
    el.textContent = text;
  }
  function renderSubPayments(rows){
    $('subPayments').innerHTML = rows.length ? rows.map(p=>{
      const cls = p.status==='SUCCESSFUL' ? 'good' : (p.status==='FAILED' ? 'bad' : 'warn');
      return `<tr><td>${new Date(p.created_at).toLocaleString('sw-TZ',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td><td>${money(p.amount_tzs)}</td><td>${esc(p.phone)}</td><td><span class="pill ${cls}">${esc(p.status)}</span></td><td>${esc(p.order_id||'—')}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">Hakuna malipo bado.</td></tr>';
  }

  async function loadSubscription(){
    let plansRes=null, subRes=null, payRes=null;
    try{ plansRes = await api('/api/subscription/plans'); }
    catch(e){ setSubNotice('⚠️ Imeshindikana kupata plans: ' + e.message, 'badtxt'); }
    try{ subRes = await api('/api/subscription/current'); }
    catch(e){ setSubNotice('⚠️ Imeshindikana kupata status: ' + e.message, 'badtxt'); }
    try{ payRes = await api('/api/subscription/payments'); }
    catch(e){ /* history is non-critical, don't overwrite a more important notice */ }

    if(plansRes){
      const plans = plansRes.plans || [];
      populatePlanSelect(plans);
    }
    if(subRes) renderSubStatus(subRes);
    if(payRes) renderSubPayments(payRes.payments || []);
    if(!subRes) return;

    if(subRes.active){
      localStorage.removeItem(SUB_PENDING_KEY);
    } else if(!subPollTimer){
      const pending = localStorage.getItem(SUB_PENDING_KEY);
      if(pending){
        subCurrentOrderId = pending;
        $('subPayBtn').disabled = true;
        setSubNotice('⏳ Kuna malipo yanayosubiriwa kuthibitika. Inaangalia status…', 'warntxt');
        subPollTries = 0;
        subPollTimer = setInterval(() => pollSubStatus(subCurrentOrderId), 4000);
        pollSubStatus(subCurrentOrderId);
      }
    }
  }

  function populatePlanSelect(plans){
    const sel = $('subPlanSelect');
    if(!sel){
      // Fallback if the dropdown hasn't been added to the HTML yet
      subPlan = plans.find(p=>p.code==='business') || plans[0] || null;
      if(subPlan) $('subPayBtn').textContent = `LIPA TSh ${money(subPlan.current_price_tzs)}`;
      else setSubNotice('⚠️ Hakuna subscription plan ya active kwa sasa. Muulize Super Admin awashe plan.', 'badtxt');
      return;
    }
    if(!plans.length){
      sel.innerHTML = '<option value="">Hakuna plan</option>';
      subPlan = null;
      setSubNotice('⚠️ Hakuna subscription plan ya active kwa sasa. Muulize Super Admin awashe plan.', 'badtxt');
      return;
    }
    const previousCode = sel.value;
    sel.innerHTML = plans.map(p => `<option value="${esc(p.code)}">${esc(p.name)} — TSh ${money(p.current_price_tzs)} (${p.duration_days} siku)</option>`).join('');
    const stillExists = plans.some(p => p.code === previousCode);
    sel.value = stillExists ? previousCode : plans[0].code;
    subPlan = plans.find(p => p.code === sel.value) || plans[0];
    $('subPayBtn').textContent = `LIPA TSh ${money(subPlan.current_price_tzs)}`;
    if(!sel.dataset.wired){
      sel.dataset.wired = '1';
      sel.addEventListener('change', () => {
        subPlan = plans.find(p => p.code === sel.value) || subPlan;
        if(subPlan) $('subPayBtn').textContent = `LIPA TSh ${money(subPlan.current_price_tzs)}`;
      });
    }
  }

  async function pollSubStatus(orderId){
    subPollTries++;
    try{
      const d = await api('/api/subscription/check-status', { method:'POST', body: JSON.stringify({ orderId }) });
      if(!d) return;
      if(d.status === 'SUCCESSFUL'){
        clearInterval(subPollTimer); subPollTimer = null;
        localStorage.removeItem(SUB_PENDING_KEY);
        setSubNotice('✅ Malipo yamefanikiwa! Subscription imewashwa.', 'goodtxt');
        $('subPayBtn').disabled = false;
        await loadSubscription();
      } else if(d.status === 'FAILED'){
        clearInterval(subPollTimer); subPollTimer = null;
        localStorage.removeItem(SUB_PENDING_KEY);
        setSubNotice('❌ Malipo hayakufanikiwa. Jaribu tena.', 'badtxt');
        $('subPayBtn').disabled = false;
      } else if(subPollTries >= SUB_MAX_TRIES){
        clearInterval(subPollTimer); subPollTimer = null;
        setSubNotice('⏳ Uthibitisho unachukua muda mrefu kuliko kawaida. Kama pesa tayari imekatwa kwenye simu yako, USILIPE tena — subiri dakika chache kisha refresh ukurasa huu kuangalia tena.', 'warntxt');
        // subPayBtn stays disabled deliberately — this order is still unresolved, avoid a duplicate charge
      }
    }catch(e){
      if(subPollTries >= SUB_MAX_TRIES){
        clearInterval(subPollTimer); subPollTimer = null;
        setSubNotice('⏳ Imeshindikana kuangalia status kwa sasa. Kama pesa tayari imekatwa, USILIPE tena — refresh ukurasa baadaye.', 'warntxt');
      }
    }
  }

  $('subPayBtn').addEventListener('click', async () => {
    const phone = $('subPhone').value.trim();
    if(!phone){ alert('Weka namba ya simu kwanza.'); return; }
    if(!subPlan){ alert('Bado inapakia taarifa za plan, jaribu tena baada ya sekunde chache.'); return; }
    setSubNotice('⏳ Inasubiri uthibitisho wa malipo… usifunge ukurasa huu.', 'warntxt');
    $('subPayBtn').disabled = true;
    try{
      const d = await api('/api/subscription/create-payment', { method:'POST', body: JSON.stringify({ planCode: subPlan.code, phone }) });
      if(!d) return;
      if(d.status === 'FAILED'){
        setSubNotice('❌ ' + (d.error || 'Malipo hayakuanzishwa.'), 'badtxt');
        $('subPayBtn').disabled = false;
        return;
      }
      subCurrentOrderId = d.order_id;
      localStorage.setItem(SUB_PENDING_KEY, d.order_id);
      subPollTries = 0;
      subPollTimer = setInterval(() => pollSubStatus(subCurrentOrderId), 4000);
      pollSubStatus(subCurrentOrderId);
    }catch(e){
      setSubNotice('❌ ' + e.message, 'badtxt');
      $('subPayBtn').disabled = false;
    }
  });

  // ===== General wiring =====
  async function refresh(){
    try{ await Promise.all([loadProducts(), loadReports(), loadDebts(), loadSubscription()]); }
    catch(e){ toast(e.message); }
  }

  document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('#nav button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));
    $(b.dataset.section).classList.add('active');
  }));

  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.open).classList.add('show')));
  document.addEventListener('click', e=>{
    const c = e.target.closest('[data-close]'); if(c) $(c.dataset.close).classList.remove('show');
    const ep = e.target.closest('[data-edit-product]'); if(ep) openEdit(Number(ep.dataset.editProduct));
    const vs = e.target.closest('[data-void-sale]'); if(vs){ $('voidSaleId').value=vs.dataset.voidSale; $('voidReason').value=''; $('voidModal').classList.add('show'); }
    const pd = e.target.closest('[data-pay-debt]'); if(pd){ const amt=prompt('Weka kiasi cha malipo:'); if(amt) payDebt(Number(pd.dataset.payDebt), Number(amt)); }
  });

  document.querySelectorAll('#globalFilters button').forEach(b=>b.addEventListener('click', ()=>{
    document.querySelectorAll('#globalFilters button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const r = rangeFor(b.dataset.period);
    currentRange = r;
    $('fromDate').value = r.from;
    $('toDate').value = r.to;
    refresh();
  }));
  function applyCustomDates(){
    if($('fromDate').value && $('toDate').value){
      document.querySelectorAll('#globalFilters button').forEach(x=>x.classList.remove('active'));
      currentRange = { from: $('fromDate').value, to: $('toDate').value };
      refresh();
    }
  }
  $('fromDate').addEventListener('change', applyCustomDates);
  $('toDate').addEventListener('change', applyCustomDates);

  $('productForm').addEventListener('submit', async e=>{
    e.preventDefault();
    try{
      const id = Number($('editProductId').value);
      const body = { name:$('pName').value, buyPrice:Number($('pBuy').value), sellPrice:Number($('pSell').value), quantity:Number($('pQty').value), minStock:Number($('pMin').value) };
      await api(id ? `/api/products/${id}` : '/api/products', { method: id?'PUT':'POST', body: JSON.stringify(body) });
      $('productModal').classList.remove('show');
      toast(id ? 'Bidhaa imehaririwa.' : 'Bidhaa imeongezwa.');
      await refresh();
    }catch(e){ toast(e.message); }
  });
  function openEdit(id){
    const p = products.find(x=>x.id===id); if(!p) return;
    $('productModalTitle').textContent = 'Edit Bidhaa';
    $('editProductId').value = p.id; $('pName').value = p.name; $('pBuy').value = p.buy_price;
    $('pSell').value = p.sell_price; $('pQty').value = p.quantity; $('pMin').value = p.min_stock;
    $('productModal').classList.add('show');
  }
  document.querySelector('[data-open="productModal"]').addEventListener('click', ()=>{
    if(!$('editProductId').value){
      $('productModalTitle').textContent = 'Ongeza Bidhaa';
      $('productForm').reset(); $('editProductId').value=''; $('pMin').value=5;
    }
  });
  $('expenseForm').addEventListener('submit', async e=>{
    e.preventDefault();
    try{
      await api('/api/expenses', { method:'POST', body: JSON.stringify({ description:$('eDesc').value, category:$('eCat').value, amount:Number($('eAmount').value) }) });
      $('expenseModal').classList.remove('show'); $('expenseForm').reset();
      toast('Matumizi yamehifadhiwa.');
      await refresh();
    }catch(e){ toast(e.message); }
  });
  $('voidForm').addEventListener('submit', async e=>{
    e.preventDefault();
    try{
      await api(`/api/sales/${Number($('voidSaleId').value)}/void`, { method:'POST', body: JSON.stringify({ reason: $('voidReason').value }) });
      $('voidModal').classList.remove('show');
      toast('Sale ime-void na stock imerudishwa.');
      await refresh();
    }catch(e){ toast(e.message); }
  });
  async function payDebt(id, amount){
    try{
      await api(`/api/debts/${id}/payments`, { method:'POST', body: JSON.stringify({ amount }) });
      toast('Malipo ya deni yamehifadhiwa.');
      await loadDebts();
    }catch(e){ toast(e.message); }
  }
  $('logout').addEventListener('click', async () => {
    try{ await api('/api/logout'); }catch{}
    localStorage.removeItem('dp_token'); localStorage.removeItem('dp_user');
    location.href = '/login.html';
  });

  currentRange = rangeFor('day');
  $('fromDate').value = currentRange.from;
  $('toDate').value = currentRange.to;
  loadMe().then(refresh);
})();
