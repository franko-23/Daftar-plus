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
);CREATE TABLE IF NOT EXISTS oauth_states(
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_identities(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(provider,subject)
);

CREATE TABLE IF NOT EXISTS oauth_tickets(
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT,
  user_id INTEGER,
  email TEXT,
  full_name TEXT,
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
  UNIQUE(user_id)
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
  currency TEXT NOT NULL DEFAULT 'TZS',
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT,
  paid_by INTEGER,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(payment_id,user_id,level)
);

` ;

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
   DEFAULT BUSINESS PLAN
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

  const defaultPlans=[
    ['Daftari+ Monthly','monthly',50000,0,50000,30,'Mpango wa mwezi',['Dashboard ya biashara','Mauzo na stock','Madeni na matumizi','Ripoti za biashara']],
    ['Daftari+ Quarterly','quarterly',150000,20,120000,90,'Mpango wa miezi 3',['Vipengele vyote vya biashara','Ripoti na analytics','Usimamizi wa timu']],
    ['Daftari+ Yearly','yearly',600000,33.333333,400000,365,'Mpango wa mwaka',['Vipengele vyote vya biashara','Ripoti na analytics','Usimamizi wa timu','Support']]
  ];
  for(const plan of defaultPlans){
    if(!db.prepare('SELECT id FROM subscription_plans WHERE code=?').get(plan[1])){
      db.prepare(`INSERT INTO subscription_plans(name,code,regular_price_tzs,discount_percent,final_price_tzs,duration_days,promotion_name,features_json,active) VALUES(?,?,?,?,?,?,?,?,1)`).run(plan[0],plan[1],plan[2],plan[3],plan[4],plan[5],plan[6],JSON.stringify(plan[7]));
    }
  }

}catch(e){

  console.error(
    'Subscription seed:',
    e.message
  );

}


/* =========================================================
   MIGRATIONS
   ========================================================= */

for(
  const sql of [

    'ALTER TABLE businesses ADD COLUMN location TEXT',
    'ALTER TABLE businesses ADD COLUMN business_type TEXT',
    'ALTER TABLE businesses ADD COLUMN business_phone TEXT',
    'ALTER TABLE businesses ADD COLUMN region TEXT',
    'ALTER TABLE businesses ADD COLUMN district TEXT',
    'ALTER TABLE businesses ADD COLUMN ward TEXT',

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


/* =========================================================
   REFERRAL MIGRATIONS
   ========================================================= */

for(const sql of [
  'ALTER TABLE users ADD COLUMN referral_code TEXT',
  'ALTER TABLE users ADD COLUMN referred_by_user_id INTEGER',
  'ALTER TABLE users ADD COLUMN referral_code_used TEXT',
  'ALTER TABLE oauth_states ADD COLUMN referral_code TEXT',
  'ALTER TABLE oauth_tickets ADD COLUMN referral_code TEXT'
]){
  try{ db.exec(sql); }catch{}
}

try{
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_referral_commissions_user ON referral_commissions(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_referral_commissions_payment ON referral_commissions(payment_id)');
}catch(e){ console.error('Referral indexes:',e.message); }

try{
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const makeReferralCode=()=>{
    for(let attempt=0;attempt<100;attempt++){
      let code='DP-';
      for(let i=0;i<8;i++) code+=chars[crypto.randomInt(chars.length)];
      if(!db.prepare('SELECT 1 FROM users WHERE referral_code=?').get(code)) return code;
    }
    throw Error('Could not create referral code');
  };
  const oldUsers=db.prepare("SELECT id FROM users WHERE referral_code IS NULL OR referral_code=''").all();
  for(const u of oldUsers){
    try{ db.prepare('UPDATE users SET referral_code=? WHERE id=?').run(makeReferralCode(),u.id); }catch{}
  }
}catch(e){ console.error('Referral code seed:',e.message); }

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
 * Subscription gate bado ipo kwa modules
 * zinazotaka kuitumia.
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


  const r =
    await fetch(
      c.baseUrl + endpoint,
      {
        method:'POST',

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

      distributeReferralCommission(p.id);


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
   SOCIAL AUTH — GOOGLE + APPLE
   ========================================================= */

function publicBaseUrl(){
  return String(process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`).replace(/\/+$/,'');
}

function oauthRedirect(provider){
  return `${publicBaseUrl()}/api/auth/${provider}/callback`;
}

