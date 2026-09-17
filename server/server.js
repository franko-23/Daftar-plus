const express=require('express');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const {OAuth2Client}=require('google-auth-library');
const {DatabaseSync}=require('node:sqlite');

const app=express();
const PORT=Number(process.env.PORT||10000);
const DATA_DIR=process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : path.join(__dirname,'data');
const DB_FILE=path.join(DATA_DIR,'daftari.sqlite');
const LEGACY_DB_FILE=path.join(DATA_DIR,'db.json');
const BACKUP_DIR=path.join(DATA_DIR,'backups');
fs.mkdirSync(DATA_DIR,{recursive:true});
fs.mkdirSync(BACKUP_DIR,{recursive:true});

const production=process.env.NODE_ENV==='production';
const jwtSecret=String(process.env.JWT_SECRET||'');
if(production && jwtSecret.length<32) throw new Error('JWT_SECRET must be at least 32 characters in production.');
const SECRET=jwtSecret || crypto.randomBytes(48).toString('hex');
if(production){for(const k of ['SUPER_ADMIN_EMAIL','SUPER_ADMIN_PASSWORD_HASH','APP_BASE_URL'])if(!String(process.env[k]||'').trim())throw new Error(`${k} must be configured in production.`);}

// Small dependency-free rate limiter for auth endpoints. It protects the single Render instance
// without adding another runtime dependency; deploy multiple instances behind a shared limiter in larger environments.
const rateBuckets=new Map();
function rateLimit({windowMs=15*60*1000,max=60}={}){return (req,res,next)=>{const key=`${req.ip||'unknown'}:${req.path}`;const t=Date.now();let b=rateBuckets.get(key);if(!b||t-b.start>windowMs)b={start:t,count:0};b.count++;rateBuckets.set(key,b);if(b.count>max){res.set('Retry-After',String(Math.ceil((b.start+windowMs-t)/1000)));return res.status(429).json({error:'Maombi mengi sana. Jaribu tena baadae.'});}next();};}
setInterval(()=>{const cutoff=Date.now()-30*60*1000;for(const [k,v] of rateBuckets)if(v.start<cutoff)rateBuckets.delete(k);},10*60*1000).unref();

app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true,limit:'200kb'}));
app.use(express.static(path.join(__dirname,'..','public'),{index:'index.html',maxAge:production?'1h':0}));

