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

CREATE TABLE IF NOT EXISTS oauth_states(
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

`;
db.exec(schema);


/* =========================================================
   SAFE DATABASE MIGRATIONS
   ========================================================= */

function addColumnIfMissing(table,column,definition){
  try{
    const cols=db.prepare(`PRAGMA table_info(${table})`).all();
    if(!cols.some(c=>c.name===column)){
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }catch(e){}
}

addColumnIfMissing('businesses','business_type','TEXT');
addColumnIfMissing('businesses','business_phone','TEXT');
addColumnIfMissing('businesses','region','TEXT');
addColumnIfMissing('businesses','district','TEXT');
addColumnIfMissing('businesses','ward','TEXT');

addColumnIfMissing('users','provider','TEXT');
addColumnIfMissing('users','provider_id','TEXT');

try{
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscription_plans(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      regular_price REAL NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      final_price REAL NOT NULL DEFAULT 0,
      duration_days INTEGER NOT NULL DEFAULT 30,
      promotion_name TEXT,
      promotion_start TEXT,
      promotion_end TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      features_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT(datetime('now')),
      updated_at TEXT NOT NULL DEFAULT(datetime('now'))
    );
  `);
}catch(e){}

try{
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT(datetime('now')),
      FOREIGN KEY(business_id) REFERENCES businesses(id),
      FOREIGN KEY(plan_id) REFERENCES subscription_plans(id)
    );
  `);
}catch(e){}

try{
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      subscription_id INTEGER,
      amount REAL NOT NULL DEFAULT 0,
      method TEXT,
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT(datetime('now'))
    );
  `);
}catch(e){}

try{
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_codes(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      code TEXT UNIQUE NOT NULL,
      package_code TEXT,
      used INTEGER NOT NULL DEFAULT 0,
      used_by INTEGER,
      created_at TEXT NOT NULL DEFAULT(datetime('now')),
      used_at TEXT
    );
  `);
}catch(e){}

try{
  db.exec(`
    CREATE TABLE IF NOT EXISTS package_rules(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      min_capital REAL NOT NULL DEFAULT 0,
      max_capital REAL,
      worker_limit INTEGER,
      unlimited_workers INTEGER NOT NULL DEFAULT 0
    );
  `);
}catch(e){}


/* =========================================================
   PACKAGE RULES
   ========================================================= */

const packageRules=[
  {
    code:'STARTER',
    name:'Starter',
    min_capital:1000000,
    max_capital:1999999,
    worker_limit:1,
    unlimited_workers:0
  },
  {
    code:'BASIC',
    name:'Basic',
    min_capital:2000000,
    max_capital:3999999,
    worker_limit:2,
    unlimited_workers:0
  },
  {
    code:'MIDDLE_PREMIUM',
    name:'Middle Premium',
    min_capital:4000000,
    max_capital:4999999,
    worker_limit:3,
    unlimited_workers:0
  },
  {
    code:'PREMIUM',
    name:'Premium',
    min_capital:5000000,
    max_capital:6999999,
    worker_limit:5,
    unlimited_workers:0
  },
  {
    code:'VIP_PREMIUM',
    name:'VIP Premium',
    min_capital:7000000,
    max_capital:null,
    worker_limit:null,
    unlimited_workers:1
  }
];

for(const p of packageRules){
  try{
    db.prepare(`
      INSERT INTO package_rules
      (code,name,min_capital,max_capital,worker_limit,unlimited_workers)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(code) DO UPDATE SET
        name=excluded.name,
        min_capital=excluded.min_capital,
        max_capital=excluded.max_capital,
        worker_limit=excluded.worker_limit,
        unlimited_workers=excluded.unlimited_workers
    `).run(
      p.code,
      p.name,
      p.min_capital,
      p.max_capital,
      p.worker_limit,
      p.unlimited_workers
    );
  }catch(e){}
}


/* =========================================================
   DEFAULT SUBSCRIPTION PLAN
   ========================================================= */

try{
  const existingPlan=db.prepare(`
    SELECT id FROM subscription_plans
    WHERE code='BUSINESS'
    LIMIT 1
  `).get();

  if(!existingPlan){
    db.prepare(`
      INSERT INTO subscription_plans
      (
        name,
        code,
        regular_price,
        discount_percent,
        final_price,
        duration_days,
        promotion_name,
        promotion_start,
        promotion_end,
        active,
        features_json
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'Business',
      'BUSINESS',
      20000,
      25,
      15000,
      30,
      'Promotion',
      '2026-10-01',
      '2026-10-31',
      1,
      JSON.stringify([])
    );
  }
}catch(e){}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function now(){
  return new Date();
}