function oauthState(provider,referralCode=''){
  const state=crypto.randomBytes(32).toString('base64url');
  const expires=new Date(Date.now()+10*60e3).toISOString();

  db.prepare(
    'INSERT INTO oauth_states(state,provider,expires_at,referral_code) VALUES(?,?,?,?)'
  )
  .run(
    state,
    provider,
    expires,
    clean(referralCode)||null
  );

  return state;
}

function consumeOauthState(state,provider){
  const x=db.prepare(
    'SELECT * FROM oauth_states WHERE state=? AND provider=?'
  ).get(
    state,
    provider
  );

  if(
    !x ||
    new Date(x.expires_at)<=new Date()
  ){
    if(x)
      db.prepare(
        'DELETE FROM oauth_states WHERE state=?'
      ).run(state);

    return null;
  }

  db.prepare(
    'DELETE FROM oauth_states WHERE state=?'
  ).run(state);

  return x;
}

function b64urlJson(v){
  const s=String(v||'');

  return JSON.parse(
    Buffer.from(
      s
        .replace(/-/g,'+')
        .replace(/_/g,'/')+
        '='.repeat(
          (4-s.length%4)%4
        ),
      'base64'
    ).toString('utf8')
  );
}

function parseJwt(v){
  const p=String(v||'').split('.');

  if(p.length!==3)
    throw Error(
      'Identity token si sahihi.'
    );

  return {
    header:b64urlJson(p[0]),
    payload:b64urlJson(p[1]),
    signature:
      Buffer.from(
        p[2]
          .replace(/-/g,'+')
          .replace(/_/g,'/')+
          '='.repeat(
            (4-p[2].length%4)%4
          ),
        'base64'
      ),
    signed:`${p[0]}.${p[1]}`
  };
}

let googleCertCache={
  data:null,
  expires:0
};

async function googlePublicKey(kid){

  const now=Date.now();

  if(
    !googleCertCache.data ||
    now>googleCertCache.expires
  ){

    const r=
      await fetch(
        'https://www.googleapis.com/oauth2/v3/certs'
      );

    if(!r.ok)
      throw Error(
        'Google public keys hazijapatikana.'
      );

    googleCertCache.data=
      await r.json();

    googleCertCache.expires=
      now+3600e3;
  }

  const cert=
    googleCertCache.data[kid];

  if(!cert)
    throw Error(
      'Google token key haijatambuliwa.'
    );

  return crypto.createPublicKey(cert);
}

async function verifyGoogleIdToken(idToken){

  const t=
    parseJwt(idToken);

  if(
    t.header.alg!=='RS256'
  )
    throw Error(
      'Google token algorithm si sahihi.'
    );

  const v=
    crypto.createVerify(
      'RSA-SHA256'
    );

  v.update(t.signed);
  v.end();

  if(
    !(await v.verify(
      await googlePublicKey(
        t.header.kid
      ),
      t.signature
    ))
  )
    throw Error(
      'Google token signature si sahihi.'
    );

  const p=t.payload,
        now=Math.floor(
          Date.now()/1000
        ),
        aud=String(
          process.env.GOOGLE_CLIENT_ID||''
        );

  if(
    !aud ||
    p.iss!=='https://accounts.google.com' ||
    p.aud!==aud ||
    !p.sub ||
    !p.email ||
    p.email_verified!==true ||
    Number(p.exp||0)<now
  )
    throw Error(
      'Google account verification imeshindikana.'
    );

  return {
    subject:String(p.sub),
    email:email(p.email),
    fullName:
      clean(
        p.name||
        p.given_name||
        p.email.split('@')[0]
      )
  };
}

function formEncode(obj){
  return new URLSearchParams(
    Object.entries(obj)
      .map(
        ([k,v])=>[
          k,
          String(v)
        ]
      )
  ).toString();
}

function appleClientSecret(){

  const team=
    clean(
      process.env.APPLE_TEAM_ID
    );

  const kid=
    clean(
      process.env.APPLE_KEY_ID
    );

  const client=
    clean(
      process.env.APPLE_CLIENT_ID
    );

  const pem=
    String(
      process.env.APPLE_PRIVATE_KEY||''
    )
    .replace(/\\n/g,'\n');

  if(
    !team ||
    !kid ||
    !client ||
    !pem
  )
    throw Error(
      'Apple OAuth haija-configurewa kikamilifu.'
    );

  const enc=
    o =>
      Buffer
        .from(
          JSON.stringify(o)
        )
        .toString('base64url');

  const h=
    enc({
      alg:'ES256',
      kid,
      typ:'JWT'
    });

  const now=
    Math.floor(
      Date.now()/1000
    );

  const b=
    enc({
      iss:team,
      iat:now,
      exp:now+15777000,
      aud:'https://appleid.apple.com',
      sub:client
    });

  const input=
    `${h}.${b}`;

  const sig=
    crypto.createSign(
      'SHA256'
    );

  sig.update(input);
  sig.end();

  return (
    `${input}.`+
    sig.sign({
      key:pem,
      dsaEncoding:'ieee-p1363'
    })
    .toString('base64url')
  );
}