const defaults=()=>({users:[],businesses:[],products:[],categories:[],customers:[],sales:[],expenses:[],debts:[],debt_payments:[],payments:[],employees:[],revoked_tokens:[],plans:[
  {id:'monthly',code:'monthly',name:'Daftari+ Monthly',price:50000,regular_price_tzs:50000,current_price_tzs:50000,currency:'TZS',days:30,active:true,promotion_name:'Mpango wa mwezi',features:['Dashboard ya biashara','Mauzo na stock','Madeni na matumizi','Ripoti za biashara']},
  {id:'quarterly',code:'quarterly',name:'Daftari+ Quarterly',price:120000,regular_price_tzs:150000,current_price_tzs:120000,currency:'TZS',days:90,active:true,promotion_name:'Mpango wa miezi 3',features:['Vipengele vyote vya biashara','Ripoti na analytics','Usimamizi wa timu']},
  {id:'yearly',code:'yearly',name:'Daftari+ Yearly',price:400000,regular_price_tzs:600000,current_price_tzs:400000,currency:'TZS',days:365,active:true,promotion_name:'Mpango wa mwaka',features:['Vipengele vyote vya biashara','Ripoti na analytics','Usimamizi wa timu','Support']}
],audit_logs:[]});
// SQLite-backed state store. The application keeps the existing object model so the
// frontend/API remain compatible, while persistence is ACID and survives concurrent writes.
const sqlite=new DatabaseSync(DB_FILE);
sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_backups (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, path TEXT NOT NULL, version INTEGER NOT NULL);`);
function normalizeState(raw){
  const base=defaults(); const out={...base,...(raw&&typeof raw==='object'?raw:{})};
  for(const k of Object.keys(base)) if(!Array.isArray(out[k])) out[k]=base[k];
  for(const p of out.plans){p.code=p.code||p.id;p.currency=p.currency||'TZS';p.price=Number(p.price??p.current_price_tzs??0);p.current_price_tzs=Number(p.current_price_tzs??p.price);p.regular_price_tzs=Number(p.regular_price_tzs??p.price);p.discount_percent=Number(p.discount_percent??0);p.days=Number(p.days||30);p.active=p.active!==false;p.features=Array.isArray(p.features)?p.features:[];}
  return out;
}
function loadStateFromSqlite(){
  const row=sqlite.prepare('SELECT version,payload FROM app_state WHERE id=1').get();
  if(row?.payload){try{return {state:normalizeState(JSON.parse(row.payload)),version:Number(row.version)||1};}catch{}}
  let legacy=null;
  if(fs.existsSync(LEGACY_DB_FILE)){try{legacy=JSON.parse(fs.readFileSync(LEGACY_DB_FILE,'utf8'));}catch{legacy=null;}}
  const state=normalizeState(legacy||defaults());
  sqlite.prepare('INSERT OR REPLACE INTO app_state(id,version,updated_at,payload) VALUES(1,?,?,?)').run(1,new Date().toISOString(),JSON.stringify(state));
  if(legacy) try{fs.renameSync(LEGACY_DB_FILE,LEGACY_DB_FILE+'.migrated-'+Date.now()+'.bak')}catch{}
  return {state,version:1};
}
let loaded=loadStateFromSqlite();
let db=loaded.state;
let stateVersion=loaded.version;
function saveDB(){
  const payload=JSON.stringify(db);
  const nextVersion=stateVersion+1;
  sqlite.exec('BEGIN IMMEDIATE');
  try{
    sqlite.prepare('UPDATE app_state SET version=?,updated_at=?,payload=? WHERE id=1').run(nextVersion,new Date().toISOString(),payload);
    sqlite.exec('COMMIT');
    stateVersion=nextVersion;
  }catch(e){
    try{sqlite.exec('ROLLBACK')}catch{}
    throw e;
  }
}
function backupDB(){
  try{
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const dest=path.join(BACKUP_DIR,`daftari-${stamp}.sqlite`);
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(DB_FILE,dest);
    sqlite.prepare('INSERT INTO app_backups(created_at,path,version) VALUES(?,?,?)').run(new Date().toISOString(),dest,stateVersion);
    const files=fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith('.sqlite')).sort();
    for(const f of files.slice(0,Math.max(0,files.length-7)))try{fs.unlinkSync(path.join(BACKUP_DIR,f))}catch{}
  }catch(e){console.error('SQLite backup failed:',e.message)}
}
backupDB();
setInterval(backupDB,6*60*60*1000).unref();
const now=()=>new Date().toISOString(),id=()=>crypto.randomUUID();
const safeUser=u=>({id:u.id,full_name:u.full_name,email:u.email,phone:u.phone||'',role:u.role,business_id:u.business_id||null,status:u.status,provider:u.provider||'email',created_at:u.created_at,last_login:u.last_login||null});
function issueToken(u){return jwt.sign({sub:u.id,role:u.role,business_id:u.business_id||null,jti:id()},SECRET,{expiresIn:'7d',issuer:'daftari-plus',audience:'daftari-plus-app'})}
function verifyToken(t){return jwt.verify(t,SECRET,{issuer:'daftari-plus',audience:'daftari-plus-app'})}
function auth(req,res,next){const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):null;if(!t)return res.status(401).json({error:'Login inahitajika'});try{req.auth=verifyToken(t);if(req.auth.jti&&db.revoked_tokens.some(x=>x.jti===req.auth.jti))throw 0;const u=db.users.find(x=>x.id===req.auth.sub);if(!u||u.status!=='active')throw 0;if(u.business_id){const b=db.businesses.find(x=>x.id===u.business_id);if(!b||b.status!=='active')return res.status(403).json({error:'Biashara hii haijawezeshwa kwa sasa.'});}req.user=u;next()}catch{res.status(401).json({error:'Session imekwisha. Ingia tena.'})}}
function superOnly(req,res,next){if(req.user.role!=='super_admin')return res.status(403).json({error:'Super Admin only'});next()}
function biz(req,res,next){if(!['owner','saler'].includes(req.user.role)||!req.user.business_id)return res.status(403).json({error:'Business access required'});next()}
function owner(req,res,next){if(req.user.role!=='owner')return res.status(403).json({error:'Owner only'});next()}
function audit(actor,action,entity,entityId,meta={}){const u=actor?.user||actor;db.audit_logs.push({id:id(),user_id:u?.id||null,business_id:u?.business_id||null,action,entity,entity_id:entityId,meta,created_at:now()});if(db.audit_logs.length>5000)db.audit_logs.shift()}
function dateMatch(iso,from,to){const d=String(iso||'').slice(0,10);return(!from||d>=from)&&(!to||d<=to)}
function adminPasswordOK(password){const hash=String(process.env.SUPER_ADMIN_PASSWORD_HASH||'');if(hash){try{return bcrypt.compareSync(password,hash)}catch{return false}}if(production)return false;const plain=String(process.env.SUPER_ADMIN_PASSWORD||'');const a=Buffer.from(password),b=Buffer.from(plain);return !!plain&&a.length===b.length&&crypto.timingSafeEqual(a,b);}
function makeOAuthState(provider){return jwt.sign({provider,nonce:crypto.randomBytes(16).toString('hex')},SECRET,{expiresIn:'10m',issuer:'daftari-plus',audience:'daftari-oauth'})}
function verifyOAuthState(state,provider){const p=jwt.verify(String(state||''),SECRET,{issuer:'daftari-plus',audience:'daftari-oauth'});if(p.provider!==provider)throw new Error('OAuth state invalid');return p}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'Daftari+',time:now()}));
app.get('/api/auth/config',(req,res)=>res.json({google:!!process.env.GOOGLE_CLIENT_ID,apple:!!process.env.APPLE_CLIENT_ID}));

app.post('/api/register',rateLimit({max:30}),async(req,res)=>{try{
  const {fullName,phone,email,password,role='owner',businessName,businessType,businessPhone,country,region,district,ward,businessLocation,businessCode}=req.body;
  const normalizedEmail=String(email||'').toLowerCase().trim();
  if(!String(fullName||'').trim()||!String(phone||'').trim()||!normalizedEmail||!password)return res.status(400).json({error:'Jaza taarifa zote muhimu.'});
  if(!/^\S+@\S+\.\S+$/.test(normalizedEmail))return res.status(400).json({error:'Barua pepe si sahihi.'});
  if(String(password).length<8)return res.status(400).json({error:'Nywila iwe na angalau herufi 8.'});
  if(db.users.some(u=>u.email&&u.email.toLowerCase()===normalizedEmail))return res.status(409).json({error:'Email hii tayari imesajiliwa.'});
  if(!['owner','saler'].includes(role))return res.status(400).json({error:'Role si sahihi.'});
  let business;
  if(role==='owner'){
    if(!String(businessName||'').trim())return res.status(400).json({error:'Weka jina la biashara.'});
    business={id:id(),name:String(businessName).trim(),type:String(businessType||''),phone:String(businessPhone||''),country:String(country||'Tanzania'),region:String(region||''),district:String(district||''),ward:String(ward||''),location:String(businessLocation||''),code:'DF-'+crypto.randomBytes(4).toString('hex').toUpperCase(),status:'active',created_at:now()};
    db.businesses.push(business);
  }else{
    business=db.businesses.find(b=>b.code===String(businessCode||'').trim().toUpperCase()&&b.status==='active');
    if(!business)return res.status(400).json({error:'Business Code si sahihi.'});
  }
  const u={id:id(),full_name:String(fullName).trim(),phone:String(phone).trim(),email:normalizedEmail,password_hash:await bcrypt.hash(String(password),12),role,business_id:business.id,status:'active',provider:'email',created_at:now(),last_login:now()};
  db.users.push(u);audit(u,'register','user',u.id,{provider:'email',role});saveDB();
  res.status(201).json({token:issueToken(u),user:safeUser(u),business});
}catch(e){res.status(500).json({error:'Imeshindikana kusajili akaunti.'})}});

async function loginWithPassword(email,password){
  const u=db.users.find(x=>x.email===email&&x.status==='active');
  if(!u||!u.password_hash||!(await bcrypt.compare(password,u.password_hash)))return null;
  u.last_login=now();saveDB();return u;
}
app.post('/api/login',rateLimit({max:20}),async(req,res)=>{const email=String(req.body.email||'').toLowerCase().trim(),password=String(req.body.password||'');
  if(email===String(process.env.SUPER_ADMIN_EMAIL||'').toLowerCase()&&adminPasswordOK(password)){let sa=db.users.find(x=>x.role==='super_admin');if(!sa){sa={id:'super-admin',full_name:'Super Admin',email,phone:'',role:'super_admin',business_id:null,status:'active',provider:'email',created_at:now(),last_login:now()};db.users.push(sa)}sa.last_login=now();saveDB();return res.json({token:issueToken(sa),user:safeUser(sa)})}
  const u=await loginWithPassword(email,password);if(!u)return res.status(401).json({error:'Email au password si sahihi.'});res.json({token:issueToken(u),user:safeUser(u)});
});

function oauthUser({name,email,provider,providerId}){let u=db.users.find(x=>x.provider===provider&&x.provider_id===providerId)||db.users.find(x=>x.email&&email&&x.email.toLowerCase()===email.toLowerCase());if(u){u.provider=provider;u.provider_id=providerId;u.full_name=u.full_name||name||'';u.last_login=now();saveDB();return u}u={id:id(),full_name:name||'',email:(email||'').toLowerCase(),phone:'',password_hash:null,role:'owner',business_id:null,status:'profile_incomplete',provider,provider_id:providerId,created_at:now(),last_login:now()};db.users.push(u);saveDB();return u}
app.get('/api/auth/google/start',rateLimit({max:20}),async(req,res)=>{if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET)return res.status(503).send('Google OAuth haijawekwa kwenye environment variables.');const redirect=process.env.GOOGLE_REDIRECT_URI||`${process.env.APP_BASE_URL||`http://localhost:${PORT}`}/api/auth/google/callback`;const state=makeOAuthState('google');const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid email profile',state,access_type:'offline',prompt:'select_account'});res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+q)});
app.get('/api/auth/google/callback',async(req,res)=>{try{verifyOAuthState(req.query.state,'google');if(!req.query.code)throw Error('Google authorization haikukamilika.');const redirect=process.env.GOOGLE_REDIRECT_URI||`${process.env.APP_BASE_URL||`http://localhost:${PORT}`}/api/auth/google/callback`;const c=new OAuth2Client(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirect);const {tokens}=await c.getToken(req.query.code);const ticket=await c.verifyIdToken({idToken:tokens.id_token,audience:process.env.GOOGLE_CLIENT_ID});const p=ticket.getPayload();if(!p?.sub||!p?.email)throw Error('Google profile haijakamilika.');const u=oauthUser({name:p.name,email:p.email,provider:'google',providerId:p.sub});res.redirect(`/oauth-complete.html?token=${encodeURIComponent(issueToken(u))}&profile=${u.business_id?'complete':'incomplete'}`)}catch(e){res.status(400).send('Google login imeshindikana. Tafadhali jaribu tena.')}});
async function verifyAppleIdToken(token){
  const parts=String(token||'').split('.');if(parts.length!==3)throw new Error('Apple ID token si sahihi.');
  const decode=(x)=>JSON.parse(Buffer.from(x.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));
  const header=decode(parts[0]),payload=decode(parts[1]);
  if(!header.kid||header.alg!=='RS256')throw new Error('Apple token algorithm si sahihi.');
  const r=await fetch('https://appleid.apple.com/auth/keys');if(!r.ok)throw new Error('Apple keys hazipatikani.');const jwks=await r.json();
  const jwk=(jwks.keys||[]).find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)throw new Error('Apple signing key haipatikani.');
  const key=crypto.createPublicKey({key:jwk,format:'jwk'});const data=Buffer.from(`${parts[0]}.${parts[1]}`);const sig=Buffer.from(parts[2].replace(/-/g,'+').replace(/_/g,'/'),'base64');
  if(!crypto.verify('RSA-SHA256',data,key,sig))throw new Error('Apple token signature invalid.');
  const nowSec=Math.floor(Date.now()/1000);if(payload.iss!=='https://appleid.apple.com'||payload.aud!==process.env.APPLE_CLIENT_ID||Number(payload.exp||0)<nowSec)throw new Error('Apple token claims invalid.');
  return payload;
}
function appleClientSecret(){const key=(process.env.APPLE_PRIVATE_KEY||'').replace(/\\n/g,'\n');if(!key)return null;const n=Math.floor(Date.now()/1000);return jwt.sign({iss:process.env.APPLE_TEAM_ID,iat:n,exp:n+86400,aud:'https://appleid.apple.com',sub:process.env.APPLE_CLIENT_ID},key,{algorithm:'ES256',header:{kid:process.env.APPLE_KEY_ID}})}
app.get('/api/auth/apple/start',rateLimit({max:20}),async(req,res)=>{if(!process.env.APPLE_CLIENT_ID||!process.env.APPLE_TEAM_ID||!process.env.APPLE_KEY_ID||!process.env.APPLE_PRIVATE_KEY)return res.status(503).send('Apple Sign in haijawekwa kwenye environment variables.');const redirect=process.env.APPLE_REDIRECT_URI||`${process.env.APP_BASE_URL||`http://localhost:${PORT}`}/api/auth/apple/callback`;const state=makeOAuthState('apple');res.redirect('https://appleid.apple.com/auth/authorize?'+new URLSearchParams({client_id:process.env.APPLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',response_mode:'form_post',scope:'name email',state}))});
app.post('/api/auth/apple/callback',async(req,res)=>{try{verifyOAuthState(req.body.state,'apple');if(!req.body.code)throw Error('Apple authorization haikukamilika.');const redirect=process.env.APPLE_REDIRECT_URI||`${process.env.APP_BASE_URL||`http://localhost:${PORT}`}/api/auth/apple/callback`,secret=appleClientSecret();if(!secret)throw Error('Apple credentials hazijawekwa.');const body=new URLSearchParams({client_id:process.env.APPLE_CLIENT_ID,client_secret:secret,code:req.body.code,grant_type:'authorization_code',redirect_uri:redirect});const r=await fetch('https://appleid.apple.com/auth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const t=await r.json();if(!r.ok||!t.id_token)throw Error(t.error||'Apple token exchange failed');const payload=await verifyAppleIdToken(t.id_token);if(!payload.sub||!payload.email)throw Error('Apple identity haijathibitishwa.');let name={};try{name=req.body.user?JSON.parse(req.body.user):{}}catch{}const display=[name.name?.firstName,name.name?.lastName].filter(Boolean).join(' ')||'Daftari+ User';const u=oauthUser({name:display,email:payload.email,provider:'apple',providerId:payload.sub});res.redirect(`/oauth-complete.html?token=${encodeURIComponent(issueToken(u))}&profile=${u.business_id?'complete':'incomplete'}`)}catch(e){res.status(400).send('Apple login imeshindikana. Tafadhali jaribu tena.')}});

app.get('/api/me',auth,(req,res)=>res.json({user:safeUser(req.user),business:req.user.business_id?db.businesses.find(b=>b.id===req.user.business_id):null}));
app.post('/api/logout',auth,(req,res)=>{if(req.auth?.jti){db.revoked_tokens.push({jti:req.auth.jti,revoked_at:now(),expires_at:req.auth.exp?new Date(req.auth.exp*1000).toISOString():null});if(db.revoked_tokens.length>5000)db.revoked_tokens.shift();saveDB();}res.json({ok:true});});
app.post('/api/oauth/complete',auth,async(req,res)=>{const u=req.user;if(u.status!=='profile_incomplete'&&u.business_id)return res.json({user:safeUser(u),business:db.businesses.find(b=>b.id===u.business_id)});const {fullName,phone,businessName,businessType,businessPhone,country,region,district,ward,businessLocation}=req.body;if(!String(fullName||'').trim()||!String(phone||'').trim()||!String(businessName||'').trim())return res.status(400).json({error:'Jaza jina, simu na jina la biashara.'});const b={id:id(),name:String(businessName).trim(),type:String(businessType||''),phone:String(businessPhone||''),country:String(country||'Tanzania'),region:String(region||''),district:String(district||''),ward:String(ward||''),location:String(businessLocation||''),code:'DF-'+crypto.randomBytes(4).toString('hex').toUpperCase(),status:'active',created_at:now()};db.businesses.push(b);Object.assign(u,{full_name:String(fullName).trim(),phone:String(phone).trim(),business_id:b.id,status:'active',last_login:now()});audit(u,'complete_profile','user',u.id);saveDB();res.json({token:issueToken(u),user:safeUser(u),business:b})});
// Core business APIs
app.get('/api/products',auth,biz,(req,res)=>{const ps=db.products.filter(p=>p.business_id===req.user.business_id&&p.status!=='deleted').map(p=>({...p,category_name:db.categories.find(c=>c.id===p.category_id)?.name||''}));res.json({products:ps})});
app.post('/api/products',auth,biz,owner,(req,res)=>{const {name,buyPrice,sellPrice,quantity=0,minStock=5,categoryId}=req.body;if(!name||Number(sellPrice)<0||Number(buyPrice)<0||Number(quantity)<0)return res.status(400).json({error:'Taarifa za bidhaa si sahihi.'});const p={id:id(),business_id:req.user.business_id,name:String(name).trim(),buy_price:Number(buyPrice),sell_price:Number(sellPrice),quantity:Number(quantity),min_stock:Number(minStock),category_id:categoryId||null,status:'active',created_at:now(),updated_at:now()};db.products.push(p);audit(req,'create','product',p.id);saveDB();res.status(201).json({product:p})});
app.patch('/api/products/:id',auth,biz,owner,(req,res)=>{const p=db.products.find(x=>x.id===req.params.id&&x.business_id===req.user.business_id);if(!p)return res.status(404).json({error:'Bidhaa haipo'});for(const [k,v] of Object.entries({name:req.body.name,buy_price:req.body.buyPrice,sell_price:req.body.sellPrice,quantity:req.body.quantity,min_stock:req.body.minStock,category_id:req.body.categoryId}))if(v!==undefined)p[k]=['buy_price','sell_price','quantity','min_stock'].includes(k)?Number(v):v;p.updated_at=now();audit(req,'update','product',p.id);saveDB();res.json({product:p})});
app.delete('/api/products/:id',auth,biz,owner,(req,res)=>{const p=db.products.find(x=>x.id===req.params.id&&x.business_id===req.user.business_id);if(!p)return res.status(404).json({error:'Bidhaa haipo'});p.status='deleted';audit(req,'delete','product',p.id);saveDB();res.json({ok:true})});
app.get('/api/customers',auth,biz,(req,res)=>res.json({customers:db.customers.filter(x=>x.business_id===req.user.business_id&&x.status!=='deleted')}));
app.post('/api/customers',auth,biz,(req,res)=>{if(!req.body.name)return res.status(400).json({error:'Jina la mteja linahitajika'});const c={id:id(),business_id:req.user.business_id,name:String(req.body.name),phone:req.body.phone||'',created_at:now(),status:'active'};db.customers.push(c);saveDB();res.status(201).json({customer:c})});
app.get('/api/sales',auth,biz,(req,res)=>{const out=db.sales.filter(s=>s.business_id===req.user.business_id&&s.status!=='voided').map(s=>({...s,product_name:db.products.find(p=>p.id===s.product_id)?.name||s.product_name||'',seller_name:db.users.find(u=>u.id===s.seller_id)?.full_name||''}));res.json({sales:out})});
app.post('/api/sales',auth,biz,(req,res)=>{const p=db.products.find(x=>x.id===String(req.body.productId)||x.id===req.body.productId&&x.business_id===req.user.business_id);if(!p||p.business_id!==req.user.business_id)return res.status(404).json({error:'Bidhaa haipo'});const qty=Number(req.body.quantity),discount=Number(req.body.discount)||0;if(!Number.isInteger(qty)||qty<1)return res.status(400).json({error:'Quantity si sahihi'});if(!Number.isFinite(discount)||discount<0)return res.status(400).json({error:'Discount si sahihi'});if(p.quantity<qty)return res.status(400).json({error:'Stock haitoshi'});const total=Math.max(0,p.sell_price*qty-discount),s={id:id(),business_id:req.user.business_id,product_id:p.id,product_name:p.name,quantity:qty,buy_total:p.buy_price*qty,subtotal:p.sell_price*qty,discount,payment_method:req.body.paymentMethod||'cash',customer_id:req.body.customerId||null,seller_id:req.user.id,total,status:'completed',created_at:now()};p.quantity-=qty;db.sales.push(s);if(s.payment_method==='credit'){let c=db.customers.find(x=>x.id===s.customer_id&&x.business_id===req.user.business_id);if(!c){p.quantity+=qty;db.sales.pop();return res.status(400).json({error:'Kwa mauzo ya mkopo chagua mteja kwanza.'});}db.debts.push({id:id(),business_id:req.user.business_id,customer_id:c.id,customer_name:c.name,person_name:c.name,description:'Sale '+s.id.slice(0,8),amount:total,paid:0,due_date:null,status:'open',sale_id:s.id,created_at:now()})}audit(req,'create','sale',s.id,{total});saveDB();res.status(201).json({sale:s})});
app.post('/api/sales/:id/void',auth,biz,owner,(req,res)=>{const s=db.sales.find(x=>x.id===req.params.id&&x.business_id===req.user.business_id&&x.status!=='voided');if(!s)return res.status(404).json({error:'Sale haipo au tayari ime-void'});const p=db.products.find(x=>x.id===s.product_id);if(p)p.quantity+=s.quantity;s.status='voided';s.void_reason=String(req.body.reason||'');s.voided_at=now();s.voided_by=req.user.id;audit(req,'void','sale',s.id,{reason:s.void_reason});saveDB();res.json({ok:true,sale:s})});
app.get('/api/expenses',auth,biz,(req,res)=>res.json({expenses:db.expenses.filter(x=>x.business_id===req.user.business_id&&x.status!=='voided')}));
app.post('/api/expenses',auth,biz,(req,res)=>{const amount=Number(req.body.amount);if(!String(req.body.description||'').trim()||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Maelezo na kiasi vinahitajika'});const e={id:id(),business_id:req.user.business_id,description:String(req.body.description),category:req.body.category||'',amount,created_by:req.user.id,created_at:now(),status:'active'};db.expenses.push(e);audit(req,'create','expense',e.id);saveDB();res.status(201).json({expense:e})});
app.get('/api/debts',auth,biz,(req,res)=>res.json({debts:db.debts.filter(x=>x.business_id===req.user.business_id&&x.status!=='voided')}));
app.post('/api/debts',auth,biz,(req,res)=>{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Kiasi si sahihi'});const d={id:id(),business_id:req.user.business_id,customer_id:req.body.customerId||null,customer_name:req.body.personName||'',person_name:req.body.personName||'',description:req.body.description||'',amount,paid:0,due_date:req.body.dueDate||null,status:'open',created_by:req.user.id,created_at:now()};db.debts.push(d);saveDB();res.status(201).json({debt:d})});
app.post('/api/debts/:id/pay',auth,biz,(req,res)=>{const d=db.debts.find(x=>x.id===req.params.id&&x.business_id===req.user.business_id);if(!d)return res.status(404).json({error:'Deni halipo'});const payment=Number(req.body.amount);if(!Number.isFinite(payment)||payment<=0)return res.status(400).json({error:'Kiasi cha malipo si sahihi'});if(d.paid>=d.amount)return res.status(400).json({error:'Deni hili tayari limelipwa'});if(d.paid+payment>d.amount)return res.status(400).json({error:`Malipo yanazidi deni. Salio ni ${(d.amount-d.paid).toFixed(2)}.`});d.paid+=payment;d.status=d.paid>=d.amount?'paid':'open';const dp={id:id(),debt_id:d.id,business_id:req.user.business_id,amount:payment,paid_by:req.user.id,created_at:now()};db.debt_payments.push(dp);audit(req,'payment','debt',d.id,{amount:payment,payment_id:dp.id});saveDB();res.json({debt:d,payment:dp})});
app.get('/api/business',auth,biz,(req,res)=>{const b=db.businesses.find(x=>x.id===req.user.business_id);if(!b)return res.status(404).json({error:'Biashara haipo'});res.json({business:b});});
app.patch('/api/business',auth,owner,(req,res)=>{const b=db.businesses.find(x=>x.id===req.user.business_id);if(!b)return res.status(404).json({error:'Biashara haipo'});const allowed=['name','type','phone','country','region','district','ward','location'];for(const k of allowed)if(req.body[k]!==undefined)b[k]=String(req.body[k]).trim();audit(req,'update','business',b.id,{fields:allowed.filter(k=>req.body[k]!==undefined)});saveDB();res.json({business:b});});
app.get('/api/employees',auth,owner,(req,res)=>{const list=db.users.filter(u=>u.business_id===req.user.business_id&&u.role==='saler').map(u=>({...safeUser(u),business_code:db.businesses.find(b=>b.id===u.business_id)?.code||''}));res.json({employees:list});});
app.post('/api/employees',auth,owner,async(req,res)=>{const fullName=String(req.body.fullName||req.body.full_name||'').trim(),phone=String(req.body.phone||'').trim(),email=String(req.body.email||'').toLowerCase().trim(),password=String(req.body.password||'');if(!fullName||!phone||!email||password.length<8)return res.status(400).json({error:'Jaza jina, simu, email na password ya angalau herufi 8.'});if(!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Email si sahihi.'});if(db.users.some(u=>u.email===email))return res.status(409).json({error:'Email hii tayari imesajiliwa.'});const u={id:id(),full_name:fullName,phone,email,password_hash:await bcrypt.hash(password,12),role:'saler',business_id:req.user.business_id,status:'active',provider:'email',created_at:now(),last_login:null};db.users.push(u);audit(req,'create','employee',u.id);saveDB();res.status(201).json({employee:safeUser(u)});});
app.post('/api/employees/:id/status',auth,owner,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id&&x.business_id===req.user.business_id&&x.role==='saler');if(!u)return res.status(404).json({error:'Mfanyakazi hayupo'});if(!['active','suspended'].includes(req.body.status))return res.status(400).json({error:'Status si sahihi'});u.status=req.body.status;audit(req,'status_change','employee',u.id,{status:u.status});saveDB();res.json({employee:safeUser(u)});});
app.get('/api/reports',auth,biz,(req,res)=>{const from=req.query.from||'',to=req.query.to||'';const ss=db.sales.filter(s=>s.business_id===req.user.business_id&&s.status!=='voided'&&dateMatch(s.created_at,from,to)),es=db.expenses.filter(e=>e.business_id===req.user.business_id&&e.status!=='voided'&&dateMatch(e.created_at,from,to));const revenue=ss.reduce((a,s)=>a+s.total,0),grossProfit=ss.reduce((a,s)=>a+(s.total-s.buy_total),0),expenses=es.reduce((a,e)=>a+e.amount,0),profit=grossProfit-expenses;res.json({from:from||String(ss[0]?.created_at||now()).slice(0,10),to:to||String(now()).slice(0,10),sales:ss,expenses:es,summary:{revenue,grossProfit,expenses,profit,margin:revenue?profit/revenue*100:0}})});
// Business analytics: server-calculated figures used by Owner reports/charts.
app.get('/api/analytics',auth,biz,(req,res)=>{
  const bid=req.user.business_id;
  const activeProducts=db.products.filter(p=>p.business_id===bid&&p.status!=='deleted');
  const ss=db.sales.filter(s=>s.business_id===bid&&s.status!=='voided');
  const es=db.expenses.filter(e=>e.business_id===bid&&e.status!=='voided');
  const stockValue=activeProducts.reduce((a,p)=>a+(Number(p.buy_price)||0)*(Number(p.quantity)||0),0);
  const stockSellValue=activeProducts.reduce((a,p)=>a+(Number(p.sell_price)||0)*(Number(p.quantity)||0),0);
  const byProduct=activeProducts.map(p=>{const sold=ss.filter(s=>s.product_id===p.id).reduce((a,s)=>a+Number(s.quantity||0),0);return {product_id:p.id,name:p.name,sold,stock:Number(p.quantity||0),revenue:ss.filter(s=>s.product_id===p.id).reduce((a,s)=>a+Number(s.total||0),0)}}).sort((a,b)=>b.sold-a.sold);
  const daily={};
  for(const s of ss){const d=String(s.created_at).slice(0,10);daily[d]??={date:d,revenue:0,gross_profit:0,expenses:0,profit:0,sales_count:0};daily[d].revenue+=Number(s.total||0);daily[d].gross_profit+=Number(s.total||0)-Number(s.buy_total||0);daily[d].sales_count++;}
  for(const e of es){const d=String(e.created_at).slice(0,10);daily[d]??={date:d,revenue:0,gross_profit:0,expenses:0,profit:0,sales_count:0};daily[d].expenses+=Number(e.amount||0);}
  const dailyRows=Object.values(daily).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({...x,profit:x.gross_profit-x.expenses}));
  res.json({stock:{products:activeProducts.length,total_quantity:activeProducts.reduce((a,p)=>a+Number(p.quantity||0),0),buy_value:stockValue,sell_value:stockSellValue,near_out_of_stock:activeProducts.filter(p=>Number(p.quantity||0)<=Number(p.min_stock||0)).length},best_selling:byProduct.slice(0,10),lowest_selling:byProduct.slice().reverse().slice(0,10),never_sold:byProduct.filter(x=>x.sold===0),daily:dailyRows});
});

// Subscription + payment state machine. The server, not the browser, is authoritative for payment success.
function publicPlan(p){return {...p,code:p.code||p.id,price:Number(p.current_price_tzs??p.price),regular_price_tzs:Number(p.regular_price_tzs??p.price),current_price_tzs:Number(p.current_price_tzs??p.price)}}
function activeSubscriptionFor(userId){const p=db.payments.filter(x=>x.user_id===userId&&x.status==='SUCCESSFUL'&&x.expires_at&&new Date(x.expires_at)>new Date()).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];if(!p)return null;const plan=db.plans.find(x=>x.id===p.plan_id);return {status:'active',expires_at:p.expires_at,plan:p.plan_id,plan_name:plan?.name||p.plan_id,amount:p.amount,currency:p.currency}}
app.get('/api/subscription/plans',(req,res)=>res.json({plans:db.plans.filter(p=>p.active!==false).map(publicPlan)}));
app.get('/api/subscription/current',auth,(req,res)=>{const sub=activeSubscriptionFor(req.user.id);res.json(sub?{active:true,status:'ACTIVE',subscription:sub}:{active:false,status:'EXPIRED',subscription:null})});
app.get('/api/subscription/payments',auth,(req,res)=>res.json({payments:db.payments.filter(p=>p.user_id===req.user.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}));
function normalizeTzPhone(input){let n=String(input||'').replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);if(n.startsWith('255'))return n;if(n.startsWith('0'))return '255'+n.slice(1);if(/^[67]\d{8}$/.test(n))return '255'+n;return n;}
function palmConfigured(){return !!(process.env.PALMPESA_API_TOKEN&&process.env.PALMPESA_USER_ID);}
async function palmRequest(path,body){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(`https://palmpesa.drmlelwa.co.tz${path}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMPESA_API_TOKEN}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:controller.signal});const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}return {ok:r.ok,status:r.status,data};}catch(e){return {ok:false,status:0,data:{error:'PalmPesa haipatikani kwa sasa.'}}}finally{clearTimeout(timer)}}
async function initiatePalmPesa(p,plan){if(!palmConfigured())return {configured:false};const phone=normalizeTzPhone(p.phone);const u=db.users.find(x=>x.id===p.user_id);const payload={name:u?.full_name||'Daftari+ Customer',email:u?.email||'',phone,amount:Number(p.amount),transaction_id:p.order_id,address:process.env.PALMPESA_ADDRESS||'Tanzania',postcode:process.env.PALMPESA_POSTCODE||'11111',callback_url:process.env.PALMPESA_CALLBACK_URL||`${process.env.APP_BASE_URL||`http://localhost:${PORT}`}/api/payments/webhook`};const r=await palmRequest('/api/palmpesa/initiate',payload);if(!r.ok)return {configured:true,ok:false,error:r.data?.message||r.data?.error||'PalmPesa payment initiation failed'};const providerOrderId=r.data?.order_id||r.data?.response?.order_id||null;if(!providerOrderId)return {configured:true,ok:false,error:'PalmPesa haikurudisha order_id.'};return {configured:true,ok:true,data:r.data,provider_order_id:providerOrderId};}
function activatePayment(p,transactionId=null){
  if(p.status==='SUCCESSFUL')return false;
  const plan=db.plans.find(x=>x.id===p.plan_id);
  const current=db.payments.filter(x=>x.user_id===p.user_id&&x.status==='SUCCESSFUL'&&x.expires_at&&new Date(x.expires_at)>new Date()).sort((a,b)=>new Date(b.expires_at)-new Date(a.expires_at))[0];
  const base=current?.expires_at?new Date(current.expires_at):new Date();
  p.status='SUCCESSFUL';p.transaction_id=transactionId||p.transaction_id;p.confirmed_at=now();p.expires_at=new Date(base.getTime()+(Number(plan?.days)||30)*86400000).toISOString();
  audit({id:p.user_id,business_id:p.business_id},'payment_confirmed','payment',p.id,{order_id:p.order_id,transaction_id:p.transaction_id});
  saveDB();return true;
}
async function syncPalmPesaStatus(p){if(!palmConfigured()||!p.provider_order_id)return null;const r=await palmRequest('/api/order-status',{order_id:p.provider_order_id});if(!r.ok)return null;const item=Array.isArray(r.data?.data)?r.data.data[0]:null;if(!item)return null;const amount=Number(item.amount);if(Number.isFinite(amount)&&amount!==Number(p.amount))return null;const status=String(item.payment_status||'').toUpperCase();if(status==='COMPLETED'){activatePayment(p,item.transid||item.reference||p.transaction_id);return 'SUCCESSFUL'}if(status==='FAILED'){p.status='FAILED';p.failed_at=now();saveDB();return 'FAILED'}return 'PENDING'}
async function initiateProviderPayment(p,plan){
  if((process.env.PAYMENT_PROVIDER||'').toLowerCase()==='palmpesa'||palmConfigured())return initiatePalmPesa(p,plan);
  const url=String(process.env.PAYMENT_API_URL||'').trim();if(!url)return {configured:false};
  const headers={'Content-Type':'application/json'};if(process.env.PAYMENT_API_KEY)headers.Authorization=`Bearer ${process.env.PAYMENT_API_KEY}`;
  const payload={orderId:p.order_id,amount:p.amount,currency:p.currency,phone:p.phone,merchantId:process.env.PAYMENT_MERCHANT_ID||undefined,description:`Daftari+ ${plan.name}`};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:controller.signal});const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}if(!r.ok)return {configured:true,ok:false,error:data.message||data.error||'Provider payment request failed'};return {configured:true,ok:true,data};}catch(e){return {configured:true,ok:false,error:'Payment provider haipatikani kwa sasa.'}}finally{clearTimeout(timer)}
}
app.post('/api/subscription/create-payment',auth,owner,rateLimit({max:10}),async(req,res)=>{const idem=String(req.headers['idempotency-key']||req.body.idempotencyKey||'').trim();const planKey=String(req.body.planId||req.body.planCode||'').trim();const plan=db.plans.find(p=>(p.id===planKey||p.code===planKey)&&p.active!==false),phone=String(req.body.phone||'').trim();if(!plan||!phone)return res.status(400).json({error:'Plan na namba ya simu vinahitajika.'});if(!/^\+?[0-9][0-9\s-]{7,18}$/.test(phone))return res.status(400).json({error:'Namba ya simu si sahihi.'});
  const existing=db.payments.find(p=>p.user_id===req.user.id&&((idem&&p.idempotency_key===idem)||(p.plan_id===plan.id&&p.status==='PENDING'&&Date.now()-new Date(p.created_at).getTime()<15*60000)));if(existing)return res.json({status:'PENDING',order_id:existing.order_id,payment:existing,reused:true});
  const p={id:id(),order_id:'DF-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex'),user_id:req.user.id,business_id:req.user.business_id,plan_id:plan.id,amount:Number(plan.current_price_tzs??plan.price),currency:plan.currency||'TZS',phone,status:'PENDING',idempotency_key:idem||null,provider:process.env.PAYMENT_PROVIDER||'unconfigured',transaction_id:null,created_at:now(),expires_at:null};db.payments.push(p);audit(req,'create','payment',p.id,{order_id:p.order_id,amount:p.amount});saveDB();
  const result=await initiateProviderPayment(p,plan);if(!result.configured)return res.status(503).json({error:'Payment provider bado haijaunganishwa. Weka credentials/API ya provider kwanza.',code:'PAYMENT_PROVIDER_NOT_CONFIGURED'});if(!result.ok){p.status='FAILED';p.failure_reason=result.error;saveDB();return res.status(502).json({error:result.error,code:'PAYMENT_PROVIDER_ERROR'})}
  p.provider_reference=result.data?.transactionId||result.data?.transaction_id||result.data?.reference||null;p.provider_order_id=result.provider_order_id||result.data?.order_id||null;saveDB();res.status(201).json({status:'PENDING',order_id:p.order_id,payment:p,message:'Ombi la malipo limetumwa. Subiri uthibitisho wa server.'});
});
function paymentStatusResponse(p){const plan=db.plans.find(x=>x.id===p.plan_id);const sub=p.status==='SUCCESSFUL'?{expires_at:p.expires_at,plan:p.plan_id,plan_name:plan?.name||p.plan_id}:{expires_at:null,plan:null,plan_name:null};return {status:p.status,order_id:p.order_id,payment:p,subscription:sub}}
async function getPayment(req,res){const p=db.payments.find(x=>x.order_id===req.params.orderId&&x.user_id===req.user.id);if(!p)return res.status(404).json({error:'Payment haipo'});return res.json(paymentStatusResponse(p))}
app.get('/api/subscription/check-status/:orderId',auth,getPayment);
app.post('/api/subscription/check-status',auth,async(req,res)=>{const orderId=String(req.body.orderId||'');const p=db.payments.find(x=>x.order_id===orderId&&x.user_id===req.user.id);if(!p)return res.status(404).json({error:'Payment haipo'});if(p.status==='PENDING'&&palmConfigured())await syncPalmPesaStatus(p);return res.json(paymentStatusResponse(p))});
app.post('/api/payments/webhook',rateLimit({max:120}),async(req,res)=>{
  const secret=String(process.env.PAYMENT_WEBHOOK_SECRET||'');const supplied=String(req.headers['x-webhook-secret']||'');
  if(secret&&(supplied.length!==secret.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(secret))))return res.status(401).json({error:'Invalid webhook'});
  if(production&&!secret&&!palmConfigured())return res.status(503).json({error:'Webhook authentication haijawekwa.'});
  const body=req.body||{};const orderId=String(body.orderId||body.order_id||'');
  let p=db.payments.find(x=>x.order_id===orderId||x.provider_order_id===orderId);
  if(!p&&Array.isArray(body.data)&&body.data[0]?.order_id)p=db.payments.find(x=>x.order_id===String(body.data[0].order_id)||x.provider_order_id===String(body.data[0].order_id));
  if(!p)return res.status(404).json({error:'Order not found'});
  if(p.status==='SUCCESSFUL')return res.json({ok:true,status:p.status});
  const incoming=String(body.status||body.payment_status||body.data?.[0]?.payment_status||'').toUpperCase();
  if(palmConfigured()&&!secret){const verified=await syncPalmPesaStatus(p);if(verified)return res.json({ok:true,status:verified});return res.status(202).json({ok:true,status:'PENDING'});}
  if(incoming==='COMPLETED'||incoming==='SUCCESSFUL'){
    activatePayment(p,body.transactionId||body.transaction_id||body.transid||body.reference||p.transaction_id);return res.json({ok:true,status:p.status});
  }
  if(incoming==='FAILED'||incoming==='CANCELLED'){p.status=incoming==='FAILED'?'FAILED':'CANCELLED';p.failed_at=now();saveDB();return res.json({ok:true,status:p.status});}
  return res.status(400).json({error:'Payment status si sahihi'});
});
app.get('/api/super/users',auth,superOnly,(req,res)=>res.json({users:db.users.filter(u=>u.role!=='super_admin').map(u=>{const b=db.businesses.find(x=>x.id===u.business_id),pay=db.payments.filter(x=>x.user_id===u.id).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];return {...safeUser(u),business_name:b?.name||'',business_type:b?.type||'',country:b?.country||'',region:b?.region||'',district:b?.district||'',ward:b?.ward||'',subscription:pay?.status==='SUCCESSFUL'&&pay.expires_at&&new Date(pay.expires_at)>new Date()?'active':'inactive',last_payment:pay?.created_at||null}})}));
app.get('/api/super/payments',auth,superOnly,(req,res)=>res.json({payments:db.payments.map(p=>{const u=db.users.find(x=>x.id===p.user_id),b=db.businesses.find(x=>x.id===u?.business_id);return {...p,user_name:u?.full_name||'',email:u?.email||'',business_name:b?.name||''}})}));
app.get('/api/super/businesses',auth,superOnly,(req,res)=>res.json({businesses:db.businesses.map(b=>{const us=db.users.filter(u=>u.business_id===b.id),ss=db.sales.filter(s=>s.business_id===b.id&&s.status!=='voided'),rev=ss.reduce((a,s)=>a+s.total,0);return {...b,owner:us.find(u=>u.role==='owner')?.full_name||'',users:us.length,sales:ss.length,revenue:rev}})}));
app.get('/api/super/performance',auth,superOnly,(req,res)=>res.json({performance:db.businesses.map(b=>{const ss=db.sales.filter(s=>s.business_id===b.id&&s.status!=='voided'),es=db.expenses.filter(e=>e.business_id===b.id&&e.status!=='voided'),revenue=ss.reduce((a,s)=>a+s.total,0),gross_profit=ss.reduce((a,s)=>a+(s.total-s.buy_total),0),expenses=es.reduce((a,e)=>a+e.amount,0);return{name:b.name,sales:ss.length,revenue,gross_profit,expenses}})}));
app.get('/api/super/subscription/stats',auth,superOnly,(req,res)=>{const successful=db.payments.filter(p=>p.status==='SUCCESSFUL'),active=successful.filter(p=>p.expires_at&&new Date(p.expires_at)>new Date());res.json({totals:{successful_count:successful.length,successful_amount:successful.reduce((s,p)=>s+p.amount,0)},active:{active_subscriptions:active.length}})});
app.get('/api/super/subscription/plans',auth,superOnly,(req,res)=>res.json({plans:db.plans}));
app.post('/api/super/subscription/plans',auth,superOnly,(req,res)=>{const b=req.body||{},code=String(b.code||b.id||'').trim().toLowerCase(),name=String(b.name||'').trim(),regular=Number(b.regularPriceTzs??b.regular_price_tzs??b.price);if(!code||!name||!Number.isFinite(regular)||regular<=0)return res.status(400).json({error:'Plan details si sahihi'});if(db.plans.some(p=>String(p.code||p.id).toLowerCase()===code))return res.status(409).json({error:'Plan Code tayari ipo'});const discount=Math.min(100,Math.max(0,Number(b.discountPercent??0)));const current=Math.round(regular*(1-discount/100));const p={id:id(),code,name,price:current,regular_price_tzs:regular,current_price_tzs:current,discount_percent:discount,currency:b.currency||'TZS',days:Number(b.durationDays??b.days??30),promotion_name:b.promotionName||'',promotion_start:b.promotionStart||'',promotion_end:b.promotionEnd||'',active:b.active!==false,features:Array.isArray(b.features)?b.features:[]};db.plans.push(p);audit(req,'create','subscription_plan',p.id);saveDB();res.status(201).json({plan:p})});
app.patch('/api/super/subscription/plans/:id',auth,superOnly,(req,res)=>{const p=db.plans.find(x=>x.id===req.params.id||x.code===req.params.id);if(!p)return res.status(404).json({error:'Plan haipo'});const b=req.body||{};if(b.name!==undefined)p.name=String(b.name).trim();if(b.regularPriceTzs!==undefined||b.regular_price_tzs!==undefined)p.regular_price_tzs=Number(b.regularPriceTzs??b.regular_price_tzs);if(b.discountPercent!==undefined||b.discount_percent!==undefined)p.discount_percent=Math.min(100,Math.max(0,Number(b.discountPercent??b.discount_percent)));if(b.currentPriceTzs!==undefined||b.current_price_tzs!==undefined)p.current_price_tzs=Number(b.currentPriceTzs??b.current_price_tzs);else if(b.regularPriceTzs!==undefined||b.regular_price_tzs!==undefined||b.discountPercent!==undefined||b.discount_percent!==undefined)p.current_price_tzs=Math.round(Number(p.regular_price_tzs)*(1-Number(p.discount_percent||0)/100));p.price=p.current_price_tzs;if(b.durationDays!==undefined||b.days!==undefined)p.days=Number(b.durationDays??b.days);if(b.promotionName!==undefined)p.promotion_name=String(b.promotionName);if(b.promotionStart!==undefined)p.promotion_start=String(b.promotionStart);if(b.promotionEnd!==undefined)p.promotion_end=String(b.promotionEnd);if(b.currency!==undefined)p.currency=String(b.currency);if(b.active!==undefined)p.active=!!b.active;audit(req,'update','subscription_plan',p.id);saveDB();res.json({plan:p})});
for(const state of ['suspend','activate'])app.put(`/api/super/businesses/:id/${state}`,auth,superOnly,(req,res)=>{const b=db.businesses.find(x=>x.id===req.params.id);if(!b)return res.status(404).json({error:'Business not found'});b.status=state==='activate'?'active':'suspended';audit(req,state,'business',b.id,{status:b.status});saveDB();res.json({ok:true})});
app.post('/api/super/users/:id/status',auth,superOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id&&x.role!=='super_admin');if(!u)return res.status(404).json({error:'User not found'});if(!['active','suspended'].includes(req.body.status))return res.status(400).json({error:'Status si sahihi'});u.status=req.body.status;audit(req,'status_change','user',u.id,{status:u.status});saveDB();res.json({user:safeUser(u)})});
app.get('/api/super/audit-logs',auth,superOnly,(req,res)=>res.json({logs:db.audit_logs.slice().reverse().slice(0,500)}));
app.post('/api/super/login',rateLimit({max:15}),(req,res)=>{const email=String(req.body.email||'').toLowerCase().trim(),password=String(req.body.password||'');if(email!==String(process.env.SUPER_ADMIN_EMAIL||'').toLowerCase()||!adminPasswordOK(password))return res.status(401).json({error:'Super Admin credentials si sahihi.'});let u=db.users.find(x=>x.role==='super_admin');if(!u){u={id:'super-admin',full_name:'Super Admin',email,phone:'',role:'super_admin',business_id:null,status:'active',provider:'email',created_at:now(),last_login:now()};db.users.push(u)}u.last_login=now();saveDB();res.json({token:issueToken(u),user:safeUser(u)})});
app.use((req,res,next)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'API endpoint haipo.'});next()});
app.use((req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
const server=app.listen(PORT,()=>console.log(`Daftari+ running on port ${PORT}`));
function shutdown(signal){console.log(`Daftari+ shutting down (${signal})`);try{backupDB();sqlite.close();}finally{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();}}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('uncaughtException',e=>{console.error('Uncaught exception:',e);});
process.on('unhandledRejection',e=>console.error('Unhandled rejection:',e));