function isoNow(){
  return new Date().toISOString();
}

function addDays(date,days){
  const d=new Date(date);
  d.setDate(d.getDate()+Number(days||0));
  return d;
}

function randomString(length=32){
  return crypto.randomBytes(Math.ceil(length/2))
    .toString('hex')
    .slice(0,length);
}

function randomCode(prefix='DP'){
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto
    .scryptSync(String(password),salt,64)
    .toString('hex');

  return `${salt}:${hash}`;
}

function verifyPassword(password,stored){
  try{
    const [salt,hash]=String(stored||'').split(':');

    if(!salt||!hash)return false;

    const check=crypto
      .scryptSync(String(password),salt,64)
      .toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(check,'hex'),
      Buffer.from(hash,'hex')
    );
  }catch(e){
    return false;
  }
}

function json(res,status,data){
  const body=JSON.stringify(data);

  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(body),
    'Cache-Control':'no-store'
  });

  res.end(body);
}

function text(res,status,data){
  res.writeHead(status,{
    'Content-Type':'text/plain; charset=utf-8'
  });

  res.end(data);
}

function redirect(res,url){
  res.writeHead(302,{
    Location:url
  });

  res.end();
}

function parseBody(req){
  return new Promise((resolve,reject)=>{
    let body='';

    req.on('data',chunk=>{
      body+=chunk;

      if(body.length>5*1024*1024){
        reject(new Error('Request too large'));
        req.destroy();
      }
    });

    req.on('end',()=>{
      if(!body){
        resolve({});
        return;
      }

      try{
        resolve(JSON.parse(body));
      }catch(e){
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error',reject);
  });
}

function getBearer(req){
  const h=req.headers.authorization||'';

  if(!h.startsWith('Bearer '))return '';

  return h.slice(7).trim();
}

function createSession(userId){
  const token=randomString(64);
  const expires=addDays(new Date(),30).toISOString();

  db.prepare(`
    INSERT INTO sessions(token,user_id,expires_at)
    VALUES(?,?,?)
  `).run(
    token,
    userId,
    expires
  );

  return token;
}

function getUserByToken(token){
  if(!token)return null;

  const row=db.prepare(`
    SELECT
      u.*,
      b.name AS business_name,
      b.code AS business_code,
      b.status AS business_status,
      b.location AS business_location
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    LEFT JOIN businesses b ON b.id=u.business_id
    WHERE s.token=?
      AND datetime(s.expires_at)>datetime('now')
      AND u.active=1
    LIMIT 1
  `).get(token);

  return row||null;
}

function auth(req){
  return getUserByToken(getBearer(req));
}

function owner(req){
  const u=auth(req);

  if(!u)return null;

  if(
    u.role!=='owner' &&
    u.role!=='super_admin'
  ){
    return null;
  }

  return u;
}

function bizOnly(req){
  const u=auth(req);

  if(!u)return null;

  if(!u.business_id)return null;

  return u;
}

function requireAuth(req,res){
  const u=auth(req);

  if(!u){
    json(res,401,{
      error:'Session imeisha au hujaingia.'
    });

    return null;
  }

  return u;
}
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
  return String(
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${PORT}`
  ).replace(/\/+$/,'');
}

function oauthRedirect(provider){
  return `${publicBaseUrl()}/api/auth/${provider}/callback`;
}

function oauthState(provider){

  const state =
    crypto.randomBytes(32)
      .toString('base64url');

  const expires =
    new Date(
      Date.now()+10*60e3
    ).toISOString();

  db.prepare(
    'INSERT INTO oauth_states(state,provider,expires_at) VALUES(?,?,?)'
  )
  .run(
    state,
    provider,
    expires
  );

  return state;
}

function consumeOauthState(
  state,
  provider
){

  const x =
    db.prepare(
      'SELECT * FROM oauth_states WHERE state=? AND provider=?'
    )
    .get(
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

    return false;
  }


  db.prepare(
    'DELETE FROM oauth_states WHERE state=?'
  ).run(state);

  return true;
}

function b64urlJson(v){

  const s=String(v||'');

  return JSON.parse(
    Buffer.from(
      s.replace(/-/g,'+')
       .replace(/_/g,'/')+
      '='.repeat(
        (4-s.length%4)%4
      ),
      'base64'
    ).toString('utf8')
  );
}

function parseJwt(v){

  const p =
    String(v||'')
      .split('.');


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

    signed:
      `${p[0]}.${p[1]}`
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

    const r =
      await fetch(
        'https://www.googleapis.com/oauth2/v3/certs'
      );


    if(!r.ok)
      throw Error(
        'Google public keys hazijapatikana.'
      );


    googleCertCache.data =
      await r.json();


    googleCertCache.expires =
      now+3600e3;
  }


  const cert =
    googleCertCache.data[kid];


  if(!cert)
    throw Error(
      'Google token key haijatambuliwa.'
    );


  return crypto.createPublicKey(cert);
}


async function verifyGoogleIdToken(
  idToken
){

  const t =
    parseJwt(idToken);


  if(
    t.header.alg!=='RS256'
  )
    throw Error(
      'Google token algorithm si sahihi.'
    );


  const v =
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
    fullName:clean(
      p.name ||
      p.given_name ||
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

  const team =
    clean(
      process.env.APPLE_TEAM_ID
    );

  const kid =
    clean(
      process.env.APPLE_KEY_ID
    );

  const client =
    clean(
      process.env.APPLE_CLIENT_ID
    );

  const pem =
    String(
      process.env.APPLE_PRIVATE_KEY||''
    )
    .replace(
      /\\n/g,
      '\n'
    );


  if(
    !team ||
    !kid ||
    !client ||
    !pem
  )
    throw Error(
      'Apple OAuth haija-configurewa kikamilifu.'
    );


  const enc=o=>
    Buffer.from(
      JSON.stringify(o)
    ).toString(
      'base64url'
    );


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
    `${input}.` +
    sig.sign({
      key:pem,
      dsaEncoding:'ieee-p1363'
    }).toString(
      'base64url'
    )
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
    fullName:clean(
      p.name||''
    )
  };
}


function createOauthTicket(
  kind,
  profile,
  userId
){

  const token=
    crypto.randomBytes(32)
      .toString('base64url');


  const expires=
    new Date(
      Date.now()+15*60e3
    ).toISOString();


  db.prepare(`
    INSERT INTO oauth_tickets(
      token,
      kind,
      provider,
      subject,
      user_id,
      email,
      full_name,
      expires_at
    )
    VALUES(?,?,?,?,?,?,?,?)
  `)
  .run(
    token,
    kind,
    profile.provider,
    profile.subject,
    userId||null,
    profile.email,
    profile.fullName||null,
    expires
  );


  return token;
}


function oauthFindOrTicket(
  provider,
  profile
){

  profile.provider=provider;


  const identity=
    db.prepare(`
      SELECT
        i.user_id
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
      (
        provider,
        subject,
        user_id,
        email
      )
      VALUES(?,?,?,?)
    `)
    .run(
      provider,
      profile.subject,
      byEmail.id,
      profile.email
    );


    const bu=
      db.prepare(`
        SELECT business_id
        FROM users
        WHERE id=?
      `)
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
    null
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


  const state=
    oauthState('google');


  const u=
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


  return res.writeHead(
    302,
    {
      Location:u.toString()
    }
  ).end();
}


async function oauthGoogleCallback(
  req,
  res
){

  const z=q(req);


  if(
    !consumeOauthState(
      z.state,
      'google'
    )
  )
    return res.writeHead(
      400
    ).end(
      'OAuth state si sahihi au ime-expire.'
    );


  if(z.error)
    return res.writeHead(
      400
    ).end(
      `Google login: ${
        clean(
          z.error_description||
          z.error
        )
      }`
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


  return res.writeHead(
    302,
    {
      Location:
        `/oauth-complete.html?ticket=${
          encodeURIComponent(
            oauthFindOrTicket(
              'google',
              profile
            )
          )
        }`
    }
  ).end();
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


  const state=
    oauthState('apple');


  const u=
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


  return res.writeHead(
    302,
    {
      Location:u.toString()
    }
  ).end();
}


async function oauthAppleCallback(
  req,
  res
){

  const z=q(req);


  if(
    !consumeOauthState(
      z.state,
      'apple'
    )
  )
    return res.writeHead(
      400
    ).end(
      'OAuth state si sahihi au ime-expire.'
    );


  if(z.error)
    return res.writeHead(
      400
    ).end(
      `Apple login: ${
        clean(
          z.error_description||
          z.error
        )
      }`
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


  return res.writeHead(
    302,
    {
      Location:
        `/oauth-complete.html?ticket=${
          encodeURIComponent(
            oauthFindOrTicket(
              'apple',
              profile
            )
          )
        }`
    }
  ).end();
}
/* =========================================================
   DASHBOARD
   ========================================================= */

function dashboard(
  req,
  res
){

  /*
   * Subscription haitumiki hapa.
   */

  const u =
    auth(
      req,
      res,
      'owner'
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
     GOOGLE + APPLE OAUTH
     ======================================================= */

  if(
    p === '/api/auth/google/start' &&
    m === 'GET'
  )
    return oauthGoogleStart(
      req,
      res
    );


  if(
    p === '/api/auth/google/callback' &&
    m === 'GET'
  )
    return oauthGoogleCallback(
      req,
      res
    );


  if(
    p === '/api/auth/apple/start' &&
    m === 'GET'
  )
    return oauthAppleStart(
      req,
      res
    );


  if(
    p === '/api/auth/apple/callback' &&
    m === 'GET'
  )
    return oauthAppleCallback(
      req,
      res
    );


  /* =======================================================
     OAUTH TICKET
     ======================================================= */

  if(
    p === '/api/oauth/ticket' &&
    m === 'POST'
  ){

    const x =
      await body(req);

    const token =
      clean(
        x.ticket
      );

    const t =
      db.prepare(
        'SELECT * FROM oauth_tickets WHERE token=?'
      )
      .get(
        token
      );


    if(
      !t ||
      new Date(t.expires_at)<=new Date()
    ){

      if(t)
        db.prepare(
          'DELETE FROM oauth_tickets WHERE token=?'
        )
        .run(
          token
        );


      return json(
        res,
        400,
        {
          error:
            'OAuth session ime-expire. Anza tena.'
        }
      );

    }


    if(
      t.kind === 'login'
    ){

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
        .get(
          t.user_id
        );


      if(
        !u ||
        !u.active
      ){

        return json(
          res,
          403,
          {
            error:
              'Account haipatikani au imezimwa.'
          }
        );

      }


      db.prepare(
        'DELETE FROM oauth_tickets WHERE token=?'
      )
      .run(
        token
      );


      audit(
        u.business_id,
        u.id,
        'LOGIN',
        `OAuth login via ${t.provider}`
      );


      return json(
        res,
        200,
        {
          token:
            session(
              u.id
            ),

          user:u
        }
      );

    }


    return json(
      res,
      200,
      {
        type:
          'signup',

        provider:
          t.provider,

        email:
          t.email,

        fullName:
          t.full_name || ''
      }
    );

  }


  /* =======================================================
     OAUTH COMPLETE
     ======================================================= */

  if(
    p === '/api/oauth/complete' &&
    m === 'POST'
  ){

    const x =
      await body(req);


    const token =
      clean(
        x.ticket
      );


    const t =
      db.prepare(`
        SELECT *
        FROM oauth_tickets
        WHERE token=?
        AND kind='signup'
      `)
      .get(
        token
      );


    if(
      !t ||
      new Date(t.expires_at)<=new Date()
    ){

      if(t)
        db.prepare(
          'DELETE FROM oauth_tickets WHERE token=?'
        )
        .run(
          token
        );


      return json(
        res,
        400,
        {
          error:
            'OAuth session ime-expire. Anza tena.'
        }
      );

    }


    const role =
      x.role === 'saler'
        ? 'saler'
        : 'owner';


    const name =
      clean(
        x.fullName
      ) ||
      t.full_name ||
      t.email.split('@')[0];


    const phone =
      clean(
        x.phone
      );


    if(!phone)
      return json(
        res,
        400,
        {
          error:
            'Namba ya simu inahitajika.'
        }
      );


    let bid,
        biz;


    /* =====================================================
       OWNER OAUTH REGISTRATION
       ===================================================== */

    if(
      role === 'owner'
    ){

      const bn =
        clean(
          x.businessName
        );


      const businessType =
        clean(
          x.businessType
        );


      const businessPhone =
        clean(
          x.businessPhone
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


      const loc =
        clean(
          x.businessLocation
        );


      if(
        !bn ||
        !businessType ||
        !businessPhone ||
        !region ||
        !district ||
        !ward ||
        !loc
      ){

        return json(
          res,
          400,
          {
            error:
              'Jaza taarifa zote za biashara.'
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
            business_type,
            business_phone,
            region,
            district,
            ward
          )
          VALUES(?,?,?,?,?,?,?,?)
        `)
        .run(
          bn,
          c,
          loc,
          businessType,
          businessPhone,
          region,
          district,
          ward
        );


      bid =
        Number(
          r.lastInsertRowid
        );


      biz =
        db.prepare(
          'SELECT * FROM businesses WHERE id=?'
        )
        .get(
          bid
        );

    }else{

      /* ===================================================
         SALER OAUTH REGISTRATION
         =================================================== */

      const bc =
        clean(
          x.businessCode
        )
        .toUpperCase();


      biz =
        db.prepare(
          'SELECT * FROM businesses WHERE code=?'
        )
        .get(
          bc
        );


      if(!biz)
        return json(
          res,
          404,
          {
            error:
              'Business Code haipo.'
          }
        );


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


      bid =
        biz.id;

    }


    if(
      db.prepare(
        'SELECT id FROM users WHERE email=?'
      )
      .get(
        t.email
      )
    ){

      return json(
        res,
        409,
        {
          error:
            'Email hii tayari ipo kwenye mfumo.'
        }
      );

    }


    const randomPassword =
      crypto
        .randomBytes(32)
        .toString('base64url');


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
        t.email,
        hash(
          randomPassword
        ),
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


    db.prepare(`
      INSERT INTO oauth_identities
      (
        provider,
        subject,
        user_id,
        email
      )
      VALUES(?,?,?,?)
    `)
    .run(
      t.provider,
      t.subject,
      uid,
      t.email
    );


    db.prepare(
      'DELETE FROM oauth_tickets WHERE token=?'
    )
    .run(
      token
    );


    audit(
      bid,
      uid,
      'OAUTH_REGISTER',
      `New ${role} via ${t.provider}`
    );


    return json(
      res,
      201,
      {
        token:
          session(
            uid
          ),

        user:{
          id:uid,

          full_name:
            name,

          phone,

          email:
            t.email,

          role,

          business_id:
            bid
        },

        business:{
          name:
            biz.name,

          code:
            biz.code,

          location:
            biz.location
        }
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
      email(
        x.email
      );


    const pw =
      String(
        x.password || ''
      );


    const u =
      db.prepare(
        'SELECT * FROM users WHERE email=?'
      )
      .get(
        e
      );


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


    if(
      u.business_id
    ){

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
          session(
            u.id
          ),

        user:{

          id:
            u.id,

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
      .get(
        e
      )
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


      const businessType =
        clean(
          x.businessType
        );


      const businessPhone =
        clean(
          x.businessPhone
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


      const loc =
        clean(
          x.businessLocation
        );


      if(
        !bn ||
        !businessType ||
        !businessPhone ||
        !region ||
        !district ||
        !ward ||
        !loc
      ){

        return json(
          res,
          400,
          {
            error:
              'Jina la biashara, aina ya biashara, simu ya biashara, Mkoa, Wilaya, Kata na eneo la biashara vinahitajika.'
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
            business_type,
            business_phone,
            region,
            district,
            ward
          )
          VALUES(?,?,?,?,?,?,?,?)
        `)
        .run(
          bn,
          c,
          loc,
          businessType,
          businessPhone,
          region,
          district,
          ward
        );


      bid =
        Number(
          r.lastInsertRowid
        );


      biz =
        db.prepare(
          'SELECT * FROM businesses WHERE id=?'
        )
        .get(
          bid
        );

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
        .get(
          bc
        );


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
          session(
            uid
          ),

        user:{

          id:
            uid,

          full_name:
            name,

          phone,

          email:
            e,

          role,

          business_id:
            bid

        },

        business:{

          name:
            biz.name,

          code:
            biz.code,

          location:
            biz.location,

          business_type:
            biz.business_type,

          business_phone:
            biz.business_phone,

          region:
            biz.region,

          district:
            biz.district,

          ward:
            biz.ward

        }

      }
    );

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


    return json(
      res,
      200,
      {

        user:
          u,

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
                  business_type,
                  business_phone,
                  region,
                  district,
                  ward

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
        products:
          rows
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
      await body(
        req
      );


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
            'Bidhaa haijapatikana.'
        }
      );

    }


    const name =
      clean(
        x.name
      ) ||
      old.name;


    const buyPrice =
      Number(
        x.buy_price ??
        old.buy_price
      );


    const sellPrice =
      Number(
        x.sell_price ??
        old.sell_price
      );


    const quantity =
      Number(
        x.quantity ??
        old.quantity
      );


    const minStock =
      Number(
        x.min_stock ??
        old.min_stock
      );


    const categoryId =
      x.category_id === undefined
        ? old.category_id
        : (
            x.category_id === null ||
            x.category_id === ''
              ? null
              : Number(
                  x.category_id
                )
          );


    if(
      !name ||
      !Number.isFinite(buyPrice) ||
      !Number.isFinite(sellPrice) ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(minStock)
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


    db.prepare(`
      UPDATE products
      SET
        name=?,
        buy_price=?,
        sell_price=?,
        quantity=?,
        min_stock=?,
        category_id=?
      WHERE id=?
      AND business_id=?
    `)
    .run(
      name,
      buyPrice,
      sellPrice,
      quantity,
      minStock,
      categoryId,
      id,
      u.business_id
    );


    audit(
      u.business_id,
      u.id,
      'PRODUCT_UPDATE',
      String(id)
    );


    return json(
      res,
      200,
      {
        ok:true
      }
    );

  }
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
            'Bidhaa haijapatikana.'
        }
      );

    }


    const x =
      await body(req);


    const name =
      clean(
        x.name
      ) ||
      old.name;


    const buyPrice =
      Number(
        x.buy_price ??
        old.buy_price
      );


    const sellPrice =
      Number(
        x.sell_price ??
        old.sell_price
      );


    const quantity =
      Number(
        x.quantity ??
        old.quantity
      );


    const minStock =
      Number(
        x.min_stock ??
        old.min_stock
      );


    const categoryId =
      x.category_id === undefined
        ? old.category_id
        :
          (
            x.category_id === null ||
            x.category_id === ''
              ? null
              : Number(
                  x.category_id
                )
          );


    if(
      !name ||
      !Number.isFinite(buyPrice) ||
      !Number.isFinite(sellPrice) ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(minStock)
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


    db.prepare(`
      UPDATE products
      SET
        name=?,
        buy_price=?,
        sell_price=?,
        quantity=?,
        min_stock=?,
        category_id=?
      WHERE id=?
      AND business_id=?
    `)
    .run(
      name,
      buyPrice,
      sellPrice,
      quantity,
      minStock,
      categoryId,
      id,
      u.business_id
    );


    audit(
      u.business_id,
      u.id,
      'PRODUCT_UPDATE',
      String(id)
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


    const name =
      clean(
        x.name
      );


    const buyPrice =
      Number(
        x.buy_price
      );


    const sellPrice =
      Number(
        x.sell_price
      );


    const quantity =
      Number(
        x.quantity || 0
      );


    const minStock =
      Number(
        x.min_stock ?? 5
      );


    const categoryId =
      x.category_id === null ||
      x.category_id === undefined ||
      x.category_id === ''
        ? null
        : Number(
            x.category_id
          );


    if(
      !name ||
      !Number.isFinite(buyPrice) ||
      !Number.isFinite(sellPrice) ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(minStock)
    ){

      return json(
        res,
        400,
        {
          error:
            'Jaza taarifa sahihi za bidhaa.'
        }
      );

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
        name,
        buyPrice,
        sellPrice,
        quantity,
        minStock,
        categoryId
      );


    const id =
      Number(
        r.lastInsertRowid
      );


    if(
      quantity > 0
    ){

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
        'INITIAL',
        quantity,
        'Initial stock',
        u.id
      );

    }


    audit(
      u.business_id,
      u.id,
      'PRODUCT_CREATE',
      String(id)
    );


    return json(
      res,
      201,
      {
        ok:true,
        id
      }
    );

  }


  /* =======================================================
     PRODUCT DELETE
     ======================================================= */

  if(
    p.startsWith('/api/products/') &&
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


    const id =
      Number(
        p.split('/').pop()
      );


    const r =
      db.prepare(`
        UPDATE products
        SET active=0
        WHERE id=?
        AND business_id=?
      `)
      .run(
        id,
        u.business_id
      );


    if(
      !r.changes
    ){

      return json(
        res,
        404,
        {
          error:
            'Bidhaa haijapatikana.'
        }
      );

    }


    audit(
      u.business_id,
      u.id,
      'PRODUCT_DELETE',
      String(id)
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


    const rows =
      db.prepare(`
        SELECT *
        FROM categories
        WHERE business_id=?
        ORDER BY name
      `)
      .all(
        u.business_id
      );


    return json(
      res,
      200,
      {
        categories:
          rows
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


    const x =
      await body(req);


    const name =
      clean(
        x.name
      );


    if(!name){

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
          name
        );


      return json(
        res,
        201,
        {
          ok:true,
          id:
            Number(
              r.lastInsertRowid
            )
        }
      );

    }catch(e){

      return json(
        res,
        409,
        {
          error:
            'Category hiyo tayari ipo.'
        }
      );

    }

  }


  /* =======================================================
     STOCK
     ======================================================= */

  if(
    p === '/api/stock/movement' &&
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


    const productId =
      Number(
        x.product_id
      );


    const quantity =
      Number(
        x.quantity
      );


    const type =
      clean(
        x.type
      ).toUpperCase();


    if(
      !Number.isInteger(productId) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ){

      return json(
        res,
        400,
        {
          error:
            'Stock movement si sahihi.'
        }
      );

    }


    const product =
      db.prepare(`
        SELECT *
        FROM products
        WHERE id=?
        AND business_id=?
        AND active=1
      `)
      .get(
        productId,
        u.business_id
      );


    if(!product){

      return json(
        res,
        404,
        {
          error:
            'Bidhaa haijapatikana.'
        }
      );

    }


    let newQuantity =
      product.quantity;


    if(
      type === 'IN' ||
      type === 'PURCHASE' ||
      type === 'ADD'
    ){

      newQuantity += quantity;

    }else if(
      type === 'OUT' ||
      type === 'REMOVE'
    ){

      if(
        product.quantity < quantity
      ){

        return json(
          res,
          400,
          {
            error:
              'Stock haitoshi.'
          }
        );

      }

      newQuantity -= quantity;

    }else{

      return json(
        res,
        400,
        {
          error:
            'Stock movement type si sahihi.'
        }
      );

    }


    db.prepare(`
      UPDATE products
      SET quantity=?
      WHERE id=?
      AND business_id=?
    `)
    .run(
      newQuantity,
      productId,
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
      productId,
      type,
      quantity,
      clean(
        x.reference
      ),
      u.id
    );


    audit(
      u.business_id,
      u.id,
      'STOCK_MOVEMENT',
      `${productId}:${type}:${quantity}`
    );


    return json(
      res,
      200,
      {
        ok:true,
        quantity:
          newQuantity
      }
    );

  }
/* =======================================================
   SALES
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


  const rows =
    db.prepare(`
      SELECT *
      FROM sales
      WHERE business_id=?
      ORDER BY created_at DESC
      LIMIT 500
    `)
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
   CREATE SALE
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
    await body(
      req
    );


  const productId =
    Number(
      x.product_id
    );


  const quantity =
    Number(
      x.quantity
    );


  const discount =
    Number(
      x.discount || 0
    );


  const paymentMethod =
    clean(
      x.payment_method ||
      'cash'
    );


  if(
    !Number.isInteger(productId) ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ){

    return json(
      res,
      400,
      {
        error:
          'Bidhaa na quantity si sahihi.'
      }
    );

  }


  const product =
    db.prepare(`
      SELECT *
      FROM products
      WHERE id=?
      AND business_id=?
      AND active=1
    `)
    .get(
      productId,
      u.business_id
    );


  if(!product){

    return json(
      res,
      404,
      {
        error:
          'Bidhaa haijapatikana.'
      }
    );

  }


  if(
    product.quantity < quantity
  ){

    return json(
      res,
      400,
      {
        error:
          `Stock haitoshi. Iliyopo ni ${product.quantity}.`
      }
    );

  }


  if(
    !Number.isFinite(discount) ||
    discount < 0
  ){

    return json(
      res,
      400,
      {
        error:
          'Discount si sahihi.'
      }
    );

  }


  const subtotal =
    product.sell_price *
    quantity;


  const total =
    Math.max(
      0,
      subtotal - discount
    );


  const customerId =
    x.customer_id === undefined ||
    x.customer_id === null ||
    x.customer_id === ''
      ? null
      : Number(
          x.customer_id
        );


  let customerName =
    clean(
      x.customer_name
    );


  if(
    customerId
  ){

    const c =
      db.prepare(`
        SELECT *
        FROM customers
        WHERE id=?
        AND business_id=?
      `)
      .get(
        customerId,
        u.business_id
      );


    if(!c){

      return json(
        res,
        404,
        {
          error:
            'Customer haijapatikana.'
        }
      );

    }


    customerName =
      c.name;

  }


  const sale =
    transaction(
      ()=>{

        const r =
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
            product.id,
            product.name,
            customerId,
            quantity,
            product.sell_price,
            product.buy_price,
            discount,
            total,
            u.id,
            u.full_name,
            paymentMethod
          );


        const saleId =
          Number(
            r.lastInsertRowid
          );


        db.prepare(`
          UPDATE products
          SET quantity=quantity-?
          WHERE id=?
          AND business_id=?
        `)
        .run(
          quantity,
          product.id,
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
          product.id,
          'SALE',
          quantity,
          `SALE-${saleId}`,
          u.id
        );


        audit(
          u.business_id,
          u.id,
          'SALE_CREATE',
          String(saleId)
        );


        return saleId;

      }
    );


  return json(
    res,
    201,
    {
      ok:true,
      saleId:sale
    }
  );

}


/* =======================================================
   SALE RETURN / UNDO SALE
   ======================================================= */

if(
  p.startsWith('/api/sales/') &&
  p.endsWith('/return') &&
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


  const parts =
    p.split('/');


  const saleId =
    Number(
      parts[
        parts.length-2
      ]
    );


  const x =
    await body(
      req
    );


  const reason =
    clean(
      x.reason ||
      'Sale reversed'
    );


  const sale =
    db.prepare(`
      SELECT *
      FROM sales
      WHERE id=?
      AND business_id=?
    `)
    .get(
      saleId,
      u.business_id
    );


  if(!sale){

    return json(
      res,
      404,
      {
        error:
          'Sale haijapatikana.'
      }
    );

  }


  const alreadyReturned =
    db.prepare(`
      SELECT
        COALESCE(
          SUM(quantity),
          0
        ) quantity

      FROM sale_returns

      WHERE sale_id=?
    `)
    .get(
      saleId
    );


  const returned =
    Number(
      alreadyReturned?.quantity ||
      0
    );


  const remaining =
    sale.quantity -
    returned;


  if(
    remaining <= 0
  ){

    return json(
      res,
      400,
      {
        error:
          'Sale hii tayari imerudishwa.'
      }
    );

  }


  const r =
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
          sale.id,
          sale.product_id,
          remaining,
          sale.total,
          reason,
          u.id
        );


        db.prepare(`
          UPDATE products
          SET quantity=quantity+?
          WHERE id=?
          AND business_id=?
        `)
        .run(
          remaining,
          sale.product_id,
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
          sale.product_id,
          'RETURN',
          remaining,
          `RETURN-${sale.id}`,
          u.id
        );


        audit(
          u.business_id,
          u.id,
          'SALE_RETURN',
          String(sale.id)
        );


        return true;

      }
    );


  return json(
    res,
    200,
    {
      ok:r
    }
  );

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


  const rows =
    db.prepare(`
      SELECT *
      FROM customers
      WHERE business_id=?
      ORDER BY name
    `)
    .all(
      u.business_id
    );


  return json(
    res,
    200,
    {
      customers:
        rows
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
    await body(
      req
    );


  const name =
    clean(
      x.name
    );


  const phone =
    clean(
      x.phone
    );


  const address =
    clean(
      x.address
    );


  if(!name){

    return json(
      res,
      400,
      {
        error:
          'Jina la customer linahitajika.'
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
      name,
      phone,
      address
    );


  return json(
    res,
    201,
    {
      ok:true,
      id:
        Number(
          r.lastInsertRowid
        )
    }
  );

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


  const rows =
    db.prepare(`
      SELECT *
      FROM expenses
      WHERE business_id=?
      ORDER BY created_at DESC
      LIMIT 500
    `)
    .all(
      u.business_id
    );


  return json(
    res,
    200,
    {
      expenses:
        rows
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
    await body(
      req
    );


  const description =
    clean(
      x.description
    );


  const category =
    clean(
      x.category
    );


  const amount =
    Number(
      x.amount
    );


  if(
    !description ||
    !Number.isFinite(amount) ||
    amount <= 0
  ){

    return json(
      res,
      400,
      {
        error:
          'Maelezo na kiasi cha matumizi vinahitajika.'
      }
    );

  }


  const r =
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
      description,
      category,
      amount,
      u.id,
      u.full_name
    );


  audit(
    u.business_id,
    u.id,
    'EXPENSE_CREATE',
    String(
      r.lastInsertRowid
    )
  );


  return json(
    res,
    201,
    {
      ok:true,
      id:
        Number(
          r.lastInsertRowid
        )
    }
  );

}