let appleJwksCache={
  data:null,
  expires:0
};

async function applePublicKey(kid){

  const now=Date.now();

  if(
    !appleJwksCache.data ||
    now>appleJwksCache.expires
  ){

    const r=
      await fetch(
        'https://appleid.apple.com/auth/keys'
      );

    if(!r.ok)
      throw Error(
        'Apple public keys hazijapatikana.'
      );

    appleJwksCache.data=
      await r.json();

    appleJwksCache.expires=
      now+3600e3;
  }

  const jwk=
    appleJwksCache.data.keys.find(
      k=>k.kid===kid
    );

  if(!jwk)
    throw Error(
      'Apple token key haijatambuliwa.'
    );

  return crypto.createPublicKey({
    key:jwk,
    format:'jwk'
  });
}

async function verifyAppleIdToken(
  idToken
){

  const t=
    parseJwt(idToken);

  if(
    t.header.alg!=='RS256'
  )
    throw Error(
      'Apple token algorithm si sahihi.'
    );

  const v=
    crypto.createVerify(
      'RSA-SHA256'
    );

  v.update(t.signed);
  v.end();

  if(
    !(await v.verify(
      await applePublicKey(
        t.header.kid
      ),
      t.signature
    ))
  )
    throw Error(
      'Apple token signature si sahihi.'
    );

  const p=t.payload,
        now=Math.floor(
          Date.now()/1000
        ),
        aud=clean(
          process.env.APPLE_CLIENT_ID
        );

  if(
    p.iss!=='https://appleid.apple.com' ||
    p.aud!==aud ||
    !p.sub ||
    !p.email ||
    Number(p.exp||0)<now
  )
    throw Error(
      'Apple account verification imeshindikana.'
    );

  return {
    subject:String(p.sub),
    email:email(p.email),
    fullName:clean(p.name||'')
  };
}

function createOauthTicket(
  kind,
  profile,
  userId,
  referralCode=''
){

  const token=
    crypto
      .randomBytes(32)
      .toString('base64url');

  const expires=
    new Date(
      Date.now()+15*60e3
    ).toISOString();

  db.prepare(
    'INSERT INTO oauth_tickets(token,kind,provider,subject,user_id,email,full_name,expires_at,referral_code) VALUES(?,?,?,?,?,?,?,?,?)'
  )
  .run(
    token,
    kind,
    profile.provider,
    profile.subject,
    userId||null,
    profile.email,
    profile.fullName||null,
    expires,
    clean(referralCode)||null
  );

  return token;
}

function oauthFindOrTicket(
  provider,
  profile,
  referralCode=''
){

  profile.provider=provider;

  const identity=
    db.prepare(`
      SELECT i.user_id
      FROM oauth_identities i
      JOIN users u
        ON u.id=i.user_id
      WHERE i.provider=?
      AND i.subject=?
      AND u.active=1
    `)
    .get(
      provider,
      profile.subject
    );

  if(identity)
    return createOauthTicket(
      'login',
      profile,
      identity.user_id
    );

  const byEmail=
    db.prepare(`
      SELECT id
      FROM users
      WHERE email=?
      AND active=1
    `)
    .get(
      profile.email
    );

  if(byEmail){

    db.prepare(`
      INSERT OR IGNORE INTO oauth_identities
      (provider,subject,user_id,email)
      VALUES(?,?,?,?)
    `)
    .run(
      provider,
      profile.subject,
      byEmail.id,
      profile.email
    );

    const bu=
      db.prepare(
        'SELECT business_id FROM users WHERE id=?'
      )
      .get(
        byEmail.id
      );

    audit(
      bu?.business_id,
      byEmail.id,
      'OAUTH_LINK',
      provider
    );

    return createOauthTicket(
      'login',
      profile,
      byEmail.id
    );
  }

  return createOauthTicket(
    'signup',
    profile,
    null,
    referralCode
  );
}

