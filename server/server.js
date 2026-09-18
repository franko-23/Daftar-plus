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
