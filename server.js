const http=require('http'),
      fs=require('fs'),
      path=require('path'),
      crypto=require('crypto');

const {DatabaseSync}=require('node:sqlite');

const PORT=Number(process.env.PORT||3000);
const ROOT=path.join(__dirname,'..');
const PUBLIC=path.join(ROOT,'public');
const DB_PATH=path.join(__dirname,'data','daftari.db');

fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});

const db=new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys=ON;
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
`);


/* =========================================================
   DATABASE SCHEMA
   ========================================================= */

const schema=`

CREATE TABLE IF NOT EXISTS businesses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  owner_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  location TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT,
  business_id INTEGER NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'saler',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(business_id,name)
);

CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  buy_price REAL NOT NULL DEFAULT 0,
  sell_price REAL NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 5,
  category_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  customer_id INTEGER,
  quantity INTEGER NOT NULL,
  sell_price REAL NOT NULL,
  buy_price REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  sold_by INTEGER NOT NULL,
  sold_by_name TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  supplier_id INTEGER,
  invoice_no TEXT,
  total REAL NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  buy_price REAL NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL,
  created_by INTEGER NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS debts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  customer_id INTEGER,
  person_name TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  due_date TEXT,
  created_by INTEGER NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS debt_payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  paid_by INTEGER,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_returns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  sale_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

`;

db.exec(schema);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_business
  ON users(business_id);

  CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON sessions(expires_at);

  CREATE INDEX IF NOT EXISTS idx_products_business_active
  ON products(business_id,active);

  CREATE INDEX IF NOT EXISTS idx_sales_business_date
  ON sales(business_id,created_at);

  CREATE INDEX IF NOT EXISTS idx_expenses_business_date
  ON expenses(business_id,created_at);

  CREATE INDEX IF NOT EXISTS idx_debts_business_status
  ON debts(business_id,status);

  CREATE INDEX IF NOT EXISTS idx_stock_business_date
  ON stock_movements(business_id,created_at);

  CREATE INDEX IF NOT EXISTS idx_audit_business_date
  ON audit_logs(business_id,created_at);
`);


/* =========================================================
   SUBSCRIPTION SYSTEM
   ========================================================= */

db.exec(`

CREATE TABLE IF NOT EXISTS subscription_plans(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  regular_price_tzs INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  final_price_tzs INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 30,
  promotion_name TEXT,
  promotion_start TEXT,
  promotion_end TEXT,
  features_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  amount_paid_tzs INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  start_at TEXT,
  expires_at TEXT,
  order_id TEXT UNIQUE,
  transaction_id TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscription_payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  subscription_id INTEGER,
  plan_id INTEGER,
  phone TEXT NOT NULL,
  amount_tzs INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'palmpesa',
  order_id TEXT UNIQUE,
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sub_business
ON subscriptions(business_id);

CREATE INDEX IF NOT EXISTS idx_sub_status_expiry
ON subscriptions(status,expires_at);

CREATE INDEX IF NOT EXISTS idx_sub_payment_business
ON subscription_payments(business_id);

CREATE INDEX IF NOT EXISTS idx_sub_payment_status
ON subscription_payments(status);

CREATE INDEX IF NOT EXISTS idx_sub_payment_order
ON subscription_payments(order_id);

`);

db.exec(`

CREATE TABLE IF NOT EXISTS oauth_identities(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(provider,subject)
);

CREATE TABLE IF NOT EXISTS oauth_states(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  referral_code TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS referrals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  referrer_id INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(user_id,referrer_id,level)
);

CREATE TABLE IF NOT EXISTS referral_commissions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  referred_user_id INTEGER NOT NULL,
  level INTEGER NOT NULL,
  percentage REAL NOT NULL,
  base_amount_tzs INTEGER NOT NULL,
  amount_tzs INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(payment_id,user_id,level)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_user ON referral_commissions(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_payment ON referral_commissions(payment_id);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);

`);

try{
  db.exec(
    "ALTER TABLE subscription_plans ADD COLUMN features_json TEXT NOT NULL DEFAULT '[]'"
  );
}catch{}

try{
  db.exec(
    "ALTER TABLE subscription_payments ADD COLUMN plan_id INTEGER"
  );
}catch{}


/* =========================================================
   BUSINESS SETTINGS (profile, theme, notifications)
   ========================================================= */

try{
  db.exec(
    "ALTER TABLE businesses ADD COLUMN phone TEXT"
  );
}catch{}

try{
  db.exec(
    "ALTER TABLE businesses ADD COLUMN address TEXT"
  );
}catch{}

try{
  db.exec(
    "ALTER TABLE businesses ADD COLUMN theme_preference TEXT NOT NULL DEFAULT 'auto'"
  );
}catch{}

try{
  db.exec(
    "ALTER TABLE businesses ADD COLUMN notify_summary_enabled INTEGER NOT NULL DEFAULT 1"
  );
}catch{}

try{
  db.exec(
    "ALTER TABLE businesses ADD COLUMN notify_interval_minutes INTEGER NOT NULL DEFAULT 120"
  );
}catch{}

try{
  db.exec(
    "ALTER TABLE businesses ADD COLUMN last_summary_notified_at TEXT"
  );
}catch{}

db.exec(`

CREATE TABLE IF NOT EXISTS push_tokens(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  user_id INTEGER,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(business_id,token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_business
ON push_tokens(business_id);

`);


/* =========================================================
   REFERRAL WITHDRAWALS
   ========================================================= */

db.exec(`

CREATE TABLE IF NOT EXISTS referral_withdrawals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_tzs INTEGER NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ref_withdrawals_user ON referral_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_ref_withdrawals_status ON referral_withdrawals(status);

`);

try{
  db.exec(
    "ALTER TABLE referral_commissions ADD COLUMN withdrawal_id INTEGER"
  );
}catch{}

for(const sql of [
  'ALTER TABLE referral_withdrawals ADD COLUMN network TEXT',
  'ALTER TABLE referral_withdrawals ADD COLUMN account_name TEXT'
]){
  try{ db.exec(sql); }catch{}
}

/* Mitandao ya simu inayokubaliwa kwa withdrawal */
const WITHDRAW_NETWORKS = {
  mpesa:       'M-Pesa (Vodacom)',
  tigopesa:    'Mixx by Yas (Tigo Pesa)',
  airtelmoney: 'Airtel Money',
  halopesa:    'HaloPesa',
  tpesa:       'T-Pesa (TTCL)'
};

try{
  db.exec(
    "ALTER TABLE businesses ADD COLUMN monthly_goal_tzs INTEGER"
  );
}catch{}

const REFERRAL_MIN_WITHDRAW_TZS =
  Number(process.env.REFERRAL_MIN_WITHDRAW_TZS || 5000);


/* =========================================================
   NEW COLUMNS NEEDED BEFORE TIERED PLAN SEED
   ========================================================= */

for(const sql of [
  'ALTER TABLE subscription_plans ADD COLUMN min_capital_tzs INTEGER',
  'ALTER TABLE subscription_plans ADD COLUMN max_capital_tzs INTEGER',
  'ALTER TABLE subscription_plans ADD COLUMN max_workers INTEGER',
  'ALTER TABLE users ADD COLUMN referral_code TEXT',
  'ALTER TABLE users ADD COLUMN referred_by_user_id INTEGER'
]){
  try{ db.exec(sql); }catch{}
}


/* =========================================================
   DEFAULT BUSINESS PLAN (legacy — kept for existing subscribers)
   ========================================================= */

try{

  if(
    !db.prepare(
      "SELECT id FROM subscription_plans WHERE code='business'"
    ).get()
  ){

    db.prepare(`
      INSERT INTO subscription_plans
      (
        name,
        code,
        regular_price_tzs,
        discount_percent,
        final_price_tzs,
        duration_days,
        promotion_name,
        promotion_start,
        promotion_end,
        features_json,
        active
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,1)
    `).run(
      'Business',
      'business',
      20000,
      25,
      15000,
      30,
      'Business Launch Offer',
      '2026-10-01',
      '2026-10-31',
      JSON.stringify([
        'Full business management',
        'Sales & profit reports',
        'Stock management',
        'Employees & debts'
      ])
    );

  }

}catch(e){

  console.error(
    'Subscription seed:',
    e.message
  );

}


/* =========================================================
   TIERED PLANS — Starter / Basic / Middle Premium / Premium / VIP
   Capital ranges na kikomo cha wafanyakazi (saler) ni CONSTANT —
   Super Admin anaweza kubadili bei/muda tu, si sheria za tier.
   ========================================================= */

const TIER_DEFS = [
  { code:'starter',        name:'Starter',        price:10000,  min_capital:1000000, max_capital:1999999, max_workers:1,
    features:['Usimamizi wa msingi wa biashara','Ripoti za mauzo na faida','Mtaji: TSh 1M - 1.99M','Saler 1'] },
  { code:'basic',           name:'Basic',           price:20000,  min_capital:2000000, max_capital:3999999, max_workers:2,
    features:['Usimamizi kamili wa biashara','Ripoti za mauzo na faida','Mtaji: TSh 2M - 3.99M','Saler 2'] },
  { code:'middle_premium',  name:'Middle Premium',  price:35000,  min_capital:4000000, max_capital:4999999, max_workers:3,
    features:['Usimamizi kamili wa biashara','Ripoti za mauzo na faida','Mtaji: TSh 4M - 4.99M','Saler 3'] },
  { code:'premium',         name:'Premium',         price:55000,  min_capital:5000000, max_capital:7000000, max_workers:5,
    features:['Usimamizi kamili wa biashara','Ripoti za mauzo na faida','Mtaji: TSh 5M - 7M','Saler 5'] },
  { code:'vip_premium',     name:'VIP Premium',     price:90000,  min_capital:7000001, max_capital:-1,      max_workers:-1,
    features:['Usimamizi kamili wa biashara','Ripoti za mauzo na faida','Mtaji zaidi ya TSh 7M','Saler bila kikomo'] }
];

for(const t of TIER_DEFS){
  try{
    if(!db.prepare("SELECT id FROM subscription_plans WHERE code=?").get(t.code)){
      db.prepare(`
        INSERT INTO subscription_plans
        (name,code,regular_price_tzs,discount_percent,final_price_tzs,duration_days,
         promotion_name,promotion_start,promotion_end,features_json,active,
         min_capital_tzs,max_capital_tzs,max_workers)
        VALUES(?,?,?,0,?,30,NULL,NULL,NULL,?,1,?,?,?)
      `).run(
        t.name, t.code, t.price, t.price,
        JSON.stringify(t.features),
        t.min_capital, t.max_capital, t.max_workers
      );
    }
  }catch(e){
    console.error('Tier plan seed ('+t.code+'):', e.message);
  }
}


/* =========================================================
   MIGRATIONS
   ========================================================= */

for(
  const sql of [

    'ALTER TABLE businesses ADD COLUMN location TEXT',

    'ALTER TABLE businesses ADD COLUMN region TEXT',

    'ALTER TABLE businesses ADD COLUMN district TEXT',

    'ALTER TABLE businesses ADD COLUMN ward TEXT',

    'ALTER TABLE businesses ADD COLUMN country TEXT',

    'ALTER TABLE businesses ADD COLUMN business_phone TEXT',

    'ALTER TABLE users ADD COLUMN phone TEXT',

    'ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1',

    'ALTER TABLE products ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 5',

    'ALTER TABLE products ADD COLUMN active INTEGER NOT NULL DEFAULT 1',

    'ALTER TABLE sales ADD COLUMN discount REAL NOT NULL DEFAULT 0',

    'ALTER TABLE sales ADD COLUMN payment_method TEXT NOT NULL DEFAULT \'cash\'',

    'ALTER TABLE debts ADD COLUMN paid REAL NOT NULL DEFAULT 0',

    'ALTER TABLE debts ADD COLUMN due_date TEXT',

    'ALTER TABLE sales ADD COLUMN voided INTEGER NOT NULL DEFAULT 0',

    'ALTER TABLE sales ADD COLUMN void_reason TEXT',

    'ALTER TABLE sales ADD COLUMN voided_at TEXT',

    'ALTER TABLE sales ADD COLUMN voided_by INTEGER'

  ]
){

  try{
    db.exec(sql);
  }catch{}

}


try{
  db.exec(
    "UPDATE users SET role='owner' WHERE role='admin'"
  );
}catch{}


/* =========================================================
   HELPERS
   ========================================================= */

const clean =
  s => String(s ?? '').trim();

const email =
  s => clean(s).toLowerCase();

const validEmail =
  s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);


function hash(password){

  const salt =
    crypto.randomBytes(16).toString('hex');

  return (
    salt +
    ':' +
    crypto.scryptSync(
      password,
      salt,
      64
    ).toString('hex')
  );

}


function verify(password,value){

  try{

    const [salt,h] =
      value.split(':');

    const a =
      crypto.scryptSync(
        password,
        salt,
        64
      );

    const b =
      Buffer.from(h,'hex');

    return (
      b.length === a.length &&
      crypto.timingSafeEqual(a,b)
    );

  }catch{

    return false;

  }

}


function json(res,status,data){

  const h={

    'Content-Type':
      'application/json; charset=utf-8',

    'Cache-Control':
      'no-store',

    'Access-Control-Allow-Headers':
      'Content-Type, Authorization',

    'Access-Control-Allow-Methods':
      'GET,POST,PUT,PATCH,DELETE,OPTIONS',

    'X-Content-Type-Options':
      'nosniff',

    'Referrer-Policy':
      'strict-origin-when-cross-origin',

    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"

  };


  const origin =
    process.env.FRONTEND_ORIGIN;

  if(origin)
    h['Access-Control-Allow-Origin']=origin;


  res.writeHead(
    status,
    h
  );

  res.end(
    JSON.stringify(data)
  );

}


function body(req){

  return new Promise(
    (resolve,reject)=>{

      let d='';

      let too=false;


      req.on(
        'data',
        c=>{

          d+=c;

          if(d.length>2e6){

            too=true;

            req.destroy();

            reject(
              new Error(
                'Request too large'
              )
            );

          }

        }
      );


      req.on(
        'end',
        ()=>{

          if(too)
            return;

          try{

            resolve(
              d
                ? JSON.parse(d)
                : {}
            );

          }catch{

            reject(
              new Error(
                'JSON is invalid'
              )
            );

          }

        }
      );


      req.on(
        'error',
        reject
      );

    }
  );

}


function q(req){

  return Object.fromEntries(
    new URL(
      req.url,
      'http://localhost'
    )
    .searchParams
    .entries()
  );

}


/* =========================================================
   BUSINESS CODE
   ========================================================= */

function makeCode(){

  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';


  for(
    let k=0;
    k<50;
    k++
  ){

    let s='';


    for(
      let i=0;
      i<7;
      i++
    ){

      s+=chars[
        crypto.randomInt(
          chars.length
        )
      ];

    }


    if(
      !db.prepare(
        'SELECT 1 FROM businesses WHERE code=?'
      ).get(s)
    ){

      return s;

    }

  }


  throw Error(
    'Could not create business code'
  );

}


/* =========================================================
   REFERRAL HELPERS
   ========================================================= */

const REFERRAL_RATES = { 1:5, 2:3, 3:1 };

function makeReferralCode(){
  for(let i=0;i<30;i++){
    const code = 'DP-'+crypto.randomBytes(4).toString('hex').toUpperCase();
    if(!db.prepare('SELECT id FROM users WHERE referral_code=?').get(code)) return code;
  }
  throw Error('Could not create referral code');
}

function ensureUserReferralCode(userId){
  const u = db.prepare('SELECT id,referral_code FROM users WHERE id=?').get(userId);
  if(!u) return null;
  if(u.referral_code) return u.referral_code;
  const code = makeReferralCode();
  db.prepare('UPDATE users SET referral_code=? WHERE id=?').run(code, userId);
  return code;
}

function normalizeReferralCode(v){
  const c = clean(v).toUpperCase();
  return c || null;
}

function findReferrerByCode(code){
  const c = normalizeReferralCode(code);
  if(!c) return null;
  return db.prepare('SELECT id,full_name,email,role,active FROM users WHERE referral_code=?').get(c) || null;
}

function attachReferral(userId, referralCode){
  const user = db.prepare('SELECT id,referred_by_user_id FROM users WHERE id=?').get(userId);
  if(!user) return {ok:false, reason:'USER_NOT_FOUND'};
  if(user.referred_by_user_id) return {ok:false, reason:'ALREADY_REFERRED'};
  const referrer = findReferrerByCode(referralCode);
  if(!referrer) return {ok:false, reason:'INVALID_REFERRAL'};
  if(Number(referrer.id)===Number(userId)) return {ok:false, reason:'SELF_REFERRAL'};
  if(Number(referrer.active)!==1) return {ok:false, reason:'REFERRER_INACTIVE'};

  const visited = new Set([Number(userId)]);
  let currentId = Number(referrer.id);
  for(let level=1; level<=10; level++){
    if(visited.has(currentId)) return {ok:false, reason:'REFERRAL_CYCLE'};
    visited.add(currentId);
    const parent = db.prepare('SELECT referred_by_user_id FROM users WHERE id=?').get(currentId);
    if(!parent || !parent.referred_by_user_id) break;
    currentId = Number(parent.referred_by_user_id);
  }

  db.prepare('UPDATE users SET referred_by_user_id=? WHERE id=?').run(Number(referrer.id), Number(userId));

  try{
    db.prepare("INSERT OR IGNORE INTO referrals(user_id,referrer_id,level,status) VALUES(?,?,1,'active')")
      .run(Number(userId), Number(referrer.id));
  }catch{}

  let ancestorId = Number(referrer.id);
  for(let level=2; level<=3; level++){
    const ancestor = db.prepare('SELECT referred_by_user_id FROM users WHERE id=?').get(ancestorId);
    if(!ancestor || !ancestor.referred_by_user_id) break;
    ancestorId = Number(ancestor.referred_by_user_id);
    if(ancestorId===Number(userId)) break;
    try{
      db.prepare("INSERT OR IGNORE INTO referrals(user_id,referrer_id,level,status) VALUES(?,?,?,'active')")
        .run(Number(userId), ancestorId, level);
    }catch{}
  }

  return {ok:true, referrer_id:Number(referrer.id)};
}

