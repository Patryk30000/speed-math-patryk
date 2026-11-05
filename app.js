/* Speed Math – all data lives in this browser's localStorage */
const OPS={add:{sym:'+',name:'Addition'},sub:{sym:'−',name:'Subtraction'},mul:{sym:'×',name:'Multiplication'},div:{sym:'÷',name:'Division'}};
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
};
const users=()=>store.get('sm_users',{});
const current=()=>store.get('sm_current',null);
function login(name,pin,create){
  name=name.trim();if(!name||!/^\d{4}$/.test(pin))return'Enter a name and a 4-digit PIN.';
  const u=users(),key=name.toLowerCase();
  if(create){if(u[key])return'That name is taken. Log in instead.';u[key]={name,pin,best:{},history:[]};store.set('sm_users',u)}
  else if(!u[key]||u[key].pin!==pin)return'Wrong name or PIN.';
  store.set('sm_current',key);return'';
}
function logout(){store.set('sm_current',null);location.href='index.html'}
function me(){const k=current(),u=users();return k&&u[k]?u[k]:null}
function saveResult(op,level,score,wrong){
  const u=users(),k=current(),p=u[k],id=op+level;
  const isBest=score>(p.best[id]||0);if(isBest)p.best[id]=score;
  p.history.unshift({op,level,score,wrong,date:new Date().toLocaleDateString()});p.history=p.history.slice(0,30);
  store.set('sm_users',u);return isBest;
}
const rnd=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
function makeQ(op,level){
  const m=[10,20,50][level-1];let a,b;
  if(op==='add'){a=rnd(1,m*2);b=rnd(1,m*2);return{t:`${a} + ${b}`,r:a+b}}
  if(op==='sub'){a=rnd(2,m*2);b=rnd(1,a);return{t:`${a} − ${b}`,r:a-b}}
  const f=[10,12,15][level-1];
  if(op==='mul'){a=rnd(2,f);b=rnd(2,f);return{t:`${a} × ${b}`,r:a*b}}
  b=rnd(2,f);const r=rnd(2,f);return{t:`${b*r} ÷ ${b}`,r}
}
function startGame(op){
  const p=me();if(!p){location.href='index.html';return}
  const $=id=>document.getElementById(id);
  $('who').textContent=p.name;
  let level=1,left=60,score=0,wrong=0,streak=0,cur,timer;
  const updBest=()=>$('best').textContent=p.best[op+level]||0;
  $('level').onchange=e=>{level=+e.target.value;updBest()};updBest();
  const next=()=>{cur=makeQ(op,level);$('q').textContent=cur.t;$('ans').value='';$('ans').focus()};
  const tick=()=>{left--;$('time').textContent=left;$('timefill').style.width=left/60*100+'%';if(left<=0)end()};
  function begin(){
    left=60;score=0;wrong=0;streak=0;$('score').textContent=0;$('streak').textContent=0;$('time').textContent=60;$('timefill').style.width='100%';
    $('setup').classList.add('hide');$('result').classList.add('hide');$('play').classList.remove('hide');
    next();clearInterval(timer);timer=setInterval(tick,1000);
  }
  function end(){
    clearInterval(timer);$('play').classList.add('hide');$('result').classList.remove('hide');
    const nb=saveResult(op,level,score,wrong);
    $('final').textContent=score;$('detail').textContent=`${wrong} wrong · best on this level: ${me().best[op+level]}`+(nb?' · New personal best!':'');
    p.best=me().best;updBest();
  }
  $('ans').addEventListener('keydown',e=>{
    if(e.key!=='Enter'||$('ans').value.trim()==='')return;
    const ok=+$('ans').value===cur.r,q=$('q');q.className=ok?'flash-ok':'flash-bad';
    if(ok){score++;streak++}else{wrong++;streak=0}
    $('score').textContent=score;$('streak').textContent=streak;next();
  });
  $('go').onclick=begin;$('again').onclick=begin;
}

/* ---- Teacher accounts (separate from student accounts) ---- */
const TEACHER_CODE='school2026'; // CHANGE THIS before you publish
const teachers=()=>store.get('sm_teachers',{});
function teacherLogin(name,pw,code){ // code only given when registering
  name=name.trim();const t=teachers(),key=name.toLowerCase();
  if(!name||pw.length<6)return'Enter a name and a password of at least 6 characters.';
  if(code!==null){
    if(code!==TEACHER_CODE)return'Wrong teacher code.';
    if(t[key])return'That teacher name is taken. Log in instead.';
    t[key]={name,pw};store.set('sm_teachers',t);
  }else if(!t[key]||t[key].pw!==pw)return'Wrong name or password.';
  store.set('sm_teacher_current',key);return'';
}
const teacherNow=()=>{const k=store.get('sm_teacher_current',null),t=teachers();return k&&t[k]?t[k]:null};
function teacherLogout(){store.set('sm_teacher_current',null);location.href='teacher.html'}
