const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),
cookieParser=require('cookie-parser'),rateLimit=require('express-rate-limit'),crypto=require('crypto');
const prod=process.env.NODE_ENV==='production';
const SECRET=process.env.JWT_SECRET||(console.warn('JWT_SECRET not set: using a temporary one'),crypto.randomBytes(32).toString('hex'));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:prod?{rejectUnauthorized:false}:false});
const app=express();app.set('trust proxy',1);
app.use(express.json({limit:'10kb'}),cookieParser(),express.static('public'));

const OPS=['add','sub','mul','div'];
const h=f=>(req,res)=>f(req,res).catch(e=>{console.error(e);res.status(500).json({error:'Server error. Try again.'})});
const bad=(res,m,c=400)=>res.status(c).json({error:m});
const str=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max?v.trim():null;
const sign=(res,role,id)=>res.cookie('sm',jwt.sign({role,id},SECRET,{expiresIn:'7d'}),{httpOnly:true,sameSite:'lax',secure:prod,maxAge:6048e5});
const auth=role=>(req,res,next)=>{try{const t=jwt.verify(req.cookies.sm,SECRET);if(t.role!==role)throw 0;req.uid=t.id;next()}catch(e){bad(res,'Please log in.',401)}};
const limiter=rateLimit({windowMs:15*60*1000,limit:30,message:{error:'Too many tries. Wait 15 minutes.'}});
const genCode=()=>Array.from(crypto.randomBytes(6),b=>'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b%31]).join('');

/* ---------- teachers ---------- */
app.post('/api/teacher/register',limiter,h(async(req,res)=>{
  const email=str(req.body.email,5,120),name=str(req.body.name,2,60),pw=req.body.password;
  if(!email||!/^\S+@\S+\.\S+$/.test(email)||!name||typeof pw!=='string'||pw.length<8)return bad(res,'Enter your name, a valid email and a password of 8+ characters.');
  try{const r=await pool.query('insert into teachers(email,name,pw) values($1,$2,$3) returning id',[email.toLowerCase(),name,await bcrypt.hash(pw,10)]);
    sign(res,'teacher',r.rows[0].id);res.json({ok:1})}
  catch(e){if(e.code==='23505')return bad(res,'That email already has an account. Log in instead.');throw e}
}));
app.post('/api/teacher/login',limiter,h(async(req,res)=>{
  const r=await pool.query('select id,pw from teachers where email=$1',[String(req.body.email||'').trim().toLowerCase()]);
  if(!r.rows[0]||!await bcrypt.compare(String(req.body.password||''),r.rows[0].pw))return bad(res,'Wrong email or password.',401);
  sign(res,'teacher',r.rows[0].id);res.json({ok:1});
}));
app.post('/api/classes',auth('teacher'),h(async(req,res)=>{
  const name=str(req.body.name,1,60);if(!name)return bad(res,'Give the class a name.');
  for(let i=0;i<5;i++){try{await pool.query('insert into classes(teacher_id,name,code) values($1,$2,$3)',[req.uid,name,genCode()]);return res.json({ok:1})}
    catch(e){if(e.code!=='23505')throw e}}
  bad(res,'Could not make a code. Try again.');
}));
app.get('/api/classes',auth('teacher'),h(async(req,res)=>{
  const t=await pool.query('select name from teachers where id=$1',[req.uid]);
  const c=await pool.query('select id,name,code from classes where teacher_id=$1 order by id',[req.uid]);
  const s=await pool.query(`select s.id,s.class_id,s.nick,
    (select count(*)::int from games g where g.student_id=s.id) games,
    (select max(at) from games g where g.student_id=s.id) last,
    (select coalesce(json_object_agg(k,m),'{}'::json) from (select op||level k,max(score) m from games g where g.student_id=s.id group by 1) x) best
    from students s join classes c on c.id=s.class_id where c.teacher_id=$1 order by lower(s.nick)`,[req.uid]);
  res.json({teacher:t.rows[0]?.name,classes:c.rows.map(k=>({...k,students:s.rows.filter(x=>x.class_id===k.id)}))});
}));
app.delete('/api/classes/:id',auth('teacher'),h(async(req,res)=>{await pool.query('delete from classes where id=$1 and teacher_id=$2',[+req.params.id||0,req.uid]);res.json({ok:1})}));
app.delete('/api/students/:id',auth('teacher'),h(async(req,res)=>{
  await pool.query('delete from students where id=$1 and class_id in (select id from classes where teacher_id=$2)',[+req.params.id||0,req.uid]);res.json({ok:1})}));

/* ---------- students ---------- */
const classByCode=async c=>(await pool.query('select id from classes where code=$1',[String(c||'').trim().toUpperCase()])).rows[0];
app.post('/api/student/register',limiter,h(async(req,res)=>{
  const nick=str(req.body.nick,2,20),pin=req.body.pin;
  if(!nick||!/^\d{4}$/.test(pin))return bad(res,'Pick a nickname (2–20 characters) and a 4-digit PIN.');
  const cl=await classByCode(req.body.code);if(!cl)return bad(res,'Class code not found. Ask your teacher.');
  try{const r=await pool.query('insert into students(class_id,nick,pin) values($1,$2,$3) returning id',[cl.id,nick,await bcrypt.hash(pin,10)]);
    sign(res,'student',r.rows[0].id);res.json({ok:1})}
  catch(e){if(e.code==='23505')return bad(res,'That nickname is taken in this class. Pick another.');throw e}
}));
app.post('/api/student/login',limiter,h(async(req,res)=>{
  const cl=await classByCode(req.body.code);
  const r=cl&&await pool.query('select id,pin from students where class_id=$1 and lower(nick)=lower($2)',[cl.id,String(req.body.nick||'').trim()]);
  if(!r||!r.rows[0]||!await bcrypt.compare(String(req.body.pin||''),r.rows[0].pin))return bad(res,'Wrong class code, nickname or PIN.',401);
  sign(res,'student',r.rows[0].id);res.json({ok:1});
}));
const bestOf=async id=>Object.fromEntries((await pool.query('select op||level k,max(score) m from games where student_id=$1 group by 1',[id])).rows.map(r=>[r.k,r.m]));
app.get('/api/student/stats',auth('student'),h(async(req,res)=>{
  const s=await pool.query('select s.nick,c.name cls from students s join classes c on c.id=s.class_id where s.id=$1',[req.uid]);
  if(!s.rows[0])return bad(res,'Please log in.',401);
  const g=await pool.query('select op,level,score,at from games where student_id=$1 order by at desc limit 10',[req.uid]);
  res.json({nick:s.rows[0].nick,cls:s.rows[0].cls,best:await bestOf(req.uid),history:g.rows});
}));
app.post('/api/games',auth('student'),h(async(req,res)=>{
  const{op,level,score,wrong}=req.body;
  if(!OPS.includes(op)||![1,2,3].includes(level)||!Number.isInteger(score)||!Number.isInteger(wrong)||score<0||score>300||wrong<0||wrong>300)return bad(res,'Invalid score.');
  await pool.query('insert into games(student_id,op,level,score,wrong) values($1,$2,$3,$4,$5)',[req.uid,op,level,score,wrong]);
  res.json({best:await bestOf(req.uid)});
}));
app.post('/api/logout',(req,res)=>{res.clearCookie('sm');res.json({ok:1})});

(async()=>{
  await pool.query(`
  create table if not exists teachers(id serial primary key,email text unique not null,name text not null,pw text not null);
  create table if not exists classes(id serial primary key,teacher_id int not null references teachers on delete cascade,name text not null,code text unique not null);
  create table if not exists students(id serial primary key,class_id int not null references classes on delete cascade,nick text not null,pin text not null);
  create unique index if not exists students_nick on students(class_id,lower(nick));
  create table if not exists games(id serial primary key,student_id int not null references students on delete cascade,op text not null,level int not null,score int not null,wrong int not null,at timestamptz default now());`);
  app.listen(process.env.PORT||3000,()=>console.log('Speed Math running'));
})().catch(e=>{console.error('Startup failed:',e.message);process.exit(1)});