function createReferralCommissions(paymentId, referredUserId, amountTzs){
  const payment = db.prepare('SELECT id,business_id,status,amount_tzs FROM subscription_payments WHERE id=?').get(Number(paymentId));
  if(!payment) return {ok:false, reason:'PAYMENT_NOT_FOUND'};
  if(String(payment.status).toUpperCase()!=='SUCCESSFUL') return {ok:false, reason:'PAYMENT_NOT_SUCCESSFUL'};

  const baseAmount = Math.max(0, Math.round(Number(amountTzs || payment.amount_tzs || 0)));
  if(baseAmount<=0) return {ok:false, reason:'INVALID_AMOUNT'};

  let currentUserId = Number(referredUserId);
  const visited = new Set([currentUserId]);
  const created = [];

  for(let level=1; level<=3; level++){
    const row = db.prepare('SELECT id,referred_by_user_id FROM users WHERE id=?').get(currentUserId);
    if(!row || !row.referred_by_user_id) break;
    const referrerId = Number(row.referred_by_user_id);
    if(visited.has(referrerId)) break;
    visited.add(referrerId);

    const referrer = db.prepare('SELECT id,active FROM users WHERE id=?').get(referrerId);
    if(!referrer){ currentUserId = referrerId; continue; }
    if(Number(referrer.active)!==1){ currentUserId = referrerId; continue; }

    const percentage = Number(REFERRAL_RATES[level] || 0);
    if(percentage<=0) break;
    const commission = Math.round(baseAmount * percentage / 100);

    if(commission>0){
      try{
        const r = db.prepare(`
          INSERT OR IGNORE INTO referral_commissions
          (payment_id,user_id,referred_user_id,level,percentage,base_amount_tzs,amount_tzs,status)
          VALUES(?,?,?,?,?,?,?,'pending')
        `).run(Number(paymentId), referrerId, Number(referredUserId), level, percentage, baseAmount, commission);
        if(Number(r.changes||0)>0){
          created.push({level, user_id:referrerId, percentage, amount_tzs:commission});
        }
      }catch(e){ console.error('Referral commission error:', e.message); }
    }
    currentUserId = referrerId;
  }

  return {ok:true, created};
}


/* =========================================================
   PACKAGE TIER RULES (constant — price editable, rules fixed)
   ========================================================= */

function tierRulesForPlan(plan){
  if(!plan) return null;
  return {
    minCapital: plan.min_capital_tzs===null||plan.min_capital_tzs===undefined ? null : Number(plan.min_capital_tzs),
    maxCapital: plan.max_capital_tzs===null||plan.max_capital_tzs===undefined ? null : Number(plan.max_capital_tzs),
    maxWorkers: plan.max_workers===null||plan.max_workers===undefined ? null : Number(plan.max_workers)
  };
}

function currentBusinessCapital(businessId){
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity*buy_price),0) capital
    FROM products WHERE business_id=? AND active=1
  `).get(businessId);
  return Number(row?.capital||0);
}

function currentSalerCount(businessId){
  const row = db.prepare(`
    SELECT COUNT(*) c FROM users WHERE business_id=? AND role='saler' AND active=1
  `).get(businessId);
  return Number(row?.c||0);
}


/* =========================================================
   OAUTH HELPERS
   ========================================================= */

function oauthBaseUrl(){
  return String(process.env.PUBLIC_BASE_URL || 'https://www.daftariplus.store').replace(/\/+$/,'');
}

function oauthRedirectUri(provider){
  const base = oauthBaseUrl();
  if(provider==='google') return process.env.GOOGLE_REDIRECT_URI || (base+'/api/auth/google/callback');
  if(provider==='apple') return process.env.APPLE_REDIRECT_URI || (base+'/api/auth/apple/callback');
  return null;
}

function createOAuthState(provider, referralCode){
  const state = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now()+10*60*1000).toISOString();
  db.prepare('INSERT INTO oauth_states(state,provider,referral_code,expires_at) VALUES(?,?,?,?)')
    .run(state, provider, referralCode ? normalizeReferralCode(referralCode) : null, expiresAt);
  return state;
}

function consumeOAuthState(state, provider){
  if(!state) return null;
  const row = db.prepare('SELECT * FROM oauth_states WHERE state=? AND provider=?').get(state, provider);
  if(!row) return null;
  db.prepare('DELETE FROM oauth_states WHERE id=?').run(row.id);
  if(new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

function findOrCreateOAuthUser(provider, subject, profile, referralCode){
  const existing = db.prepare('SELECT user_id FROM oauth_identities WHERE provider=? AND subject=?').get(provider, subject);
  if(existing && existing.user_id){
    return db.prepare('SELECT * FROM users WHERE id=?').get(existing.user_id);
  }

  const emailAddr = email(profile.email || '');
  let user = emailAddr ? db.prepare('SELECT * FROM users WHERE email=?').get(emailAddr) : null;

  if(!user){
    const refCode = makeReferralCode();
    let referrerId = null;
    if(referralCode){
      const referrer = findReferrerByCode(referralCode);
      if(referrer && Number(referrer.active)===1) referrerId = Number(referrer.id);
    }
    const r = db.prepare(`
      INSERT INTO users(full_name,email,password_hash,role,business_id,referral_code,referred_by_user_id)
      VALUES(?,?,NULL,'owner',NULL,?,?)
    `).run(profile.name || emailAddr || 'Daftari+ User', emailAddr || null, refCode, referrerId);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(r.lastInsertRowid));
    if(referrerId) attachReferral(user.id, referralCode);
  }

  try{
    db.prepare(`
      INSERT INTO oauth_identities(provider,subject,user_id,email) VALUES(?,?,?,?)
      ON CONFLICT(provider,subject) DO UPDATE SET user_id=excluded.user_id, updated_at=datetime('now')
    `).run(provider, subject, user.id, emailAddr || null);
  }catch(e){ console.error('OAuth identity link error:', e.message); }

  return user;
}


/* =========================================================
   SESSION
   ========================================================= */

function session(uid){

  const token =
    crypto
      .randomBytes(48)
      .toString('base64url');


  const days =
    Math.max(
      1,
      Math.min(
        30,
        Number(
          process.env.SESSION_DAYS || 7
        )
      )
    );


  const expires =
    new Date(
      Date.now() +
      days * 864e5
    ).toISOString();


  db.prepare(
    'INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)'
  ).run(
    token,
    uid,
    expires
  );


  return token;

}


function current(req){

  const m =
    (
      req.headers.authorization || ''
    )
    .match(
      /^Bearer\s+(.+)$/i
    );


  if(!m)
    return null;


  const token =
    m[1];


  const s =
    db.prepare(
      'SELECT * FROM sessions WHERE token=?'
    ).get(token);


  if(
    !s ||
    new Date(s.expires_at) <=
    new Date()
  ){

    if(s){

      db.prepare(
        'DELETE FROM sessions WHERE token=?'
      ).run(token);

    }

    return null;

  }


  const u =
    db.prepare(`
      SELECT
        id,
        full_name,
        phone,
        business_id,
        email,
        role,
        active
      FROM users
      WHERE id=?
    `)
    .get(s.user_id);


  if(!u || !u.active)
    return null;


  if(
    u.role !== 'super_admin'
  ){

    const b =
      db.prepare(
        'SELECT status FROM businesses WHERE id=?'
      )
      .get(u.business_id);


    if(
      !b ||
      b.status !== 'active'
    )
      return null;

  }


  return u;

}


/* =========================================================
   SUBSCRIPTION HELPERS
   ========================================================= */

function subscriptionConfig(){

  return {

    baseUrl:
      String(
        process.env.PALMPESA_BASE_URL ||
        'https://palmpesa.drmlelwa.co.tz'
      )
      .replace(/\/+$/,''),

    token:
      String(
        process.env.PALMPESA_API_TOKEN ||
        ''
      ),

    userId:
      String(
        process.env.PALMPESA_USER_ID ||
        ''
      ),

    callbackUrl:
      String(
        process.env.PALMPESA_CALLBACK_URL ||
        `${process.env.PUBLIC_BASE_URL || ''}/api/subscription/webhook`
      )

  };

}


function parseFeatures(v){

  try{

    return JSON.parse(
      v || '[]'
    );

  }catch{

    return [];

  }

}


function effectivePlanPrice(
  plan,
  now=new Date()
){

  const day =
    now.toISOString().slice(0,10);


  const promo =
    plan.promotion_start &&
    plan.promotion_end &&
    day >= plan.promotion_start &&
    day <= plan.promotion_end;


  return (
    promo &&
    Number(plan.discount_percent)>0

      ?

      Math.max(
        0,
        Math.round(
          plan.regular_price_tzs *
          (
            1 -
            plan.discount_percent / 100
          )
        )
      )

      :

      Number(
        plan.final_price_tzs ||
        plan.regular_price_tzs ||
        0
      )
  );

}


function subscriptionForBusiness(
  bid
){

  const s =
    db.prepare(`
      SELECT
        s.*,
        p.name plan_name,
        p.code plan_code,
        p.duration_days,
        p.features_json,
        p.regular_price_tzs,
        p.discount_percent,
        p.promotion_name,
        p.promotion_start,
        p.promotion_end

      FROM subscriptions s

      JOIN subscription_plans p
        ON p.id=s.plan_id

      WHERE
        s.business_id=?
        AND s.status='ACTIVE'
        AND s.expires_at>?

      ORDER BY s.expires_at DESC

      LIMIT 1
    `)
    .get(
      bid,
      new Date().toISOString()
    );


  return s
    ? {
        ...s,
        features:
          parseFeatures(
            s.features_json
          )
      }
    : null;

}


/*
 * A PENDING subscription payment whose provider callback never arrived
 * (abandoned attempt, network failure, old test payment, etc.) should not
 * sit forever and make the client show "checking status..." indefinitely.
 * Anything still PENDING after 10 minutes is treated as expired.
 */
function expireStalePayments(businessId){
  try{

    /* Ombi ambalo halikufika PalmPesa (hakuna order_id) -> FAILED haraka */
    db.prepare(`
      UPDATE subscription_payments
      SET status='FAILED', failure_reason='Ombi la malipo halikufika PalmPesa. Jaribu tena.', updated_at=datetime('now')
      WHERE business_id=?
        AND status='PENDING'
        AND (order_id IS NULL OR order_id='')
        AND datetime(created_at) < datetime('now','-2 minutes')
    `).run(businessId);

    /* Lililofika lakini halikuthibitishwa ndani ya dakika 5 -> EXPIRED */
    db.prepare(`
      UPDATE subscription_payments
      SET status='EXPIRED', failure_reason='Muda wa malipo umeisha (haikuthibitishwa).', updated_at=datetime('now')
      WHERE business_id=?
        AND status='PENDING'
        AND datetime(created_at) < datetime('now','-5 minutes')
    `).run(businessId);

  }catch(e){
    console.error('expireStalePayments error:', e.message);
  }
}

/* Sweep ya kila biashara — inasafisha PENDING zote hata mtumiaji asipofungua page */
function expireAllStalePayments(){
  try{
    const rows=db.prepare(`
      SELECT DISTINCT business_id
      FROM subscription_payments
      WHERE status='PENDING'
    `).all();

    for(const r of rows)
      expireStalePayments(r.business_id);

  }catch(e){
    console.error('expireAllStalePayments error:', e.message);
  }
}

function subscriptionStatus(
  bid
){

  const active =
    subscriptionForBusiness(bid);


  if(active){

    return {

      active:true,

      status:'ACTIVE',

      subscription:active

    };

  }


  const last =
    db.prepare(`
      SELECT
        s.*,
        p.name plan_name,
        p.code plan_code

      FROM subscriptions s

      JOIN subscription_plans p
        ON p.id=s.plan_id

      WHERE s.business_id=?

      ORDER BY s.created_at DESC

      LIMIT 1
    `)
    .get(bid);


  return {

    active:false,

    status:
      last
        ? 'EXPIRED'
        : 'NO_SUBSCRIPTION',

    subscription:
      last || null

  };

}


/*
 * Subscription gate — enforced by bizOnly() and owner().
 */
function requireSubscription(
  req,
  res,
  u
){

  if(
    !u ||
    u.role === 'super_admin'
  )
    return true;


  const st =
    subscriptionStatus(
      u.business_id
    );


  if(st.active)
    return true;


  json(
    res,
    402,
    {
      error:
        'Subscription yako imeisha au haijawezeshwa. Renew subscription ili uendelee kutumia Daftari+.',

      code:
        'SUBSCRIPTION_REQUIRED',

      subscriptionStatus:
        st.status,

      redirect:
        '/subscription/subscription.html'
    }
  );


  return false;

}


/* =========================================================
   PALMPESA
   ========================================================= */

async function palmPesaRequest(
  endpoint,
  payload
){

  const c =
    subscriptionConfig();


  if(!c.token){

    throw Object.assign(
      new Error(
        'PalmPesa haija-configurewa: PALMPESA_API_TOKEN haipo.'
      ),
      {
        statusCode:503
      }
    );

  }


  /*
   * Timeout: bila hii, kama PalmPesa haijibu, request inaning'inia milele
   * na payment inabaki PENDING bila order_id.
   */
  const ctrl =
    new AbortController();

  const timer =
    setTimeout(
      ()=>ctrl.abort(),
      20000
    );

  let r;

  try{

    r =
      await fetch(
        c.baseUrl + endpoint,
        {
          method:'POST',

          signal:
            ctrl.signal,

          headers:{
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${c.token}`
          },

          body:
            JSON.stringify(payload)
        }
      );

  }catch(err){

    throw Object.assign(
      new Error(
        err?.name === 'AbortError'
          ? 'PalmPesa haijajibu kwa wakati. Jaribu tena.'
          : 'Imeshindwa kuwasiliana na PalmPesa. Jaribu tena.'
      ),
      {
        statusCode:504
      }
    );

  }finally{

    clearTimeout(timer);

  }


  let d={};


  try{

    d=await r.json();

  }catch{}


  if(!r.ok){

    throw Object.assign(
      new Error(
        d?.message ||
        d?.error ||
        `PalmPesa request failed (${r.status})`
      ),
      {
        statusCode:r.status
      }
    );

  }


  return d;

}


function normalizePhone(v){

  let s =
    clean(v)
      .replace(/[^\d+]/g,'');


  if(
    s.startsWith('+')
  )
    s=s.slice(1);


  if(
    s.startsWith('255')
  )
    return s;


  if(
    /^0[67]\d{8}$/.test(s)
  )
    return s;


  throw Error(
    'Namba ya simu si sahihi. Tumia 07XXXXXXXX, 06XXXXXXXX au 255XXXXXXXXX.'
  );

}


function makeSubscriptionTransactionId(
  bid
){

  return (
    `DP-SUB-${bid}-${Date.now()}-` +
    crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase()
  );

}


/* =========================================================
   ACTIVATE SUBSCRIPTION
   ========================================================= */

function activateSubscription(
  payment
){

  return transaction(
    ()=>{

      const p =
        db.prepare(
          'SELECT * FROM subscription_payments WHERE id=?'
        )
        .get(payment.id);


      if(!p)
        return null;


      if(
        p.status === 'SUCCESSFUL' &&
        p.subscription_id
      ){

        return db.prepare(
          'SELECT * FROM subscriptions WHERE id=?'
        )
        .get(
          p.subscription_id
        );

      }


      const plan =
        db.prepare(`
          SELECT *
          FROM subscription_plans
          WHERE id=?
          AND active=1
        `)
        .get(
          p.plan_id
        );


      if(!plan){

        throw Error(
          'Subscription plan haipo tena.'
        );

      }


      const existing =
        subscriptionForBusiness(
          p.business_id
        );


      const start =
        existing
          ? new Date(existing.expires_at)
          : new Date();


      const expires =
        new Date(
          start.getTime() +
          Number(plan.duration_days) *
          864e5
        );


      const r =
        db.prepare(`
          INSERT INTO subscriptions
          (
            business_id,
            plan_id,
            amount_paid_tzs,
            status,
            start_at,
            expires_at,
            order_id,
            transaction_id,
            phone
          )
          VALUES(?,?,?,?,?,?,?,?,?)
        `)
        .run(
          p.business_id,
          plan.id,
          p.amount_tzs,
          'ACTIVE',
          start.toISOString(),
          expires.toISOString(),
          p.order_id,
          p.transaction_id,
          p.phone
        );


      const sid =
        Number(
          r.lastInsertRowid
        );


      db.prepare(`
        UPDATE subscription_payments
        SET
          status='SUCCESSFUL',
          subscription_id=?,
          updated_at=datetime('now')
        WHERE id=?
      `)
      .run(
        sid,
        p.id
      );


      try{
        const payingOwner = db.prepare(
          "SELECT id FROM users WHERE business_id=? AND role='owner' LIMIT 1"
        ).get(p.business_id);
        if(payingOwner){
          createReferralCommissions(p.id, payingOwner.id, p.amount_tzs);
        }
      }catch(e){
        console.error('Referral commission trigger error:', e.message);
      }


      return db.prepare(`
        SELECT
          s.*,
          p.name plan_name,
          p.code plan_code,
          p.duration_days

        FROM subscriptions s

        JOIN subscription_plans p
          ON p.id=s.plan_id

        WHERE s.id=?
      `)
      .get(sid);

    }
  );

}