async function oauthGoogleStart(
  req,
  res
){

  const client=
    clean(
      process.env.GOOGLE_CLIENT_ID
    );

  if(!client)
    return json(
      res,
      503,
      {
        error:
          'Google login bado haija-configurewa: GOOGLE_CLIENT_ID haipo.'
      }
    );

  const z=q(req),
        state=
          oauthState(
            'google',
            z.ref||z.referral||''
          ),
        u=
          new URL(
            'https://accounts.google.com/o/oauth2/v2/auth'
          );

  u.searchParams.set(
    'client_id',
    client
  );

  u.searchParams.set(
    'redirect_uri',
    oauthRedirect('google')
  );

  u.searchParams.set(
    'response_type',
    'code'
  );

  u.searchParams.set(
    'scope',
    'openid email profile'
  );

  u.searchParams.set(
    'state',
    state
  );

  u.searchParams.set(
    'prompt',
    'select_account'
  );

  return res
    .writeHead(
      302,
      {
        Location:
          u.toString()
      }
    )
    .end();
}

async function oauthGoogleCallback(
  req,
  res
){

  const z=q(req);

  const oauth=
    consumeOauthState(
      z.state,
      'google'
    );

  if(!oauth)
    return res
      .writeHead(400)
      .end(
        'OAuth state si sahihi au ime-expire.'
      );

  if(z.error)
    return res
      .writeHead(400)
      .end(
        `Google login: ${clean(z.error_description||z.error)}`
      );

  const r=
    await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method:'POST',

        headers:{
          'Content-Type':
            'application/x-www-form-urlencoded'
        },

        body:
          formEncode({
            code:z.code,
            client_id:
              process.env.GOOGLE_CLIENT_ID,
            client_secret:
              process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri:
              oauthRedirect('google'),
            grant_type:
              'authorization_code'
          })
      }
    );

  const d=
    await r.json();

  if(
    !r.ok ||
    !d.id_token
  )
    throw Error(
      'Google haikurudisha identity token.'
    );

  const profile=
    await verifyGoogleIdToken(
      d.id_token
    );

  return res
    .writeHead(
      302,
      {
        Location:
          `/oauth-complete.html?ticket=${encodeURIComponent(
            oauthFindOrTicket(
              'google',
              profile,
              oauth.referral_code||''
            )
          )}`
      }
    )
    .end();
}

async function oauthAppleStart(
  req,
  res
){

  const client=
    clean(
      process.env.APPLE_CLIENT_ID
    );

  if(!client)
    return json(
      res,
      503,
      {
        error:
          'Apple login bado haija-configurewa: APPLE_CLIENT_ID haipo.'
      }
    );

  const z=q(req),
        state=
          oauthState(
            'apple',
            z.ref||z.referral||''
          ),
        u=
          new URL(
            'https://appleid.apple.com/auth/authorize'
          );

  u.searchParams.set(
    'client_id',
    client
  );

  u.searchParams.set(
    'redirect_uri',
    oauthRedirect('apple')
  );

  u.searchParams.set(
    'response_type',
    'code'
  );

  u.searchParams.set(
    'response_mode',
    'query'
  );

  u.searchParams.set(
    'scope',
    'name email'
  );

  u.searchParams.set(
    'state',
    state
  );

  return res
    .writeHead(
      302,
      {
        Location:
          u.toString()
      }
    )
    .end();
}

async function oauthAppleCallback(
  req,
  res
){

  const z=q(req);

  const oauth=
    consumeOauthState(
      z.state,
      'apple'
    );

  if(!oauth)
    return res
      .writeHead(400)
      .end(
        'OAuth state si sahihi au ime-expire.'
      );

  if(z.error)
    return res
      .writeHead(400)
      .end(
        `Apple login: ${clean(z.error_description||z.error)}`
      );

  const r=
    await fetch(
      'https://appleid.apple.com/auth/token',
      {
        method:'POST',

        headers:{
          'Content-Type':
            'application/x-www-form-urlencoded'
        },

        body:
          formEncode({
            client_id:
              process.env.APPLE_CLIENT_ID,
            client_secret:
              appleClientSecret(),
            code:z.code,
            grant_type:
              'authorization_code',
            redirect_uri:
              oauthRedirect('apple')
          })
      }
    );

  const d=
    await r.json();

  if(
    !r.ok ||
    !d.id_token
  )
    throw Error(
      'Apple haikurudisha identity token.'
    );

  const profile=
    await verifyAppleIdToken(
      d.id_token
    );

  return res
    .writeHead(
      302,
      {
        Location:
          `/oauth-complete.html?ticket=${encodeURIComponent(
            oauthFindOrTicket(
              'apple',
              profile,
              oauth.referral_code||''
            )
          )}`
      }
    )
    .end();
} 