/* =========================================================
   AUTH
   ========================================================= */

function auth(
  req,
  res,
  roles
){

  const u =
    current(req);


  if(!u){

    json(
      res,
      401,
      {
        error:
          'Haujaingia au session imeisha.'
      }
    );

    return null;

  }


  if(
    roles &&
    (
      Array.isArray(roles)
        ? !roles.includes(u.role)
        : u.role !== roles
    )
  ){

    json(
      res,
      403,
      {
        error:
          'Huna ruhusa ya kufanya kitendo hiki.'
      }
    );

    return null;

  }


  return u;

}


/*
 * BUSINESS DATA:
 * Subscription gate imerudishwa.
 */
function bizOnly(
  req,
  res
){

  const u =
    auth(req,res);


  if(!u)
    return null;


  if(
    u.role === 'super_admin'
  ){

    json(
      res,
      403,
      {
        error:
          'Tumia Super Admin panel kwa shughuli za platform.'
      }
    );

    return null;

  }


  if(
    !requireSubscription(req,res,u)
  )
    return null;


  return u;

}


/*
 * OWNER:
 * Subscription gate imerudishwa.
 */
function owner(
  req,
  res
){

  const u =
    auth(
      req,
      res,
      ['owner','super_admin']
    );


  if(!u)
    return null;


  if(
    u.role !== 'super_admin' &&
    !requireSubscription(req,res,u)
  )
    return null;


  return u;

}


/* =========================================================
   AUDIT
   ========================================================= */

function audit(
  bid,
  uid,
  action,
  details
){

  try{

    db.prepare(`
      INSERT INTO audit_logs
      (
        business_id,
        user_id,
        action,
        details
      )
      VALUES(?,?,?,?)
    `)
    .run(
      bid,
      uid,
      action,
      details || null
    );

  }catch{}

}


/* =========================================================
   TRANSACTION
   ========================================================= */

function transaction(
  fn
){

  db.exec(
    'BEGIN IMMEDIATE'
  );


  try{

    const r=fn();

    db.exec(
      'COMMIT'
    );

    return r;

  }catch(e){

    try{
      db.exec(
        'ROLLBACK'
      );
    }catch{}

    throw e;

  }

}


/* =========================================================
   DATE RANGE
   ========================================================= */

function range(x){

  const now =
    new Date();


  const toDay =
    now
      .toISOString()
      .slice(0,10);


  let f=x.from,
      t=x.to;


  if(
    x.period &&
    !f
  ){

    const d =
      new Date(now);


    if(
      x.period === 'day'
    )
      d.setHours(
        0,0,0,0
      );


    if(
      x.period === 'week'
    ){

      d.setDate(
        d.getDate() -
        (
          (d.getDay()+6)%7
        )
      );

      d.setHours(
        0,0,0,0
      );

    }


    if(
      x.period === 'month'
    )
      d.setDate(1);


    if(
      x.period === '3m'
    ){

      d.setDate(1);

      d.setMonth(
        d.getMonth()-2
      );

    }


    if(
      x.period === '6m'
    ){

      d.setDate(1);

      d.setMonth(
        d.getMonth()-5
      );

    }


    if(
      x.period === 'year'
    ){

      d.setMonth(
        0,
        1
      );

      d.setHours(
        0,0,0,0
      );

    }


    f =
      d
        .toISOString()
        .slice(0,10);


    t=toDay;

  }


  if(x.year){

    f=`${x.year}-01-01`;

    t=`${x.year}-12-31`;

  }


  return [

    f
      ? f+' 00:00:00'
      : '1970-01-01 00:00:00',

    t
      ? t+' 23:59:59'
      : '2999-12-31 23:59:59'

  ];

}


/* =========================================================
   SUPER ADMIN
   ========================================================= */

function ensureSuperAdmin(){

  const e =
    email(
      process.env.SUPER_ADMIN_EMAIL
    );

  const p =
    process.env.SUPER_ADMIN_PASSWORD;


  if(!e && !p)
    return;


  if(
    !validEmail(e) ||
    !p ||
    p.length < 12
  ){

    throw Error(
      'SUPER_ADMIN_EMAIL na SUPER_ADMIN_PASSWORD (angalau herufi 12) lazima viwe valid.'
    );

  }


  const x =
    db.prepare(`
      SELECT id
      FROM users
      WHERE email=?
      AND role='super_admin'
    `)
    .get(e);


  if(!x){

    db.prepare(`
      INSERT INTO users
      (
        full_name,
        business_id,
        email,
        password_hash,
        role
      )
      VALUES(?,?,?,?, 'super_admin')
    `)
    .run(
      'Daftari+ Super Admin',
      0,
      e,
      hash(p)
    );

  }

}


ensureSuperAdmin();


/* =========================================================
   RATE LIMIT
   ========================================================= */

const attempts =
  new Map();


function rate(
  req,
  key
){

  const ip =
    req.socket.remoteAddress ||
    'unknown';


  const k =
    key + ':' + ip;


  const now =
    Date.now();


  const a =
    (
      attempts.get(k) ||
      []
    )
    .filter(
      t =>
        now-t < 9e5
    );


  if(
    a.length >= 10
  ){

    attempts.set(
      k,
      a
    );

    return false;

  }


  a.push(now);

  attempts.set(
    k,
    a
  );


  return true;

}


/* =========================================================
   DASHBOARD
   ========================================================= */

function dashboard(
  req,
  res
){

  const u =
    owner(
      req,
      res
    );


  if(!u)
    return;


  const b =
    u.business_id;


  const s =
    db.prepare(`
      SELECT
        COUNT(*) count,
        COALESCE(
          SUM(total),
          0
        ) revenue,

        COALESCE(
          SUM(
            (sell_price-buy_price)
            * quantity
            - discount
          ),
          0
        ) gross

      FROM sales

      WHERE business_id=?
    `)
    .get(b);


  const e =
    db.prepare(`
      SELECT
        COALESCE(
          SUM(amount),
          0
        ) total

      FROM expenses

      WHERE business_id=?
    `)
    .get(b);


  const d =
    db.prepare(`
      SELECT
        COALESCE(
          SUM(amount-paid),
          0
        ) total

      FROM debts

      WHERE business_id=?
      AND amount>paid
    `)
    .get(b);


  const p =
    db.prepare(`
      SELECT
        COUNT(*) count

      FROM products

      WHERE business_id=?
      AND active=1
    `)
    .get(b);


  const lowStock =
    db.prepare(`
      SELECT
        id,
        name,
        quantity,
        min_stock

      FROM products

      WHERE business_id=?
      AND active=1
      AND quantity<=min_stock

      ORDER BY quantity
    `)
    .all(b);


  json(
    res,
    200,
    {
      summary:{

        totalSales:
          s.count,

        totalRevenue:
          s.revenue,

        totalExpenses:
          e.total,

        totalDebts:
          d.total,

        totalProfit:
          s.gross-e.total,

        productCount:
          p.count,

        lowStock

      }
    }
  );

}


/* =========================================================
   PUSH NOTIFICATIONS (OneSignal)

   Weka ONESIGNAL_APP_ID na ONESIGNAL_API_KEY kwenye environment
   variables za server (.env au process env). Ukitumia provider
   mwingine (FCM/Expo), badilisha tu ndani ya sendPushToTokens().
   ========================================================= */

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || '';

async function sendPushToTokens(
  tokens,
  title,
  message,
  data
){

  if(
    !tokens ||
    !tokens.length ||
    !ONESIGNAL_APP_ID ||
    !ONESIGNAL_API_KEY
  ){
    return { sent:0, skipped:true };
  }

  try{

    const resp = await fetch(
      'https://onesignal.com/api/v1/notifications',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json; charset=utf-8',
          'Authorization':`Basic ${ONESIGNAL_API_KEY}`
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          include_player_ids: tokens,
          headings: { en: title, sw: title },
          contents: { en: message, sw: message },
          data: data || {}
        })
      }
    );

    if(!resp.ok){
      console.error(
        'OneSignal error',
        resp.status,
        await resp.text()
      );
      return { sent:0, error:true };
    }

    return { sent: tokens.length };

  }catch(e){
    console.error('sendPushToTokens failed', e);
    return { sent:0, error:true };
  }

}

function pushTokensForBusiness(businessId){

  return db.prepare(
    'SELECT token FROM push_tokens WHERE business_id=?'
  )
  .all(businessId)
  .map(r => r.token);

}

function businessWindowStats(
  businessId,
  sinceIso
){

  const s = db.prepare(`
    SELECT
      COUNT(*) count,
      COALESCE(SUM(total),0) revenue,
      COALESCE(
        SUM(
          (sell_price-buy_price)*quantity - discount
        ),
        0
      ) profit
    FROM sales
    WHERE business_id=?
    AND created_at>=?
  `)
  .get(businessId, sinceIso);

  return s;

}

function formatTzs(n){
  return Math.round(n||0).toLocaleString('en-US');
}

/*
 * Inaita kila dakika chache; kwa kila biashara yenye
 * notify_summary_enabled=1, ikiwa notify_interval_minutes
 * zimepita tangu last_summary_notified_at, inatuma muhtasari
 * (mauzo/faida ya kipindi hicho, au ujumbe wa 'bado hujauza').
 */
async function runPeriodicBusinessSummaries(){

  const businesses = db.prepare(`
    SELECT
      id, name, notify_interval_minutes, last_summary_notified_at
    FROM businesses
    WHERE status='active'
    AND notify_summary_enabled=1
  `)
  .all();

  const now = new Date();

  for(const biz of businesses){

    const intervalMin = biz.notify_interval_minutes || 120;

    const last = biz.last_summary_notified_at
      ? new Date(biz.last_summary_notified_at + 'Z')
      : null;

    const dueMs = intervalMin * 60 * 1000;

    if(
      last &&
      (now - last) < dueMs
    ){
      continue;
    }

    const sinceIso = last
      ? biz.last_summary_notified_at
      : new Date(now - dueMs).toISOString().slice(0,19).replace('T',' ');

    const sub = subscriptionForBusiness(biz.id);

    const hours = Math.round(intervalMin / 60);

    const title = biz.name;

    let message;

    if(!sub){

      message = 'Huwezi kupokea taarifa za mauzo na faida kwa sababu huja lipia. Lipia sasa ili uendelee kupata muhtasari na huduma zote.';

    }else{

      const stats = businessWindowStats(biz.id, sinceIso);

      message = stats.count > 0
        ? `Masaa ${hours} yaliyopita: umeuza mara ${stats.count}, mauzo TZS ${formatTzs(stats.revenue)}, faida TZS ${formatTzs(stats.profit)}.`
        : `Bado hujarekodi mauzo yoyote kwa masaa ${hours} yaliyopita.`;

    }

    const tokens = pushTokensForBusiness(biz.id);

    await sendPushToTokens(
      tokens,
      title,
      message,
      {
        type: sub ? 'periodic_summary' : 'periodic_summary_unpaid',
        business_id:biz.id
      }
    );

    db.prepare(
      "UPDATE businesses SET last_summary_notified_at=datetime('now') WHERE id=?"
    )
    .run(biz.id);

  }

}


/* =========================================================
   API
   ========================================================= */

async function api(
  req,
  res
){

  const p =
    req.url.split('?')[0];


  const m =
    req.method;


  if(
    m === 'OPTIONS'
  ){

    return json(
      res,
      204,
      {}
    );

  }


  db.prepare(
    "DELETE FROM sessions WHERE expires_at<=datetime('now')"
  )
  .run();


  /* =======================================================
     HEALTH
     ======================================================= */

  if(
    p === '/api/health'
  ){

    return json(
      res,
      200,
      {
        ok:true,
        service:'daftari-plus'
      }
    );

  }


  /* =======================================================
     LOGIN
     ======================================================= */

  if(
    p === '/api/login' &&
    m === 'POST'
  ){

    if(
      !rate(
        req,
        'login'
      )
    ){

      return json(
        res,
        429,
        {
          error:
            'Majaribio mengi. Subiri dakika 15.'
        }
      );

    }


    const x =
      await body(req);


    const e =
      email(x.email);


    const pw =
      String(
        x.password || ''
      );


    const u =
      db.prepare(
        'SELECT * FROM users WHERE email=?'
      )
      .get(e);


    if(
      !u ||
      !verify(
        pw,
        u.password_hash
      ) ||
      !u.active
    ){

      return json(
        res,
        401,
        {
          error:
            'Email au password si sahihi.'
        }
      );

    }


    if(
      u.role !== 'super_admin'
    ){

      const b =
        db.prepare(
          'SELECT status FROM businesses WHERE id=?'
        )
        .get(
          u.business_id
        );


      if(!b){

        return json(
          res,
          403,
          {
            error:
              'Biashara haipo.'
          }
        );

      }


      if(
        b.status !== 'active'
      ){

        return json(
          res,
          403,
          {
            error:
              'Biashara imesimamishwa.'
          }
        );

      }

    }


    if(u.business_id){

      audit(
        u.business_id,
        u.id,
        'LOGIN',
        'Successful login'
      );

    }


    return json(
      res,
      200,
      {

        token:
          session(u.id),

        user:{

          id:u.id,

          full_name:
            u.full_name,

          phone:
            u.phone,

          email:
            u.email,

          role:
            u.role,

          business_id:
            u.business_id

        }

      }
    );

  }


  /* =======================================================
     REGISTER
     ======================================================= */

  if(
    p === '/api/register' &&
    m === 'POST'
  ){

    if(
      !rate(
        req,
        'register'
      )
    ){

      return json(
        res,
        429,
        {
          error:
            'Majaribio mengi. Subiri dakika 15.'
        }
      );

    }


    const x =
      await body(req);


    const name =
      clean(
        x.fullName
      );


    const phone =
      clean(
        x.phone
      );


    const e =
      email(
        x.email
      );


    const pw =
      String(
        x.password || ''
      );


    const role =
      x.role === 'saler'
        ? 'saler'
        : 'owner';


    const referralCode =
      normalizeReferralCode(
        x.referralCode || x.referral || x.ref
      );


    if(
      !name ||
      !phone ||
      !validEmail(e) ||
      pw.length < 10
    ){

      return json(
        res,
        400,
        {
          error:
            'Jina, simu, email sahihi na password ya angalau herufi 10 vinahitajika.'
        }
      );

    }


    if(
      db.prepare(
        'SELECT id FROM users WHERE email=?'
      )
      .get(e)
    ){

      return json(
        res,
        409,
        {
          error:
            'Email hii tayari imesajiliwa.'
        }
      );

    }


    let bid,
        biz;


    if(
      role === 'owner'
    ){

      const bn =
        clean(
          x.businessName
        );


      const loc =
        clean(
          x.businessLocation
        );


      const region =
        clean(
          x.region
        );


      const district =
        clean(
          x.district
        );


      const ward =
        clean(
          x.ward
        );


      const country =
        clean(
          x.country
        );


      const businessPhone =
        clean(
          x.businessPhone
        );


      if(
        !bn ||
        !loc ||
        !region ||
        !district ||
        !ward ||
        !country ||
        !businessPhone
      ){

        return json(
          res,
          400,
          {
            error:
              'Jina la biashara, mkoa, wilaya, kata, nchi, namba ya simu ya biashara, na eneo vinahitajika.'
          }
        );

      }


      const c =
        makeCode();


      const r =
        db.prepare(`
          INSERT INTO businesses
          (
            name,
            code,
            location,
            region,
            district,
            ward,
            country,
            business_phone
          )
          VALUES(?,?,?,?,?,?,?,?)
        `)
        .run(
          bn,
          c,
          loc,
          region,
          district,
          ward,
          country,
          businessPhone
        );


      bid =
        Number(
          r.lastInsertRowid
        );


      biz =
        db.prepare(
          'SELECT * FROM businesses WHERE id=?'
        )
        .get(bid);

    }else{

      const bc =
        clean(
          x.businessCode
        )
        .toUpperCase();


      biz =
        db.prepare(
          'SELECT * FROM businesses WHERE code=?'
        )
        .get(bc);


      if(!biz){

        return json(
          res,
          404,
          {
            error:
              'Business Code haipo.'
          }
        );

      }


      if(
        biz.status !== 'active'
      ){

        return json(
          res,
          403,
          {
            error:
              'Biashara hii imesimamishwa.'
          }
        );

      }


      const bizSub =
        subscriptionForBusiness(biz.id);

      if(bizSub){
        const rules = tierRulesForPlan(bizSub);
        if(rules && rules.maxWorkers !== null && rules.maxWorkers >= 0){
          const salerCount = currentSalerCount(biz.id);
          if(salerCount >= rules.maxWorkers){
            return json(res, 403, {
              error: `Business Code hii imefikia kikomo cha wafanyakazi (${rules.maxWorkers}) kwa package ya sasa. Mmiliki anahitaji ku-upgrade subscription.`
            });
          }
        }
      }


      bid =
        biz.id;

    }


    const r =
      db.prepare(`
        INSERT INTO users
        (
          full_name,
          phone,
          business_id,
          email,
          password_hash,
          role
        )
        VALUES(?,?,?,?,?,?)
      `)
      .run(
        name,
        phone,
        bid,
        e,
        hash(pw),
        role
      );


    const uid =
      Number(
        r.lastInsertRowid
      );


    if(
      role === 'owner'
    ){

      db.prepare(
        'UPDATE businesses SET owner_id=? WHERE id=?'
      )
      .run(
        uid,
        bid
      );

    }


    const myReferralCode =
      ensureUserReferralCode(uid);

    let referralAttach = null;
    if(referralCode){
      referralAttach = attachReferral(uid, referralCode);
    }


    audit(
      bid,
      uid,
      'REGISTER',
      `New ${role}`
    );


    return json(
      res,
      201,
      {

        token:
          session(uid),

        user:{

          id:uid,

          full_name:
            name,

          phone,

          email:e,

          role,

          business_id:
            bid,

          referral_code:
            myReferralCode

        },

        business:{

          name:
            biz.name,

          code:
            biz.code,

          location:
            biz.location,

          region:
            biz.region,

          district:
            biz.district,

          ward:
            biz.ward,

          country:
            biz.country,

          business_phone:
            biz.business_phone

        },

        referral: referralCode ? {
          code_used: referralCode,
          attached: !!(referralAttach && referralAttach.ok),
          reason: referralAttach ? referralAttach.reason || null : null
        } : null

      }
    );

  }


  /* =======================================================
     GOOGLE OAUTH — START
     ======================================================= */

  if(
    p === '/api/auth/google/start' &&
    m === 'GET'
  ){

    const params = q(req);
    const referralCode = normalizeReferralCode(params.ref || params.referral || params.referralCode);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = oauthRedirectUri('google');

    if(!clientId){
      return json(res, 500, {
        error: 'Google OAuth haijawekwa bado (GOOGLE_CLIENT_ID haipo kwenye environment variables).'
      });
    }

    const state = createOAuthState('google', referralCode);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');

    res.writeHead(302, { Location: url.toString() });
    return res.end();

  }


  /* =======================================================
     GOOGLE OAUTH — CALLBACK
     ======================================================= */

  if(
    p === '/api/auth/google/callback' &&
    m === 'GET'
  ){

    const params = q(req);
    const code = params.code;
    const state = params.state;
    const loginPage = '/login.html';

    const stateRow = consumeOAuthState(state, 'google');
    if(!stateRow || !code){
      res.writeHead(302, { Location: loginPage + '?oauth_error=invalid_state' });
      return res.end();
    }

    try{
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = oauthRedirectUri('google');

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirectUri, grant_type: 'authorization_code'
        })
      });
      const tokenData = await tokenRes.json();
      if(!tokenRes.ok || !tokenData.access_token) throw Error(tokenData.error_description || 'Google token exchange failed');

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + tokenData.access_token }
      });
      const profile = await profileRes.json();
      if(!profile.sub) throw Error('Google haikurudisha taarifa za profile.');

      const user = findOrCreateOAuthUser('google', profile.sub, { email: profile.email, name: profile.name }, stateRow.referral_code);
      const tok = session(user.id);

      res.writeHead(302, { Location: `/oauth-complete.html?token=${encodeURIComponent(tok)}` });
      return res.end();

    }catch(e){
      console.error('Google OAuth callback error:', e.message);
      res.writeHead(302, { Location: loginPage + '?oauth_error=google_failed' });
      return res.end();
    }

  }


  /* =======================================================
     APPLE OAUTH — START
     ======================================================= */

  if(
    p === '/api/auth/apple/start' &&
    m === 'GET'
  ){

    const params = q(req);
    const referralCode = normalizeReferralCode(params.ref || params.referral || params.referralCode);
    const clientId = process.env.APPLE_CLIENT_ID;
    const redirectUri = oauthRedirectUri('apple');

    if(!clientId){
      return json(res, 500, {
        error: 'Apple Sign In haijawekwa bado (APPLE_CLIENT_ID haipo kwenye environment variables).'
      });
    }

    const state = createOAuthState('apple', referralCode);
    const url = new URL('https://appleid.apple.com/auth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'form_post');
    url.searchParams.set('scope', 'name email');
    url.searchParams.set('state', state);

    res.writeHead(302, { Location: url.toString() });
    return res.end();

  }


  /* =======================================================
     APPLE OAUTH — CALLBACK
     ======================================================= */

  if(
    p === '/api/auth/apple/callback' &&
    (m === 'GET' || m === 'POST')
  ){

    const loginPage = '/login.html';
    let code, state, userPayload = {};

    if(m === 'POST'){
      const x = await body(req).catch(()=>({}));
      code = x.code; state = x.state;
      try{ userPayload = x.user ? JSON.parse(x.user) : {}; }catch{}
    }else{
      const params = q(req);
      code = params.code; state = params.state;
    }

    const stateRow = consumeOAuthState(state, 'apple');
    if(!stateRow || !code){
      res.writeHead(302, { Location: loginPage + '?oauth_error=invalid_state' });
      return res.end();
    }

    try{
      const clientId = process.env.APPLE_CLIENT_ID;
      const teamId = process.env.APPLE_TEAM_ID;
      const keyId = process.env.APPLE_KEY_ID;
      const privateKey = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
      if(!clientId || !teamId || !keyId || !privateKey) throw Error('Apple OAuth env vars hazijakamilika.');

      const b64url = buf => buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const header = b64url(Buffer.from(JSON.stringify({ alg:'ES256', kid:keyId })));
      const now = Math.floor(Date.now()/1000);
      const payload = b64url(Buffer.from(JSON.stringify({
        iss: teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: clientId
      })));
      const signInput = header + '.' + payload;
      const sign = crypto.createSign('SHA256');
      sign.update(signInput);
      const signature = b64url(sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }));
      const clientSecret = signInput + '.' + signature;

      const redirectUri = oauthRedirectUri('apple');
      const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret, code,
          grant_type: 'authorization_code', redirect_uri: redirectUri
        })
      });
      const tokenData = await tokenRes.json();
      if(!tokenRes.ok || !tokenData.id_token) throw Error(tokenData.error || 'Apple token exchange failed');

      const idParts = tokenData.id_token.split('.');
      const idPayload = JSON.parse(Buffer.from(idParts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
      const subject = idPayload.sub;
      const emailAddr = idPayload.email || null;
      const fullName = userPayload.name ? `${userPayload.name.firstName||''} ${userPayload.name.lastName||''}`.trim() : null;

      const user = findOrCreateOAuthUser('apple', subject, { email: emailAddr, name: fullName }, stateRow.referral_code);
      const tok = session(user.id);

      res.writeHead(302, { Location: `/oauth-complete.html?token=${encodeURIComponent(tok)}` });
      return res.end();

    }catch(e){
      console.error('Apple OAuth callback error:', e.message);
      res.writeHead(302, { Location: loginPage + '?oauth_error=apple_failed' });
      return res.end();
    }

  }


  /* =======================================================
     REFERRAL — ME
     ======================================================= */

  /* =======================================================
     PUBLIC — REFERRAL CODE LOOKUP (used on register page)
     ======================================================= */

  if(
    p === '/api/referral/lookup' &&
    m === 'GET'
  ){

    const referrer = findReferrerByCode(q(req).code || '');

    if(!referrer || referrer.active === 0){
      return json(res, 200, { valid:false });
    }

    return json(res, 200, {
      valid:true,
      name: referrer.full_name,
      role: referrer.role
    });

  }


  /* =======================================================
     REFERRAL — MY LINK / TEAM / EARNINGS
     ======================================================= */

  if(
    p === '/api/referral/me' &&
    m === 'GET'
  ){

    const u = auth(req, res, ['owner','saler']);
    if(!u) return;

    const referralCode = ensureUserReferralCode(u.id);
    const base = oauthBaseUrl();
    const directMembers = db.prepare(
      'SELECT id,full_name,email,role,active,created_at FROM users WHERE referred_by_user_id=? ORDER BY id DESC'
    ).all(u.id);
    const commissions = db.prepare(`
      SELECT rc.id,rc.level,rc.percentage,rc.base_amount_tzs,rc.amount_tzs,rc.status,rc.paid_at,rc.created_at,
             ru.full_name referred_user_name
      FROM referral_commissions rc
      LEFT JOIN users ru ON ru.id=rc.referred_user_id
      WHERE rc.user_id=? ORDER BY rc.id DESC
    `).all(u.id);
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status='pending' THEN amount_tzs ELSE 0 END),0) pending,
        COALESCE(SUM(CASE WHEN status='paid' THEN amount_tzs ELSE 0 END),0) paid,
        COALESCE(SUM(amount_tzs),0) total
      FROM referral_commissions WHERE user_id=?
    `).get(u.id);

    const wd = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status='pending' AND withdrawal_id IS NULL THEN amount_tzs ELSE 0 END),0) withdrawable,
        COALESCE(SUM(CASE WHEN status='pending' AND withdrawal_id IS NOT NULL THEN amount_tzs ELSE 0 END),0) in_withdrawal
      FROM referral_commissions WHERE user_id=?
    `).get(u.id);

    const withdrawals = db.prepare(`
      SELECT id,amount_tzs,phone,network,account_name,status,note,created_at,processed_at
      FROM referral_withdrawals
      WHERE user_id=? ORDER BY id DESC LIMIT 50
    `).all(u.id);

    return json(res, 200, {
      referral_code: referralCode,
      referral_link: `${base}/register.html?ref=${encodeURIComponent(referralCode)}`,
      direct_members: directMembers,
      direct_count: directMembers.length,
      commissions,
      totals,
      withdrawable: Number(wd.withdrawable),
      in_withdrawal: Number(wd.in_withdrawal),
      min_withdraw: REFERRAL_MIN_WITHDRAW_TZS,
      networks: WITHDRAW_NETWORKS,
      withdrawals
    });

  }


  /* =======================================================
     REFERRAL — WITHDRAW EARNINGS (ombi la kutoa pesa)
     ======================================================= */

  if(
    p === '/api/referral/withdraw' &&
    m === 'POST'
  ){

    const u = auth(req, res, ['owner','saler']);
    if(!u) return;

    const x = await body(req);

    const network = clean(x.network).toLowerCase();

    if(!WITHDRAW_NETWORKS[network]){
      return json(res, 400, { error:'Chagua mtandao wa simu (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa au T-Pesa).' });
    }

    const accountName = clean(x.fullName).replace(/\s+/g,' ');

    if(
      accountName.length < 5 ||
      accountName.length > 80 ||
      !accountName.includes(' ')
    ){
      return json(res, 400, { error:'Weka majina kamili kama yanavyoonekana kwenye namba ya simu (jina la kwanza na la mwisho).' });
    }

    let phone;

    try{
      phone = normalizePhone(x.phone);
    }catch(e){
      return json(res, 400, { error: e.message });
    }

    let result;

    try{

      result = transaction(()=>{

        const t = db.prepare(`
          SELECT COALESCE(SUM(amount_tzs),0) amt
          FROM referral_commissions
          WHERE user_id=? AND status='pending' AND withdrawal_id IS NULL
        `).get(u.id);

        const amt = Number(t.amt);

        if(amt <= 0){
          throw Object.assign(
            new Error('Huna mapato ya kutoa kwa sasa (huenda tayari umeomba).'),
            { statusCode:400 }
          );
        }

        if(amt < REFERRAL_MIN_WITHDRAW_TZS){
          throw Object.assign(
            new Error(
              `Kiwango cha chini cha kutoa ni TSh ${REFERRAL_MIN_WITHDRAW_TZS.toLocaleString('en-US')}. ` +
              `Kiasi ulichonacho: TSh ${amt.toLocaleString('en-US')}.`
            ),
            { statusCode:400 }
          );
        }

        const r = db.prepare(`
          INSERT INTO referral_withdrawals(user_id,amount_tzs,phone,network,account_name,status)
          VALUES(?,?,?,?,?,'pending')
        `).run(u.id, amt, phone, network, accountName);

        const wid = Number(r.lastInsertRowid);

        db.prepare(`
          UPDATE referral_commissions
          SET withdrawal_id=?
          WHERE user_id=? AND status='pending' AND withdrawal_id IS NULL
        `).run(wid, u.id);

        return { id:wid, amount_tzs:amt };

      });

    }catch(e){

      if(!e.statusCode) throw e;

      return json(res, e.statusCode, { error: e.message });

    }

    audit(
      u.business_id,
      u.id,
      'REFERRAL_WITHDRAWAL_REQUEST',
      `Withdrawal #${result.id}; TSh ${result.amount_tzs}; ${WITHDRAW_NETWORKS[network]}; ${accountName}; ${phone}`
    );

    return json(res, 200, {
      ok:true,
      withdrawal:{
        id:result.id,
        amount_tzs:result.amount_tzs,
        phone,
        network,
        account_name:accountName,
        status:'pending'
      },
      message:'Ombi la kutoa pesa limetumwa. Litalipwa hivi karibuni.'
    });

  }


  /* =======================================================
     SUPER ADMIN — REFERRAL WITHDRAWALS
     ======================================================= */

  if(
    p === '/api/super/referral-withdrawals' &&
    m === 'GET'
  ){

    const u = auth(req, res, 'super_admin');
    if(!u) return;

    const rows = db.prepare(`
      SELECT w.*, us.full_name referrer_name, us.email referrer_email
      FROM referral_withdrawals w
      LEFT JOIN users us ON us.id=w.user_id
      ORDER BY w.id DESC LIMIT 500
    `).all();

    return json(res, 200, { withdrawals: rows });

  }


  const wdAction =
    p.match(/^\/api\/super\/referral-withdrawals\/(\d+)\/(pay|reject)$/);

  if(wdAction && m === 'PUT'){

    const u = auth(req, res, 'super_admin');
    if(!u) return;

    const wid = Number(wdAction[1]);
    const act = wdAction[2];
    const x = await body(req);

    try{

      transaction(()=>{

        const w = db.prepare(
          'SELECT * FROM referral_withdrawals WHERE id=?'
        ).get(wid);

        if(!w)
          throw Object.assign(new Error('Withdrawal haipatikani.'), { statusCode:404 });

        if(w.status !== 'pending')
          throw Object.assign(new Error('Withdrawal hii tayari imeshughulikiwa.'), { statusCode:409 });

        if(act === 'pay'){

          db.prepare(`
            UPDATE referral_withdrawals
            SET status='paid', processed_at=datetime('now')
            WHERE id=?
          `).run(wid);

          db.prepare(`
            UPDATE referral_commissions
            SET status='paid', paid_at=datetime('now')
            WHERE withdrawal_id=? AND status='pending'
          `).run(wid);

        }else{

          db.prepare(`
            UPDATE referral_withdrawals
            SET status='rejected', note=?, processed_at=datetime('now')
            WHERE id=?
          `).run(clean(x.note) || null, wid);

          /* Rudisha commissions ziweze kuombwa tena */
          db.prepare(`
            UPDATE referral_commissions
            SET withdrawal_id=NULL
            WHERE withdrawal_id=? AND status='pending'
          `).run(wid);

        }

      });

    }catch(e){

      if(!e.statusCode) throw e;

      return json(res, e.statusCode, { error: e.message });

    }

    return json(res, 200, { ok:true });

  }


  /* =======================================================
     STOCK ANALYTICS (mtaji, mauzo, faida kwa bidhaa)
     ======================================================= */

  if(
    p === '/api/stock/analytics' &&
    m === 'GET'
  ){

    const u = owner(req, res);
    if(!u) return;

    if(u.role === 'super_admin'){
      return json(res, 403, { error:'Tumia akaunti ya biashara.' });
    }

    const daysRaw = Number(q(req).days);
    const days = [0,7,30,90,365].includes(daysRaw) ? daysRaw : 30;

    const items = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.quantity,
        p.min_stock,
        p.buy_price,
        p.sell_price,
        COALESCE(s.sold_qty,0) sold_qty,
        COALESCE(s.revenue,0) revenue,
        COALESCE(s.profit,0) profit,
        ls.last_sold_at

      FROM products p

      LEFT JOIN (
        SELECT
          product_id,
          SUM(quantity) sold_qty,
          SUM(total) revenue,
          SUM((sell_price-buy_price)*quantity-discount) profit
        FROM sales
        WHERE business_id=?
          AND (?=0 OR created_at>=datetime('now',?))
        GROUP BY product_id
      ) s ON s.product_id=p.id

      LEFT JOIN (
        SELECT product_id, MAX(created_at) last_sold_at
        FROM sales
        WHERE business_id=?
        GROUP BY product_id
      ) ls ON ls.product_id=p.id

      WHERE p.business_id=? AND p.active=1

      ORDER BY p.name
    `).all(
      u.business_id,
      days,
      `-${days} days`,
      u.business_id,
      u.business_id
    );

    let units = 0, capital = 0, retail = 0;

    for(const it of items){
      it.stock_cost = Number(it.quantity) * Number(it.buy_price);
      it.stock_value = Number(it.quantity) * Number(it.sell_price);
      units += Number(it.quantity);
      capital += it.stock_cost;
      retail += it.stock_value;
    }

    return json(res, 200, {
      days,
      totals:{
        products: items.length,
        units,
        capital,
        retailValue: retail,
        expectedProfit: retail - capital
      },
      items
    });

  }


  /* =======================================================
     SUPER ADMIN — REFERRAL COMMISSIONS
     ======================================================= */

  if(
    p === '/api/super/referral-commissions' &&
    m === 'GET'
  ){

    const u = auth(req, res, 'super_admin');
    if(!u) return;

    const rows = db.prepare(`
      SELECT rc.*, u.full_name referrer_name, u.email referrer_email,
             ru.full_name referred_user_name
      FROM referral_commissions rc
      LEFT JOIN users u ON u.id=rc.user_id
      LEFT JOIN users ru ON ru.id=rc.referred_user_id
      ORDER BY rc.created_at DESC LIMIT 500
    `).all();

    return json(res, 200, { commissions: rows });

  }


  let payCommissionId = p.match(/^\/api\/super\/referral-commissions\/(\d+)\/pay$/);
  if(payCommissionId && m === 'PUT'){

    const u = auth(req, res, 'super_admin');
    if(!u) return;

    db.prepare("UPDATE referral_commissions SET status='paid', paid_at=datetime('now') WHERE id=? AND withdrawal_id IS NULL")
      .run(Number(payCommissionId[1]));

    return json(res, 200, { ok:true });

  }


  /* =======================================================
     ME
     ======================================================= */

  if(
    p === '/api/me'
  ){

    const u =
      auth(
        req,
        res
      );


    if(!u)
      return;


    const myReferralCode =
      u.role === 'super_admin' ? null : ensureUserReferralCode(u.id);


    return json(
      res,
      200,
      {

        user:{
          ...u,
          referral_code: myReferralCode,
          referral_link: myReferralCode
            ? `${oauthBaseUrl()}/register.html?ref=${encodeURIComponent(myReferralCode)}`
            : null
        },

        business:
          u.role === 'super_admin'
            ? null
            :
              db.prepare(`
                SELECT
                  name,
                  code,
                  status,
                  location,
                  region,
                  district,
                  ward,
                  country,
                  business_phone
                FROM businesses
                WHERE id=?
              `)
              .get(
                u.business_id
              ),

        subscription:
          u.role === 'super_admin'
            ? null
            :
              subscriptionStatus(
                u.business_id
              )

      }
    );

  }


  /* =======================================================
     LOGOUT
     ======================================================= */

  if(
    p === '/api/logout'
  ){

    const mm =
      (
        req.headers.authorization || ''
      )
      .match(
        /^Bearer\s+(.+)$/i
      );


    if(mm){

      db.prepare(
        'DELETE FROM sessions WHERE token=?'
      )
      .run(
        mm[1]
      );

    }


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     OWNER DASHBOARD
     ======================================================= */

  if(
    p === '/api/dashboard' &&
    m === 'GET'
  ){

    return dashboard(
      req,
      res
    );

  }


  /* =======================================================
     PRODUCTS GET
     ======================================================= */

  if(
    p === '/api/products' &&
    m === 'GET'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    const rows =
      db.prepare(`
        SELECT
          p.*,
          c.name category_name

        FROM products p

        LEFT JOIN categories c
          ON c.id=p.category_id

        WHERE
          p.business_id=?
          AND p.active=1

        ORDER BY p.name
      `)
      .all(
        u.business_id
      );


    if(
      u.role === 'saler'
    ){

      rows.forEach(
        x => {
          delete x.buy_price;
        }
      );

    }


    return json(
      res,
      200,
      {
        products:rows
      }
    );

  }


  /* =======================================================
     PRODUCT PUT
     ======================================================= */

  if(
    p.startsWith('/api/products/') &&
    m === 'PUT'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const id =
      Number(
        p.split('/').pop()
      );


    const x =
      await body(req);


    const old =
      db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
        AND business_id=?
        AND active=1
      `)
      .get(
        id,
        u.business_id
      );


    if(!old){

      return json(
        res,
        404,
        {
          error:
            'Bidhaa haipo.'
        }
      );

    }


    const n =
      clean(x.name);


    const buy =
      Number(
        x.buyPrice
      );


    const sell =
      Number(
        x.sellPrice
      );


    const qty =
      Math.floor(
        Number(
          x.quantity
        )
      );


    const min =
      Math.floor(
        Number(
          x.minStock ??
          old.min_stock
        )
      );


    if(
      !n ||
      ![
        buy,
        sell,
        qty,
        min
      ].every(
        Number.isFinite
      ) ||
      buy < 0 ||
      sell < 0 ||
      qty < 0 ||
      min < 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Taarifa za bidhaa si sahihi.'
        }
      );

    }


    transaction(
      ()=>{

        db.prepare(`
          UPDATE products
          SET
            name=?,
            buy_price=?,
            sell_price=?,
            quantity=?,
            min_stock=?

          WHERE
            id=?
            AND business_id=?
        `)
        .run(
          n,
          buy,
          sell,
          qty,
          min,
          id,
          u.business_id
        );


        const diff =
          qty -
          old.quantity;


        if(diff){

          db.prepare(`
            INSERT INTO stock_movements
            (
              business_id,
              product_id,
              type,
              quantity,
              reference,
              created_by
            )
            VALUES(?,?,?,?,?,?)
          `)
          .run(
            u.business_id,
            id,
            'adjustment',
            diff,
            'Manual stock adjustment',
            u.id
          );

        }

      }
    );


    audit(
      u.business_id,
      u.id,
      'PRODUCT_UPDATE',
      n
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     PRODUCT POST
     ======================================================= */

  if(
    p === '/api/products' &&
    m === 'POST'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const x =
      await body(req);


    const n =
      clean(x.name);


    const buy =
      Number(
        x.buyPrice
      );


    const sell =
      Number(
        x.sellPrice
      );


    const qty =
      Number(
        x.quantity || 0
      );


    const min =
      Number(
        x.minStock ?? 5
      );


    if(
      !n ||
      ![
        buy,
        sell,
        qty,
        min
      ].every(
        Number.isFinite
      ) ||
      buy < 0 ||
      sell < 0 ||
      qty < 0 ||
      min < 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Taarifa za bidhaa si sahihi.'
        }
      );

    }


    const addedCapital = buy * qty;
    if(addedCapital > 0){
      const bizSub = subscriptionForBusiness(u.business_id);
      if(bizSub){
        const rules = tierRulesForPlan(bizSub);
        if(rules && rules.maxCapital !== null && rules.maxCapital >= 0){
          const currentCapital = currentBusinessCapital(u.business_id);
          if(currentCapital + addedCapital > rules.maxCapital){
            return json(res, 403, {
              error: `Umefikia kikomo cha mtaji (TSh ${rules.maxCapital.toLocaleString('en-US')}) kwa package ya sasa. Fanya upgrade ya subscription ili kuongeza mtaji zaidi.`
            });
          }
        }
      }
    }


    const r =
      db.prepare(`
        INSERT INTO products
        (
          business_id,
          name,
          buy_price,
          sell_price,
          quantity,
          min_stock,
          category_id
        )
        VALUES(?,?,?,?,?,?,?)
      `)
      .run(
        u.business_id,
        n,
        buy,
        sell,
        Math.floor(qty),
        Math.floor(min),
        x.categoryId
          ? Number(x.categoryId)
          : null
      );


    const id =
      Number(
        r.lastInsertRowid
      );


    if(qty > 0){

      db.prepare(`
        INSERT INTO stock_movements
        (
          business_id,
          product_id,
          type,
          quantity,
          reference,
          created_by
        )
        VALUES(?,?,?,?,?,?)
      `)
      .run(
        u.business_id,
        id,
        'opening',
        Math.floor(qty),
        'Opening stock',
        u.id
      );

    }


    audit(
      u.business_id,
      u.id,
      'PRODUCT_CREATE',
      n
    );


    return json(
      res,
      201,
      {
        product:{
          id
        }
      }
    );

  }


  /* =======================================================
     PRODUCT PATCH STYLE PUT
     ======================================================= */

  let mm =
    p.match(
      /^\/api\/products\/(\d+)$/
    );


  if(
    mm &&
    m === 'PUT'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const x =
      await body(req);


    const id =
      Number(
        mm[1]
      );


    const old =
      db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
        AND business_id=?
      `)
      .get(
        id,
        u.business_id
      );


    if(!old){

      return json(
        res,
        404,
        {
          error:
            'Bidhaa haipo.'
        }
      );

    }


    const n =
      clean(
        x.name ||
        old.name
      );


    const buy =
      Number(
        x.buyPrice ??
        old.buy_price
      );


    const sell =
      Number(
        x.sellPrice ??
        old.sell_price
      );


    const min =
      Number(
        x.minStock ??
        old.min_stock
      );


    if(
      !n ||
      ![
        buy,
        sell,
        min
      ].every(
        Number.isFinite
      ) ||
      buy < 0 ||
      sell < 0 ||
      min < 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Taarifa si sahihi.'
        }
      );

    }


    db.prepare(`
      UPDATE products

      SET
        name=?,
        buy_price=?,
        sell_price=?,
        min_stock=?,
        category_id=?

      WHERE
        id=?
        AND business_id=?
    `)
    .run(
      n,
      buy,
      sell,
      Math.floor(min),
      x.categoryId
        ? Number(x.categoryId)
        : old.category_id,
      id,
      u.business_id
    );


    audit(
      u.business_id,
      u.id,
      'PRODUCT_UPDATE',
      n
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     PRODUCT DELETE
     ======================================================= */

  if(
    mm &&
    m === 'DELETE'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    db.prepare(`
      UPDATE products
      SET active=0

      WHERE
        id=?
        AND business_id=?
    `)
    .run(
      Number(mm[1]),
      u.business_id
    );


    audit(
      u.business_id,
      u.id,
      'PRODUCT_ARCHIVE',
      String(mm[1])
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     CATEGORIES
     ======================================================= */

  if(
    p === '/api/categories' &&
    m === 'GET'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {
        categories:
          db.prepare(`
            SELECT *
            FROM categories
            WHERE business_id=?
            ORDER BY name
          `)
          .all(
            u.business_id
          )
      }
    );

  }


  if(
    p === '/api/categories' &&
    m === 'POST'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const n =
      clean(
        (
          await body(req)
        ).name
      );


    if(!n){

      return json(
        res,
        400,
        {
          error:
            'Jina la category linahitajika.'
        }
      );

    }


    try{

      const r =
        db.prepare(`
          INSERT INTO categories
          (
            business_id,
            name
          )
          VALUES(?,?)
        `)
        .run(
          u.business_id,
          n
        );


      return json(
        res,
        201,
        {
          id:
            Number(
              r.lastInsertRowid
            )
        }
      );

    }catch{

      return json(
        res,
        409,
        {
          error:
            'Category tayari ipo.'
        }
      );

    }

  }


  /* =======================================================
     CUSTOMERS
     ======================================================= */

  if(
    p === '/api/customers' &&
    m === 'GET'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {
        customers:
          db.prepare(`
            SELECT *
            FROM customers
            WHERE business_id=?
            ORDER BY name
          `)
          .all(
            u.business_id
          )
      }
    );

  }


  if(
    p === '/api/customers' &&
    m === 'POST'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    const x =
      await body(req);


    const n =
      clean(
        x.name
      );


    if(!n){

      return json(
        res,
        400,
        {
          error:
            'Jina linahitajika.'
        }
      );

    }


    const r =
      db.prepare(`
        INSERT INTO customers
        (
          business_id,
          name,
          phone,
          address
        )
        VALUES(?,?,?,?)
      `)
      .run(
        u.business_id,
        n,
        clean(x.phone)||null,
        clean(x.address)||null
      );


    return json(
      res,
      201,
      {
        id:
          Number(
            r.lastInsertRowid
          )
      }
    );

  }


  /* =======================================================
     SUPPLIERS
     ======================================================= */

  if(
    p === '/api/suppliers' &&
    m === 'GET'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {
        suppliers:
          db.prepare(`
            SELECT *
            FROM suppliers
            WHERE business_id=?
            ORDER BY name
          `)
          .all(
            u.business_id
          )
      }
    );

  }


  if(
    p === '/api/suppliers' &&
    m === 'POST'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const x =
      await body(req);


    const n =
      clean(x.name);


    if(!n){

      return json(
        res,
        400,
        {
          error:
            'Jina linahitajika.'
        }
      );

    }


    const r =
      db.prepare(`
        INSERT INTO suppliers
        (
          business_id,
          name,
          phone,
          address
        )
        VALUES(?,?,?,?)
      `)
      .run(
        u.business_id,
        n,
        clean(x.phone)||null,
        clean(x.address)||null
      );


    return json(
      res,
      201,
      {
        id:
          Number(
            r.lastInsertRowid
          )
      }
    );

  }


  /* =======================================================
     SALES GET
     ======================================================= */

  if(
    p === '/api/sales' &&
    m === 'GET'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    const sql =
      u.role === 'saler'

        ?

        `
          SELECT *
          FROM sales

          WHERE
            business_id=?
            AND sold_by=?
            AND COALESCE(voided,0)=0

          ORDER BY created_at DESC

          LIMIT 500
        `

        :

        `
          SELECT *
          FROM sales

          WHERE
            business_id=?
            AND COALESCE(voided,0)=0

          ORDER BY created_at DESC

          LIMIT 500
        `;


    const rows =
      u.role === 'saler'

        ?

        db.prepare(sql)
          .all(
            u.business_id,
            u.id
          )

        :

        db.prepare(sql)
          .all(
            u.business_id
          );


    return json(
      res,
      200,
      {
        sales:rows
      }
    );

  }


  /* =======================================================
     SALES POST
     ======================================================= */

  if(
    p === '/api/sales' &&
    m === 'POST'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    const x =
      await body(req);


    const pid =
      Number(
        x.productId
      );


    const qty =
      Math.floor(
        Number(
          x.quantity
        )
      );


    const discount =
      Number(
        x.discount || 0
      );


    const method =
      clean(
        x.paymentMethod ||
        'cash'
      )
      .toLowerCase();


    const cid =
      x.customerId
        ? Number(x.customerId)
        : null;


    const pdt =
      db.prepare(`
        SELECT *
        FROM products

        WHERE
          id=?
          AND business_id=?
          AND active=1
      `)
      .get(
        pid,
        u.business_id
      );


    if(
      !pdt ||
      !Number.isInteger(qty) ||
      qty <= 0 ||
      pdt.quantity < qty ||
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount >
        pdt.sell_price * qty
    ){

      return json(
        res,
        400,
        {
          error:
            'Bidhaa, quantity au discount si sahihi.'
        }
      );

    }


    if(
      ![
        'cash',
        'mobile',
        'bank',
        'credit'
      ].includes(method)
    ){

      return json(
        res,
        400,
        {
          error:
            'Payment method si sahihi.'
        }
      );

    }


    if(
      method === 'credit' &&
      !cid
    ){

      return json(
        res,
        400,
        {
          error:
            'Credit sale lazima iwe na customer.'
        }
      );

    }


    if(
      cid &&
      !db.prepare(`
        SELECT id
        FROM customers
        WHERE id=?
        AND business_id=?
      `)
      .get(
        cid,
        u.business_id
      )
    ){

      return json(
        res,
        400,
        {
          error:
            'Customer si wa biashara hii.'
        }
      );

    }


    const gross =
      pdt.sell_price *
      qty;


    const total =
      gross -
      discount;


    try{

      const r =
        transaction(
          ()=>{

            db.prepare(`
              UPDATE products

              SET quantity=quantity-?

              WHERE
                id=?
                AND business_id=?
                AND quantity>=?
            `)
            .run(
              qty,
              pid,
              u.business_id,
              qty
            );


            const z =
              db.prepare(`
                INSERT INTO sales
                (
                  business_id,
                  product_id,
                  product_name,
                  customer_id,
                  quantity,
                  sell_price,
                  buy_price,
                  discount,
                  total,
                  sold_by,
                  sold_by_name,
                  payment_method
                )
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
              `)
              .run(
                u.business_id,
                pid,
                pdt.name,
                cid,
                qty,
                pdt.sell_price,
                pdt.buy_price,
                discount,
                total,
                u.id,
                u.full_name,
                method
              );


            db.prepare(`
              INSERT INTO stock_movements
              (
                business_id,
                product_id,
                type,
                quantity,
                reference,
                created_by
              )
              VALUES(?,?,?,?,?,?)
            `)
            .run(
              u.business_id,
              pid,
              'sale',
              -qty,
              `Sale #${z.lastInsertRowid}`,
              u.id
            );


            if(
              method === 'credit'
            ){

              const customer =
                db.prepare(`
                  SELECT name
                  FROM customers
                  WHERE id=?
                `)
                .get(cid);


              db.prepare(`
                INSERT INTO debts
                (
                  business_id,
                  customer_id,
                  person_name,
                  description,
                  amount,
                  created_by,
                  created_by_name
                )
                VALUES(?,?,?,?,?,?,?)
              `)
              .run(
                u.business_id,
                cid,
                customer.name,
                `Sale #${z.lastInsertRowid}`,
                total,
                u.id,
                u.full_name
              );

            }


            return Number(
              z.lastInsertRowid
            );

          }
        );


      audit(
        u.business_id,
        u.id,
        'SALE',
        `Sale #${r}`
      );


      return json(
        res,
        201,
        {
          sale:{
            id:r,
            total
          }
        }
      );


    }catch(e){

      return json(
        res,
        400,
        {
          error:
            e.message
        }
      );

    }

  }


  /* =======================================================
     VOID SALE
     ======================================================= */

  if(
    p.startsWith('/api/sales/') &&
    p.endsWith('/void') &&
    m === 'POST'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const id =
      Number(
        p.split('/')[3]
      );


    const x =
      await body(req);


    const s =
      db.prepare(`
        SELECT *
        FROM sales

        WHERE
          id=?
          AND business_id=?
          AND COALESCE(voided,0)=0
      `)
      .get(
        id,
        u.business_id
      );


    if(!s){

      return json(
        res,
        404,
        {
          error:
            'Sale haipo au tayari ime-undo.'
        }
      );

    }


    const ret =
      db.prepare(`
        SELECT
          COALESCE(
            SUM(quantity),
            0
          ) q

        FROM sale_returns

        WHERE sale_id=?
      `)
      .get(id)
      .q;


    if(
      Number(ret) > 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Sale yenye return haiwezi ku-undo.'
        }
      );

    }


    transaction(
      ()=>{

        db.prepare(`
          UPDATE products
          SET quantity=quantity+?

          WHERE
            id=?
            AND business_id=?
        `)
        .run(
          s.quantity,
          s.product_id,
          u.business_id
        );


        db.prepare(`
          INSERT INTO stock_movements
          (
            business_id,
            product_id,
            type,
            quantity,
            reference,
            created_by
          )
          VALUES(?,?,?,?,?,?)
        `)
        .run(
          u.business_id,
          s.product_id,
          'void',
          s.quantity,
          `Void sale #${id}`,
          u.id
        );


        db.prepare(`
          UPDATE sales

          SET
            voided=1,
            void_reason=?,
            voided_at=datetime('now'),
            voided_by=?

          WHERE
            id=?
            AND business_id=?
        `)
        .run(
          clean(x.reason) ||
            'Wrong sale',
          u.id,
          id,
          u.business_id
        );


        db.prepare(`
          UPDATE debts

          SET status='voided'

          WHERE
            business_id=?
            AND description=?
            AND paid=0
        `)
        .run(
          u.business_id,
          `Sale #${id}`
        );

      }
    );


    audit(
      u.business_id,
      u.id,
      'SALE_VOID',
      `Sale #${id}`
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     PURCHASES
     ======================================================= */

  if(
    p === '/api/purchases' &&
    m === 'GET'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    return json(
      res,
      200,
      {
        purchases:
          db.prepare(`
            SELECT
              p.*,
              s.name supplier_name

            FROM purchases p

            LEFT JOIN suppliers s
              ON s.id=p.supplier_id

            WHERE
              p.business_id=?

            ORDER BY
              p.created_at DESC

            LIMIT 500
          `)
          .all(
            u.business_id
          )
      }
    );

  }


  if(
    p === '/api/purchases' &&
    m === 'POST'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const x =
      await body(req);


    const items =
      Array.isArray(x.items)
        ? x.items
        : [];


    if(
      !items.length
    ){

      return json(
        res,
        400,
        {
          error:
            'Purchase items zinahitajika.'
        }
      );

    }


    {
      let plannedAddedCapital = 0;
      for(const i of items){
        const q = Math.floor(Number(i.quantity)) || 0;
        const bp = Number(i.buyPrice) || 0;
        if(q > 0 && bp > 0) plannedAddedCapital += q * bp;
      }
      if(plannedAddedCapital > 0){
        const bizSub = subscriptionForBusiness(u.business_id);
        if(bizSub){
          const rules = tierRulesForPlan(bizSub);
          if(rules && rules.maxCapital !== null && rules.maxCapital >= 0){
            const currentCapital = currentBusinessCapital(u.business_id);
            if(currentCapital + plannedAddedCapital > rules.maxCapital){
              return json(res, 403, {
                error: `Purchase hii itavuka kikomo cha mtaji (TSh ${rules.maxCapital.toLocaleString('en-US')}) kwa package ya sasa. Fanya upgrade ya subscription.`
              });
            }
          }
        }
      }
    }


    try{

      const result =
        transaction(
          ()=>{

            let total=0;


            for(
              const i of items
            ){

              const pid =
                Number(
                  i.productId
                );


              const qty =
                Math.floor(
                  Number(
                    i.quantity
                  )
                );


              const bp =
                Number(
                  i.buyPrice
                );


              const pdt =
                db.prepare(`
                  SELECT id
                  FROM products

                  WHERE
                    id=?
                    AND business_id=?
                    AND active=1
                `)
                .get(
                  pid,
                  u.business_id
                );


              if(
                !pdt ||
                qty <= 0 ||
                !Number.isFinite(bp) ||
                bp < 0
              ){

                throw Error(
                  'Purchase item si sahihi.'
                );

              }


              total +=
                qty * bp;

            }


            const r =
              db.prepare(`
                INSERT INTO purchases
                (
                  business_id,
                  supplier_id,
                  invoice_no,
                  total,
                  created_by
                )
                VALUES(?,?,?,?,?)
              `)
              .run(
                u.business_id,
                x.supplierId
                  ? Number(x.supplierId)
                  : null,
                clean(x.invoiceNo)||null,
                total,
                u.id
              );


            const purchaseId =
              Number(
                r.lastInsertRowid
              );


            for(
              const i of items
            ){

              const pid =
                Number(
                  i.productId
                );


              const qty =
                Math.floor(
                  Number(
                    i.quantity
                  )
                );


              const bp =
                Number(
                  i.buyPrice
                );


              db.prepare(`
                INSERT INTO purchase_items
                (
                  purchase_id,
                  product_id,
                  quantity,
                  buy_price,
                  total
                )
                VALUES(?,?,?,?,?)
              `)
              .run(
                purchaseId,
                pid,
                qty,
                bp,
                qty*bp
              );


              db.prepare(`
                UPDATE products

                SET
                  quantity=quantity+?,
                  buy_price=?

                WHERE
                  id=?
                  AND business_id=?
              `)
              .run(
                qty,
                bp,
                pid,
                u.business_id
              );


              db.prepare(`
                INSERT INTO stock_movements
                (
                  business_id,
                  product_id,
                  type,
                  quantity,
                  reference,
                  created_by
                )
                VALUES(?,?,?,?,?,?)
              `)
              .run(
                u.business_id,
                pid,
                'purchase',
                qty,
                `Purchase #${purchaseId}`,
                u.id
              );

            }


            return purchaseId;

          }
        );


      audit(
        u.business_id,
        u.id,
        'PURCHASE',
        `Purchase #${result}`
      );


      return json(
        res,
        201,
        {
          id:result
        }
      );


    }catch(e){

      return json(
        res,
        400,
        {
          error:
            e.message
        }
      );

    }

  }


  /* =======================================================
     EXPENSES
     ======================================================= */

  if(
    p === '/api/expenses' &&
    m === 'GET'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {
        expenses:
          u.role === 'saler'

            ?

            db.prepare(`
              SELECT *
              FROM expenses

              WHERE
                business_id=?
                AND created_by=?

              ORDER BY
                created_at DESC

              LIMIT 500
            `)
            .all(
              u.business_id,
              u.id
            )

            :

            db.prepare(`
              SELECT *
              FROM expenses

              WHERE business_id=?

              ORDER BY
                created_at DESC

              LIMIT 500
            `)
            .all(
              u.business_id
            )

      }
    );

  }


  if(
    p === '/api/expenses' &&
    m === 'POST'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    const x =
      await body(req);


    const desc =
      clean(
        x.description
      );


    const amt =
      Number(
        x.amount
      );


    if(
      !desc ||
      !Number.isFinite(amt) ||
      amt <= 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Maelezo na kiasi sahihi vinahitajika.'
        }
      );

    }


    db.prepare(`
      INSERT INTO expenses
      (
        business_id,
        description,
        category,
        amount,
        created_by,
        created_by_name
      )
      VALUES(?,?,?,?,?,?)
    `)
    .run(
      u.business_id,
      desc,
      clean(x.category)||null,
      amt,
      u.id,
      u.full_name
    );


    audit(
      u.business_id,
      u.id,
      'EXPENSE',
      desc
    );


    return json(
      res,
      201,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     DEBTS GET
     ======================================================= */

  if(
    p === '/api/debts' &&
    m === 'GET'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {

        debts:

          u.role === 'saler'

            ?

            db.prepare(`
              SELECT
                d.*,
                c.name customer_name

              FROM debts d

              LEFT JOIN customers c
                ON c.id=d.customer_id

              WHERE
                d.business_id=?
                AND d.created_by=?

              ORDER BY
                d.created_at DESC

              LIMIT 500
            `)
            .all(
              u.business_id,
              u.id
            )

            :

            db.prepare(`
              SELECT
                d.*,
                c.name customer_name

              FROM debts d

              LEFT JOIN customers c
                ON c.id=d.customer_id

              WHERE
                d.business_id=?

              ORDER BY
                d.created_at DESC

              LIMIT 500
            `)
            .all(
              u.business_id
            )

      }
    );

  }


  /* =======================================================
     DEBT POST
     ======================================================= */

  if(
    p === '/api/debts' &&
    m === 'POST'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    const x =
      await body(req);


    const amt =
      Number(
        x.amount
      );


    const n =
      clean(
        x.personName
      );


    if(
      !n ||
      !Number.isFinite(amt) ||
      amt <= 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Jina na kiasi sahihi vinahitajika.'
        }
      );

    }


    db.prepare(`
      INSERT INTO debts
      (
        business_id,
        customer_id,
        person_name,
        description,
        amount,
        due_date,
        created_by,
        created_by_name
      )
      VALUES(?,?,?,?,?,?,?,?)
    `)
    .run(
      u.business_id,
      x.customerId
        ? Number(x.customerId)
        : null,
      n,
      clean(x.description)||null,
      amt,
      clean(x.dueDate)||null,
      u.id,
      u.full_name
    );


    audit(
      u.business_id,
      u.id,
      'DEBT_CREATE',
      n
    );


    return json(
      res,
      201,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     DEBT PAYMENT
     ======================================================= */

  mm =
    p.match(
      /^\/api\/debts\/(\d+)\/payments$/
    );


  if(
    mm &&
    m === 'POST'
  ){

    const u =
      bizOnly(
        req,
        res
      );


    if(!u)
      return;


    const id =
      Number(
        mm[1]
      );


    const amt =
      Number(
        (
          await body(req)
        ).amount
      );


    const d =
      db.prepare(`
        SELECT *
        FROM debts

        WHERE
          id=?
          AND business_id=?
      `)
      .get(
        id,
        u.business_id
      );


    if(
      !d ||
      !Number.isFinite(amt) ||
      amt <= 0 ||
      amt >
        d.amount-d.paid
    ){

      return json(
        res,
        400,
        {
          error:
            'Malipo si sahihi.'
        }
      );

    }


    transaction(
      ()=>{

        db.prepare(`
          INSERT INTO debt_payments
          (
            debt_id,
            amount,
            paid_by
          )
          VALUES(?,?,?)
        `)
        .run(
          id,
          amt,
          u.id
        );


        const paid =
          d.paid +
          amt;


        db.prepare(`
          UPDATE debts

          SET
            paid=?,
            status=?

          WHERE
            id=?
            AND business_id=?
        `)
        .run(
          paid,
          paid >= d.amount
            ? 'paid'
            : 'unpaid',
          id,
          u.business_id
        );

      }
    );


    audit(
      u.business_id,
      u.id,
      'DEBT_PAYMENT',
      `Debt #${id}: ${amt}`
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     STOCK MOVEMENTS
     ======================================================= */

  if(
    p === '/api/stock-movements' &&
    m === 'GET'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    return json(
      res,
      200,
      {

        movements:
          db.prepare(`
            SELECT
              sm.*,
              p.name product_name,
              u.full_name user_name

            FROM stock_movements sm

            LEFT JOIN products p
              ON p.id=sm.product_id

            LEFT JOIN users u
              ON u.id=sm.created_by

            WHERE
              sm.business_id=?

            ORDER BY
              sm.created_at DESC

            LIMIT 1000
          `)
          .all(
            u.business_id
          )

      }
    );

  }


  /* =======================================================
     RETURNS
     ======================================================= */

  if(
    p === '/api/returns' &&
    m === 'POST'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const x =
      await body(req);


    const sid =
      Number(
        x.saleId
      );


    const qty =
      Math.floor(
        Number(
          x.quantity
        )
      );


    const s =
      db.prepare(`
        SELECT *
        FROM sales

        WHERE
          id=?
          AND business_id=?
      `)
      .get(
        sid,
        u.business_id
      );


    if(
      !s ||
      qty <= 0 ||
      qty > s.quantity
    ){

      return json(
        res,
        400,
        {
          error:
            'Return si sahihi.'
        }
      );

    }


    const returned =
      db.prepare(`
        SELECT
          COALESCE(
            SUM(quantity),
            0
          ) q

        FROM sale_returns

        WHERE sale_id=?
      `)
      .get(sid)
      .q;


    if(
      qty + returned >
      s.quantity
    ){

      return json(
        res,
        400,
        {
          error:
            'Quantity ya return imezidi sale.'
        }
      );

    }


    transaction(
      ()=>{

        db.prepare(`
          INSERT INTO sale_returns
          (
            business_id,
            sale_id,
            product_id,
            quantity,
            amount,
            reason,
            created_by
          )
          VALUES(?,?,?,?,?,?,?)
        `)
        .run(
          u.business_id,
          sid,
          s.product_id,
          qty,
          s.sell_price * qty,
          clean(x.reason)||null,
          u.id
        );


        db.prepare(`
          UPDATE products
          SET quantity=quantity+?

          WHERE
            id=?
            AND business_id=?
        `)
        .run(
          qty,
          s.product_id,
          u.business_id
        );


        db.prepare(`
          INSERT INTO stock_movements
          (
            business_id,
            product_id,
            type,
            quantity,
            reference,
            created_by
          )
          VALUES(?,?,?,?,?,?)
        `)
        .run(
          u.business_id,
          s.product_id,
          'return',
          qty,
          `Return sale #${sid}`,
          u.id
        );

      }
    );


    return json(
      res,
      201,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     EMPLOYEES
     ======================================================= */

  if(
    p === '/api/employees' &&
    m === 'GET'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    return json(
      res,
      200,
      {

        employees:
          db.prepare(`
            SELECT
              id,
              full_name,
              phone,
              email,
              role,
              active,
              created_at

            FROM users

            WHERE
              business_id=?
              AND role!='owner'

            ORDER BY full_name
          `)
          .all(
            u.business_id
          )

      }
    );

  }


  if(
    p === '/api/employees' &&
    m === 'POST'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const x =
      await body(req);


    const n =
      clean(
        x.fullName
      );


    const e =
      email(
        x.email
      );


    const pw =
      String(
        x.password || ''
      );


    const role =
      x.role === 'manager'
        ? 'manager'
        : 'saler';


    if(
      !n ||
      !validEmail(e) ||
      pw.length < 10
    ){

      return json(
        res,
        400,
        {
          error:
            'Jina, email na password ya angalau 10 vinahitajika.'
        }
      );

    }


    if(
      db.prepare(
        'SELECT id FROM users WHERE email=?'
      )
      .get(e)
    ){

      return json(
        res,
        409,
        {
          error:
            'Email tayari ipo.'
        }
      );

    }


    const r =
      db.prepare(`
        INSERT INTO users
        (
          full_name,
          phone,
          business_id,
          email,
          password_hash,
          role
        )
        VALUES(?,?,?,?,?,?)
      `)
      .run(
        n,
        clean(x.phone),
        u.business_id,
        e,
        hash(pw),
        role
      );


    audit(
      u.business_id,
      u.id,
      'EMPLOYEE_CREATE',
      `${n} (${role})`
    );


    return json(
      res,
      201,
      {
        id:
          Number(
            r.lastInsertRowid
          )
      }
    );

  }


  /* =======================================================
     EMPLOYEE TOGGLE
     ======================================================= */

  mm =
    p.match(
      /^\/api\/employees\/(\d+)\/toggle$/
    );


  if(
    mm &&
    m === 'PATCH'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const id =
      Number(
        mm[1]
      );


    const emp =
      db.prepare(`
        SELECT active
        FROM users

        WHERE
          id=?
          AND business_id=?
          AND role!='owner'
      `)
      .get(
        id,
        u.business_id
      );


    if(!emp){

      return json(
        res,
        404,
        {
          error:
            'Employee haipo.'
        }
      );

    }


    db.prepare(`
      UPDATE users

      SET active=?

      WHERE
        id=?
        AND business_id=?
    `)
    .run(
      emp.active
        ? 0
        : 1,
      id,
      u.business_id
    );


    audit(
      u.business_id,
      u.id,
      'EMPLOYEE_TOGGLE',
      `Employee #${id}: ${
        emp.active
          ? 'disabled'
          : 'enabled'
      }`
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     AUDIT
     ======================================================= */

  if(
    p === '/api/audit' &&
    m === 'GET'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    return json(
      res,
      200,
      {

        logs:
          db.prepare(`
            SELECT *
            FROM audit_logs

            WHERE
              business_id=?

            ORDER BY
              created_at DESC

            LIMIT 500
          `)
          .all(
            u.business_id
          )

      }
    );

  }


  /* =======================================================
     REPORTS
     ======================================================= */

  if(
    p === '/api/reports' &&
    m === 'GET'
  ){

    const u =
      owner(
        req,
        res
      );


    if(
      !u ||
      u.role === 'super_admin'
    )
      return;


    const [f,t] =
      range(
        q(req)
      );


    const sales =
      db.prepare(`
        SELECT *
        FROM sales

        WHERE
          business_id=?
          AND created_at BETWEEN ? AND ?
          AND COALESCE(voided,0)=0

        ORDER BY created_at
      `)
      .all(
        u.business_id,
        f,
        t
      );


    const expenses =
      db.prepare(`
        SELECT *
        FROM expenses

        WHERE
          business_id=?
          AND created_at BETWEEN ? AND ?

        ORDER BY created_at
      `)
      .all(
        u.business_id,
        f,
        t
      );


    const revenue =
      sales.reduce(
        (a,x)=>
          a +
          x.total,
        0
      );


    const gross =
      sales.reduce(
        (a,x)=>
          a +
          (
            x.sell_price -
            x.buy_price
          ) *
          x.quantity -
          x.discount,
        0
      );


    const exp =
      expenses.reduce(
        (a,x)=>
          a +
          x.amount,
        0
      );


    return json(
      res,
      200,
      {

        from:f,

        to:t,

        sales,

        expenses,

        summary:{

          revenue,

          grossProfit:
            gross,

          expenses:
            exp,

          profit:
            gross-exp,

          margin:
            revenue
              ? (
                  (
                    gross-exp
                  ) /
                  revenue *
                  100
                )
              : 0

        }

      }
    );

  }


  /* =======================================================
     SUPER ADMIN BUSINESSES
     ======================================================= */

  if(
    p === '/api/super/businesses'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {

        businesses:
          db.prepare(`
            SELECT
              b.*,
              u.full_name owner,

              (
                SELECT COUNT(*)
                FROM users x
                WHERE x.business_id=b.id
              ) users,

              (
                SELECT COUNT(*)
                FROM sales s
                WHERE s.business_id=b.id
              ) sales,

              (
                SELECT
                  COALESCE(
                    SUM(s.total),
                    0
                  )

                FROM sales s
                WHERE s.business_id=b.id
              ) revenue

            FROM businesses b

            LEFT JOIN users u
              ON u.id=b.owner_id

            ORDER BY
              b.created_at DESC
          `)
          .all()

      }
    );

  }


  /* =======================================================
     SUPER ADMIN USERS
     ======================================================= */

  if(
    p === '/api/super/users'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {

        users:
          db.prepare(`
            SELECT
              u.id,
              u.full_name,
              u.email,
              u.phone,
              u.role,
              u.active,
              u.created_at,
              b.name business_name,
              b.status

            FROM users u

            LEFT JOIN businesses b
              ON b.id=u.business_id

            WHERE
              u.role!='super_admin'

            ORDER BY
              u.created_at DESC
          `)
          .all()

      }
    );

  }


  /* =======================================================
     SUPER ADMIN — DELETE USER ACCOUNT (PERMANENT)
     ======================================================= */

  let deleteUserId = p.match(/^\/api\/super\/users\/(\d+)$/);
  if(deleteUserId && m === 'DELETE'){

    const u = auth(req, res, 'super_admin');
    if(!u) return;

    const targetId = Number(deleteUserId[1]);

    const target = db.prepare('SELECT id,role,email FROM users WHERE id=?').get(targetId);
    if(!target) return json(res, 404, { error: 'Mtumiaji hakupatikana.' });
    if(target.role === 'super_admin') return json(res, 400, { error: 'Huwezi kufuta akaunti ya Super Admin.' });
    if(target.id === u.id) return json(res, 400, { error: 'Huwezi kufuta akaunti yako mwenyewe.' });

    const del = db.transaction((id) => {
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM oauth_identities WHERE user_id=?').run(id);
      db.prepare('DELETE FROM referral_commissions WHERE user_id=? OR referred_user_id=?').run(id, id);
      db.prepare('DELETE FROM referrals WHERE user_id=? OR referrer_id=?').run(id, id);
      db.prepare('UPDATE users SET referred_by_user_id=NULL WHERE referred_by_user_id=?').run(id);
      db.prepare('DELETE FROM users WHERE id=?').run(id);
    });

    try{
      del(targetId);
    }catch(e){
      return json(res, 500, { error: 'Imeshindikana kufuta akaunti: ' + e.message });
    }

    return json(res, 200, { ok: true, deleted_id: targetId, deleted_email: target.email });

  }


  /* =======================================================
     SUPER ADMIN — REFERRAL LEADERBOARD
     ======================================================= */

  if(
    p === '/api/super/referral-leaderboard' &&
    m === 'GET'
  ){

    const u = auth(req, res, 'super_admin');
    if(!u) return;

    const rows = db.prepare(`
      SELECT
        r.full_name,
        r.email,
        r.role,
        r.active,
        COUNT(DISTINCT ref.user_id) direct_count,
        COALESCE(SUM(CASE WHEN rc.status='paid' THEN rc.amount_tzs ELSE 0 END),0) paid_earnings,
        COALESCE(SUM(CASE WHEN rc.status='pending' THEN rc.amount_tzs ELSE 0 END),0) pending_earnings,
        COALESCE(SUM(rc.amount_tzs),0) total_earnings
      FROM users r
      LEFT JOIN referrals ref ON ref.referrer_id=r.id AND ref.level=1
      LEFT JOIN referral_commissions rc ON rc.user_id=r.id
      WHERE r.role!='super_admin' AND r.referral_code IS NOT NULL
      GROUP BY r.id
      HAVING direct_count>0 OR total_earnings>0
      ORDER BY direct_count DESC, total_earnings DESC
      LIMIT 100
    `).all();

    return json(res, 200, {
      leaderboard: rows.map((row, i) => ({ rank: i + 1, ...row }))
    });

  }


  /* =======================================================
     SUPER ADMIN PERFORMANCE
     ======================================================= */

  if(
    p === '/api/super/performance'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    return json(
      res,
      200,
      {

        performance:
          db.prepare(`
            SELECT
              b.id,
              b.name,
              b.status,

              COUNT(s.id) sales,

              COALESCE(
                SUM(s.total),
                0
              ) revenue,

              COALESCE(
                SUM(
                  (
                    s.sell_price -
                    s.buy_price
                  ) *
                  s.quantity -
                  s.discount
                ),
                0
              ) gross_profit,

              (
                SELECT
                  COALESCE(
                    SUM(amount),
                    0
                  )

                FROM expenses e

                WHERE
                  e.business_id=b.id
              ) expenses

            FROM businesses b

            LEFT JOIN sales s
              ON s.business_id=b.id

            GROUP BY b.id

            ORDER BY revenue DESC
          `)
          .all()

      }
    );

  }


  /* =======================================================
     SUPER ADMIN SUSPEND / ACTIVATE
     ======================================================= */

  mm =
    p.match(
      /^\/api\/super\/businesses\/(\d+)\/(suspend|activate)$/
    );


  if(
    mm &&
    m === 'PUT'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    db.prepare(`
      UPDATE businesses

      SET status=?

      WHERE id=?
    `)
    .run(
      mm[2] === 'suspend'
        ? 'suspended'
        : 'active',
      Number(mm[1])
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     PUBLIC PLANS (landing page — bila login, hakuna data nyeti)
     ======================================================= */

  if(
    p === '/api/public/plans' &&
    m === 'GET'
  ){

    const rows =
      db.prepare(`
        SELECT *
        FROM subscription_plans

        WHERE
          active=1
          AND min_capital_tzs IS NOT NULL

        ORDER BY
          final_price_tzs ASC,
          id ASC
      `)
      .all();


    return json(
      res,
      200,
      {

        plans:
          rows.map(
            x => ({

              code:
                x.code,

              name:
                x.name,

              price_tzs:
                effectivePlanPrice(x),

              regular_price_tzs:
                x.regular_price_tzs,

              duration_days:
                x.duration_days,

              min_capital_tzs:
                x.min_capital_tzs,

              max_capital_tzs:
                x.max_capital_tzs,

              max_workers:
                x.max_workers,

              features:
                parseFeatures(
                  x.features_json
                )

            })
          )

      }
    );

  }


  /* =======================================================
     SUBSCRIPTION PLANS
     ======================================================= */

  if(
    p === '/api/subscription/plans' &&
    m === 'GET'
  ){

    const u =
      auth(
        req,
        res,
        ['owner','saler']
      );


    if(!u)
      return;


    const rows =
      db.prepare(`
        SELECT *
        FROM subscription_plans

        WHERE active=1

        ORDER BY id
      `)
      .all();


    return json(
      res,
      200,
      {

        plans:
          rows.map(
            x => ({

              ...x,

              current_price_tzs:
                effectivePlanPrice(x),

              features:
                parseFeatures(
                  x.features_json
                )

            })
          )

      }
    );

  }


  /* =======================================================
     CURRENT SUBSCRIPTION
     ======================================================= */

  if(
    p === '/api/subscription/current' &&
    m === 'GET'
  ){

    const u =
      auth(
        req,
        res,
        ['owner','saler']
      );


    if(!u)
      return;


    expireStalePayments(u.business_id);


    const pendingPayment =
      db.prepare(`
        SELECT
          id,
          order_id,
          amount_tzs,
          created_at

        FROM subscription_payments

        WHERE
          business_id=?
          AND status='PENDING'

        ORDER BY id DESC
        LIMIT 1
      `)
      .get(
        u.business_id
      ) || null;


    return json(
      res,
      200,
      {
        ...subscriptionStatus(
          u.business_id
        ),

        pendingPayment
      }
    );

  }


  /* =======================================================
     CREATE SUBSCRIPTION PAYMENT
     ======================================================= */

  if(
    p === '/api/subscription/create-payment' &&
    m === 'POST'
  ){

    const u =
      auth(
        req,
        res,
        'owner'
      );


    if(!u)
      return;


    if(
      !rate(
        req,
        'subscription'
      )
    ){

      return json(
        res,
        429,
        {
          error:
            'Majaribio mengi. Sububiri kidogo.'
        }
      );

    }


    const x =
      await body(req);


    expireStalePayments(u.business_id);


    /* Jaribio jipya linachukua nafasi ya PENDING zilizobaki (zisimzuie mtumiaji) */
    db.prepare(`
      UPDATE subscription_payments
      SET status='CANCELLED', failure_reason='Imebadilishwa na jaribio jipya.', updated_at=datetime('now')
      WHERE business_id=? AND status='PENDING'
    `).run(u.business_id);


    const code =
      clean(
        x.planCode ||
        'business'
      )
      .toLowerCase();


    let phone;


    try{

      phone =
        normalizePhone(
          x.phone
        );

    }catch(e){

      return json(
        res,
        400,
        {
          error:
            e.message
        }
      );

    }


    const plan =
      db.prepare(`
        SELECT *
        FROM subscription_plans

        WHERE
          code=?
          AND active=1
      `)
      .get(code);


    if(!plan){

      return json(
        res,
        404,
        {
          error:
            'Subscription plan haipatikani.'
        }
      );

    }


    const amount =
      effectivePlanPrice(
        plan
      );


    if(
      !Number.isInteger(amount) ||
      amount <= 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Bei ya subscription si sahihi.'
        }
      );

    }


    const biz =
      db.prepare(
        'SELECT * FROM businesses WHERE id=?'
      )
      .get(
        u.business_id
      );


    const tx =
      makeSubscriptionTransactionId(
        u.business_id
      );


    const r =
      db.prepare(`
        INSERT INTO subscription_payments
        (
          business_id,
          plan_id,
          phone,
          amount_tzs,
          provider,
          transaction_id,
          status
        )
        VALUES(?,?,?,?,?,?,'PENDING')
      `)
      .run(
        u.business_id,
        plan.id,
        phone,
        amount,
        'palmpesa',
        tx
      );


    const paymentId =
      Number(
        r.lastInsertRowid
      );


    try{

      const c =
        subscriptionConfig();


      const payload = {

        name:
          u.full_name,

        email:
          u.email,

        phone,

        amount,

        transaction_id:
          tx,

        address:
          clean(
            biz?.location
          ) ||
          'Tanzania',

        postcode:
          '00000',

        callback_url:
          c.callbackUrl

      };


      if(c.userId)
        payload.user_id =
          c.userId;


      const d =
        await palmPesaRequest(
          '/api/palmpesa/initiate',
          payload
        );


      const orderId =
        d?.order_id ||
        d?.data?.order_id ||
        d?.orderId;


      if(!orderId){

        throw Error(
          'PalmPesa haikurudisha order_id.'
        );

      }


      db.prepare(`
        UPDATE subscription_payments

        SET
          order_id=?,
          updated_at=datetime('now')

        WHERE id=?
      `)
      .run(
        String(orderId),
        paymentId
      );


      return json(
        res,
        200,
        {

          status:
            'PENDING',

          paymentId,

          order_id:
            String(orderId),

          transaction_id:
            tx,

          amount_tzs:
            amount,

          message:
            'Payment request imetumwa. Thibitisha kwenye simu yako.'

        }
      );


    }catch(e){

      db.prepare(`
        UPDATE subscription_payments

        SET
          status='FAILED',
          failure_reason=?,
          updated_at=datetime('now')

        WHERE id=?
      `)
      .run(
        e.message,
        paymentId
      );


      return json(
        res,
        e.statusCode === 503
          ? 503
          : 502,
        {
          status:
            'FAILED',

          error:
            e.message,

          paymentId
        }
      );

    }

  }


  /* =======================================================
     SUBSCRIPTION WEBHOOK
     ======================================================= */

  if(
    p === '/api/subscription/webhook' &&
    m === 'POST'
  ){

    const x =
      await body(req);


    const orderId =
      clean(
        x.order_id ||
        x.orderId ||
        x.data?.order_id
      );


    const st =
      String(
        x.payment_status ||
        x.status ||
        x.data?.payment_status ||
        ''
      )
      .toUpperCase();


    if(!orderId){

      return json(
        res,
        400,
        {
          error:
            'order_id inahitajika.'
        }
      );

    }


    const pay =
      db.prepare(`
        SELECT *
        FROM subscription_payments

        WHERE order_id=?
      `)
      .get(
        orderId
      );


    if(!pay){

      return json(
        res,
        404,
        {
          error:
            'Subscription payment haijapatikana.'
        }
      );

    }


    if(
      st === 'COMPLETED' ||
      st === 'SUCCESSFUL'
    ){

      const sub =
        activateSubscription(
          pay
        );


      audit(
        pay.business_id,
        null,
        'SUBSCRIPTION_PAYMENT_SUCCESS',
        `Order ${orderId}; TSh ${pay.amount_tzs}`
      );


      return json(
        res,
        200,
        {

          ok:true,

          status:
            'SUCCESSFUL',

          subscription:
            sub

        }
      );

    }


    if(
      st === 'FAILED'
    ){

      db.prepare(`
        UPDATE subscription_payments

        SET
          status='FAILED',
          failure_reason=?,
          updated_at=datetime('now')

        WHERE id=?
      `)
      .run(
        clean(
          x.failure_reason ||
          x.message
        ) ||
        'PalmPesa payment failed',
        pay.id
      );


      return json(
        res,
        200,
        {
          ok:true,
          status:'FAILED'
        }
      );

    }


    return json(
      res,
      200,
      {
        ok:true,
        status:'PENDING'
      }
    );

  }


  /* =======================================================
     CHECK SUBSCRIPTION PAYMENT STATUS
     ======================================================= */

  if(
    p === '/api/subscription/check-status' &&
    m === 'POST'
  ){

    const u =
      auth(
        req,
        res,
        'owner'
      );


    if(!u)
      return;


    const x =
      await body(req);


    const orderId =
      clean(
        x.orderId ||
        x.order_id
      );


    if(!orderId){

      return json(
        res,
        400,
        {
          status:'FAILED',
          error:'order_id inahitajika.'
        }
      );

    }


    expireStalePayments(u.business_id);


    const pay =
      db.prepare(`
        SELECT *
        FROM subscription_payments

        WHERE
          order_id=?
          AND business_id=?
      `)
      .get(
        orderId,
        u.business_id
      );


    if(!pay){

      return json(
        res,
        404,
        {
          status:'FAILED',
          error:
            'Payment haipatikani.'
        }
      );

    }


    /* Hali ya mwisho (terminal): usirudishe PENDING, client ikome ku-poll */
    if(
      pay.status === 'FAILED' ||
      pay.status === 'CANCELLED'
    ){

      return json(
        res,
        200,
        {
          status:'FAILED',
          terminal:true,
          error:
            pay.failure_reason ||
            'Malipo hayakukamilika. Jaribu tena.',
          paymentId:pay.id
        }
      );

    }


    const isExpired =
      pay.status === 'EXPIRED';


    if(
      pay.status === 'SUCCESSFUL'
    ){

      return json(
        res,
        200,
        {

          status:
            'SUCCESSFUL',

          subscription:
            subscriptionStatus(
              u.business_id
            ).subscription

        }
      );

    }


    try{

      const d =
        await palmPesaRequest(
          '/api/order-status',
          {
            order_id:
              orderId
          }
        );


      const st =
        String(
          d?.data?.[0]?.payment_status ||
          d?.payment_status ||
          d?.status ||
          'PENDING'
        )
        .toUpperCase();


      if(
        st === 'COMPLETED' ||
        st === 'SUCCESSFUL'
      ){

        const sub =
          activateSubscription(
            pay
          );


        audit(
          u.business_id,
          u.id,
          'SUBSCRIPTION_PAYMENT_SUCCESS',
          `Order ${orderId}; TSh ${pay.amount_tzs}`
        );


        return json(
          res,
          200,
          {

            status:
              'SUCCESSFUL',

            subscription:
              sub

          }
        );

      }


      if(
        st === 'FAILED'
      ){

        db.prepare(`
          UPDATE subscription_payments

          SET
            status='FAILED',
            failure_reason=?,
            updated_at=datetime('now')

          WHERE id=?
        `)
        .run(
          'PalmPesa payment failed',
          pay.id
        );

      }


      /* EXPIRED + PalmPesa bado haijathibitisha => acha kusubiri */
      if(
        isExpired &&
        st !== 'FAILED'
      ){

        return json(
          res,
          200,
          {
            status:'FAILED',
            expired:true,
            terminal:true,
            error:
              pay.failure_reason ||
              'Muda wa malipo umeisha. Jaribu tena.',
            paymentId:pay.id
          }
        );

      }


      return json(
        res,
        200,
        {

          status:
            st === 'FAILED'
              ? 'FAILED'
              : 'PENDING',

          paymentId:
            pay.id

        }
      );


    }catch(e){

      if(isExpired){

        return json(
          res,
          200,
          {
            status:'FAILED',
            expired:true,
            terminal:true,
            error:
              pay.failure_reason ||
              'Muda wa malipo umeisha. Jaribu tena.',
            paymentId:pay.id
          }
        );

      }

      return json(
        res,
        502,
        {

          status:
            'PENDING',

          error:
            e.message,

          paymentId:
            pay.id

        }
      );

    }

  }


  /* =======================================================
     CANCEL PENDING PAYMENT
     ======================================================= */

  if(
    p === '/api/subscription/cancel-pending' &&
    m === 'POST'
  ){

    const u =
      auth(
        req,
        res,
        'owner'
      );


    if(!u)
      return;


    const r =
      db.prepare(`
        UPDATE subscription_payments

        SET
          status='CANCELLED',
          failure_reason='Umeghairi malipo.',
          updated_at=datetime('now')

        WHERE
          business_id=?
          AND status='PENDING'
      `)
      .run(
        u.business_id
      );


    return json(
      res,
      200,
      {
        ok:true,
        cancelled:
          Number(r.changes)
      }
    );

  }


  /* =======================================================
     SUBSCRIPTION PAYMENTS
     ======================================================= */

  if(
    p === '/api/subscription/payments' &&
    m === 'GET'
  ){

    const u =
      auth(
        req,
        res,
        'owner'
      );


    if(!u)
      return;


    expireStalePayments(u.business_id);


    return json(
      res,
      200,
      {

        payments:
          db.prepare(`
            SELECT
              id,
              phone,
              amount_tzs,
              provider,
              order_id,
              transaction_id,
              status,
              failure_reason,
              created_at,
              updated_at

            FROM subscription_payments

            WHERE business_id=?

            ORDER BY
              created_at DESC

            LIMIT 100
          `)
          .all(
            u.business_id
          )

      }
    );

  }


  /* =======================================================
     SUPER ADMIN SUBSCRIPTION PLANS
     ======================================================= */

  if(
    p === '/api/super/subscription/plans' &&
    m === 'GET'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    const rows =
      db.prepare(`
        SELECT *
        FROM subscription_plans
        ORDER BY id
      `)
      .all();


    return json(
      res,
      200,
      {

        plans:
          rows.map(
            x => ({

              ...x,

              current_price_tzs:
                effectivePlanPrice(x),

              features:
                parseFeatures(
                  x.features_json
                )

            })
          )

      }
    );

  }


  /* =======================================================
     SUPER ADMIN CREATE PLAN
     ======================================================= */

  if(
    p === '/api/super/subscription/plans' &&
    m === 'POST'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    const x =
      await body(req);


    const name =
      clean(
        x.name
      );


    const code =
      clean(
        x.code
      )
      .toLowerCase()
      .replace(
        /[^a-z0-9_-]/g,
        '-'
      );


    const regular =
      Math.round(
        Number(
          x.regularPriceTzs
        )
      );


    const discount =
      Number(
        x.discountPercent || 0
      );


    const duration =
      Math.floor(
        Number(
          x.durationDays || 30
        )
      );


    if(
      !name ||
      !code ||
      !Number.isFinite(regular) ||
      regular < 0 ||
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount > 100 ||
      duration < 1
    ){

      return json(
        res,
        400,
        {
          error:
            'Plan taarifa si sahihi.'
        }
      );

    }


    const final =
      Math.max(
        0,
        Math.round(
          regular *
          (
            1 -
            discount / 100
          )
        )
      );


    try{

      const r =
        db.prepare(`
          INSERT INTO subscription_plans
          (
            name,
            code,
            regular_price_tzs,
            discount_percent,
            final_price_tzs,
            duration_days,
            promotion_name,
            promotion_start,
            promotion_end,
            features_json,
            active
          )
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
        `)
        .run(
          name,
          code,
          regular,
          discount,
          final,
          duration,
          clean(x.promotionName)||null,
          clean(x.promotionStart)||null,
          clean(x.promotionEnd)||null,
          JSON.stringify(
            Array.isArray(x.features)
              ? x.features
              : []
          ),
          x.active === false
            ? 0
            : 1
        );


      return json(
        res,
        201,
        {
          id:
            Number(
              r.lastInsertRowid
            )
        }
      );


    }catch{

      return json(
        res,
        409,
        {
          error:
            'Plan code tayari ipo.'
        }
      );

    }

  }


  /* =======================================================
     SUPER ADMIN UPDATE PLAN
     ======================================================= */

  let subPlanId =
    p.match(
      /^\/api\/super\/subscription\/plans\/(\d+)$/
    );


  if(
    subPlanId &&
    m === 'PATCH'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    const id =
      Number(
        subPlanId[1]
      );


    const old =
      db.prepare(`
        SELECT *
        FROM subscription_plans
        WHERE id=?
      `)
      .get(id);


    if(!old){

      return json(
        res,
        404,
        {
          error:
            'Plan haipo.'
        }
      );

    }


    const x =
      await body(req);


    const name =
      clean(
        x.name ||
        old.name
      );


    const regular =
      Math.round(
        Number(
          x.regularPriceTzs ??
          old.regular_price_tzs
        )
      );


    const discount =
      Number(
        x.discountPercent ??
        old.discount_percent
      );


    const duration =
      Math.floor(
        Number(
          x.durationDays ??
          old.duration_days
        )
      );


    if(
      !name ||
      !Number.isFinite(regular) ||
      regular < 0 ||
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount > 100 ||
      duration < 1
    ){

      return json(
        res,
        400,
        {
          error:
            'Plan taarifa si sahihi.'
        }
      );

    }


    const final =
      Math.max(
        0,
        Math.round(
          regular *
          (
            1 -
            discount / 100
          )
        )
      );


    db.prepare(`
      UPDATE subscription_plans

      SET
        name=?,
        regular_price_tzs=?,
        discount_percent=?,
        final_price_tzs=?,
        duration_days=?,
        promotion_name=?,
        promotion_start=?,
        promotion_end=?,
        features_json=?,
        active=?,
        updated_at=datetime('now')

      WHERE id=?
    `)
    .run(
      name,
      regular,
      discount,
      final,
      duration,
      clean(
        x.promotionName ??
        old.promotion_name
      ) || null,
      clean(
        x.promotionStart ??
        old.promotion_start
      ) || null,
      clean(
        x.promotionEnd ??
        old.promotion_end
      ) || null,
      JSON.stringify(
        Array.isArray(x.features)
          ? x.features
          : parseFeatures(
              old.features_json
            )
      ),
      x.active === false
        ? 0
        : 1,
      id
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }


  /* =======================================================
     SUPER ADMIN SUBSCRIPTION STATS
     ======================================================= */

  if(
    p === '/api/super/subscription/stats' &&
    m === 'GET'
  ){

    const u =
      auth(
        req,
        res,
        'super_admin'
      );


    if(!u)
      return;


    const totals =
      db.prepare(`
        SELECT

          COUNT(*) payments,

          COALESCE(
            SUM(
              CASE
                WHEN status='SUCCESSFUL'
                THEN amount_tzs
                ELSE 0
              END
            ),
            0
          ) successful_amount,

          COALESCE(
            SUM(
              CASE
                WHEN status='SUCCESSFUL'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) successful_count,

          COALESCE(
            SUM(
              CASE
                WHEN status='PENDING'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) pending_count,

          COALESCE(
            SUM(
              CASE
                WHEN status='FAILED'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) failed_count

        FROM subscription_payments
      `)
      .get();


    const active =
      db.prepare(`
        SELECT
          COUNT(*) active_subscriptions

        FROM subscriptions

        WHERE
          status='ACTIVE'
          AND expires_at>datetime('now')
      `)
      .get();


    return json(
      res,
      200,
      {
        totals,
        active
      }
    );

  }


  /* =======================================================
     DASHBOARD — LEO / MWEZI / LENGO (owner)
     ======================================================= */

  if(
    p === '/api/dashboard/today' &&
    m === 'GET'
  ){

    const u = owner(req,res);

    if(!u)
      return;

    if(u.role === 'super_admin'){
      return json(res,403,{ error:'Tumia akaunti ya biashara.' });
    }

    const bid = u.business_id;

    /* Siku/mwezi kwa saa za Tanzania (UTC+3); created_at imehifadhiwa UTC */
    const DAY   = "created_at >= datetime(date('now','+3 hours'),'-3 hours')";
    const MONTH = "created_at >= datetime(strftime('%Y-%m-01','now','+3 hours'),'-3 hours')";
    const LAST  = "created_at >= datetime(strftime('%Y-%m-01','now','+3 hours','-1 month'),'-3 hours') " +
                  "AND created_at < datetime(strftime('%Y-%m-01','now','+3 hours'),'-3 hours')";

    const salesQ = cond => db.prepare(`
      SELECT
        COUNT(*) n,
        COALESCE(SUM(total),0) revenue,
        COALESCE(SUM((sell_price-buy_price)*quantity-discount),0) profit
      FROM sales
      WHERE business_id=?
        AND COALESCE(voided,0)=0
        AND ${cond}
    `).get(bid);

    const day   = salesQ(DAY);
    const month = salesQ(MONTH);
    const last  = salesQ(LAST);

    const exp = db.prepare(`
      SELECT COALESCE(SUM(amount),0) v
      FROM expenses
      WHERE business_id=? AND ${DAY}
    `).get(bid);

    const b = db.prepare(
      'SELECT monthly_goal_tzs FROM businesses WHERE id=?'
    ).get(bid);

    return json(res,200,{
      today:{
        count:Number(day.n),
        revenue:Number(day.revenue),
        profit:Number(day.profit),
        expenses:Number(exp.v)
      },
      month:{
        revenue:Number(month.revenue),
        profit:Number(month.profit)
      },
      last_month:{
        revenue:Number(last.revenue)
      },
      goal:b && b.monthly_goal_tzs ? Number(b.monthly_goal_tzs) : null
    });

  }


  if(
    p === '/api/business/goal' &&
    m === 'PUT'
  ){

    const u = owner(req,res);

    if(!u)
      return;

    const x = await body(req);

    const g = Math.round(Number(x.monthly_goal_tzs));

    if(!Number.isFinite(g) || g < 0 || g > 1e12){
      return json(res,400,{ error:'Weka kiasi sahihi cha lengo.' });
    }

    db.prepare(
      'UPDATE businesses SET monthly_goal_tzs=? WHERE id=?'
    ).run(g > 0 ? g : null, u.business_id);

    return json(res,200,{ ok:true, monthly_goal_tzs: g > 0 ? g : null });

  }


  /* =======================================================
     BUSINESS SETTINGS (owner)
     ======================================================= */

  if(
    p === '/api/business/settings' &&
    m === 'GET'
  ){

    const u = owner(req,res);

    if(!u)
      return;

    const b = db.prepare(`
      SELECT
        id, name, code, phone, address, location,
        theme_preference, notify_summary_enabled,
        notify_interval_minutes, monthly_goal_tzs
      FROM businesses
      WHERE id=?
    `)
    .get(u.business_id);

    if(!b){
      return json(res,404,{ error:'Biashara haipo.' });
    }

    return json(res,200,{ business:b });

  }


  if(
    p === '/api/business/settings' &&
    m === 'PUT'
  ){

    const u = owner(req,res);

    if(!u)
      return;

    const x = await body(req);

    const name = String(x.name||'').trim();
    const phone = String(x.phone||'').trim();
    const address = String(x.address||'').trim();

    const theme = ['auto','dark','light'].includes(x.theme_preference)
      ? x.theme_preference
      : 'auto';

    const notifyEnabled = x.notify_summary_enabled ? 1 : 0;

    const intervalMin = Number(x.notify_interval_minutes) > 0
      ? Number(x.notify_interval_minutes)
      : 120;

    if(!name){
      return json(res,400,{ error:'Jina la biashara linahitajika.' });
    }

    db.prepare(`
      UPDATE businesses
      SET
        name=?, phone=?, address=?, theme_preference=?,
        notify_summary_enabled=?, notify_interval_minutes=?
      WHERE id=?
    `)
    .run(
      name, phone, address, theme,
      notifyEnabled, intervalMin, u.business_id
    );

    audit(
      u.business_id, u.id,
      'BUSINESS_SETTINGS_UPDATED',
      'Owner alibadilisha mipangilio ya biashara'
    );

    return json(res,200,{ ok:true });

  }


  /* =======================================================
     TEST NOTIFICATION (immediate, kwa majaribio)
     ======================================================= */

  if(
    p === '/api/business/test-notify' &&
    m === 'POST'
  ){

    const u = owner(req,res);

    if(!u)
      return;

    const tokens = pushTokensForBusiness(u.business_id);

    if(!tokens.length){
      return json(res,400,{
        error:'Hakuna kifaa kilichowashwa kwa arifa. Bonyeza kwanza "Washa arifa" kwenye Mipangilio, kubali ruhusa, kisha jaribu tena.'
      });
    }

    const result = await sendPushToTokens(
      tokens,
      'Jaribio la arifa',
      'Hongera! Arifa za Daftari+ zinafanya kazi kikamilifu kwenye kifaa hiki.',
      { type:'test_notification' }
    );

    if(result.skipped){
      return json(res,400,{
        error:'ONESIGNAL_APP_ID au ONESIGNAL_API_KEY haijawekwa kwenye server.'
      });
    }

    if(result.error){
      return json(res,502,{
        error:'Imeshindwa kutuma arifa, angalia App ID/API Key ni sahihi.'
      });
    }

    return json(res,200,{ ok:true, sent:result.sent });

  }


  /* =======================================================
     PUSH TOKENS (device registration for notifications)
     ======================================================= */

  if(
    p === '/api/business/push-token' &&
    m === 'POST'
  ){

    const u = bizOnly(req,res);

    if(!u)
      return;

    const x = await body(req);

    const token = String(x.token||'').trim();
    const platform = String(x.platform||'android').trim();

    if(!token){
      return json(res,400,{ error:'Token inahitajika.' });
    }

    db.prepare(`
      INSERT INTO push_tokens(business_id,user_id,token,platform)
      VALUES(?,?,?,?)
      ON CONFLICT(business_id,token) DO UPDATE SET
        user_id=excluded.user_id,
        platform=excluded.platform
    `)
    .run(u.business_id, u.id, token, platform);

    return json(res,200,{ ok:true });

  }


  if(
    p === '/api/business/push-token' &&
    m === 'DELETE'
  ){

    const u = bizOnly(req,res);

    if(!u)
      return;

    const x = await body(req);

    const token = String(x.token||'').trim();

    db.prepare(
      'DELETE FROM push_tokens WHERE business_id=? AND token=?'
    )
    .run(u.business_id, token);

    return json(res,200,{ ok:true });

  }


  /* =======================================================
     NOT FOUND
     ======================================================= */

  return json(
    res,
    404,
    {
      error:
        'Not found'
    }
  );

}


/* =========================================================
   STATIC FILE SERVER
   ========================================================= */

function serve(
  req,
  res
){

  let p =
    new URL(
      req.url,
      'http://localhost'
    ).pathname;


  if(
    p === '/'
  )
    p='/index.html';


  const cleanPath =
    path
      .normalize(p)
      .replace(
        /^[/\\]+/,
        ''
      );


  const candidates=[];


  /*
   * Subscription folder
   */
  if(
    p === '/subscription' ||
    p === '/subscription/'
  ){

    candidates.push(
      path.join(
        ROOT,
        'subscription',
        'subscription.html'
      )
    );

  }else if(
    p.startsWith(
      '/subscription/'
    )
  ){

    candidates.push(
      path.join(
        ROOT,
        'subscription',
        p.slice(
          '/subscription/'.length
        )
      )
    );

  }else{

    candidates.push(
      path.join(
        PUBLIC,
        cleanPath
      )
    );

    candidates.push(
      path.join(
        ROOT,
        cleanPath
      )
    );

  }


  function tryFile(
    index
  ){

    if(
      index >=
      candidates.length
    ){

      return res
        .writeHead(
          404,
          {
            'Content-Type':
              'text/plain; charset=utf-8'
          }
        )
        .end(
          'Not found'
        );

    }


    const fp =
      path.resolve(
        candidates[index]
      );


    const allowedRoots=[
      path.resolve(ROOT),
      path.resolve(PUBLIC)
    ];


    const allowed =
      allowedRoots.some(
        root =>
          fp === root ||
          fp.startsWith(
            root +
            path.sep
          )
      );


    if(!allowed){

      return res
        .writeHead(
          403,
          {
            'Content-Type':
              'text/plain; charset=utf-8'
          }
        )
        .end(
          'Forbidden'
        );

    }


    fs.stat(
      fp,
      (e,st)=>{

        if(
          e ||
          !st.isFile()
        ){

          return tryFile(
            index+1
          );

        }


        fs.readFile(
          fp,
          (er,data)=>{

            if(er){

              return tryFile(
                index+1
              );

            }


            const ext =
              path
                .extname(fp)
                .toLowerCase();


            const types={

              '.html':
                'text/html; charset=utf-8',

              '.js':
                'application/javascript; charset=utf-8',

              '.css':
                'text/css; charset=utf-8',

              '.json':
                'application/json; charset=utf-8',

              '.png':
                'image/png',

              '.jpg':
                'image/jpeg',

              '.jpeg':
                'image/jpeg',

              '.svg':
                'image/svg+xml',

              '.ico':
                'image/x-icon',

              '.webp':
                'image/webp',

              '.woff':
                'font/woff',

              '.woff2':
                'font/woff2'

            };


            res.writeHead(
              200,
              {

                'Content-Type':
                  types[ext] ||
                  'application/octet-stream',

                'X-Content-Type-Options':
                  'nosniff',

                'Referrer-Policy':
                  'strict-origin-when-cross-origin',

                'Cache-Control':
                  ext === '.html'
                    ? 'no-cache'
                    : 'public, max-age=86400'

              }
            );


            res.end(
              data
            );

          }
        );

      }
    );

  }


  tryFile(0);

}


/* =========================================================
   SERVER
   ========================================================= */

http
  .createServer(
    (req,res)=>{

      if(
        req.url.startsWith(
          '/api/'
        )
      ){

        api(
          req,
          res
        )
        .catch(
          e => {

            console.error(e);

            json(
              res,
              500,
              {
                error:
                  'Server error.'
              }
            );

          }
        );

      }else{

        serve(
          req,
          res
        );

      }

    }
  )
  .listen(
    PORT,
    ()=>{

      console.log(
        `Daftari+ running on :${PORT}`
      );

      expireAllStalePayments();

      setInterval(
        expireAllStalePayments,
        60000
      ).unref();

      runPeriodicBusinessSummaries().catch(
        e => console.error('runPeriodicBusinessSummaries failed', e)
      );

      setInterval(
        () => runPeriodicBusinessSummaries().catch(
          e => console.error('runPeriodicBusinessSummaries failed', e)
        ),
        60 * 1000
      ).unref();

    }
  );
