const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = 4000;
const DB = path.join(__dirname, '..', 'data', 'growthos.json');

function ensureDB(){
  fs.mkdirSync(path.dirname(DB), {recursive:true});
  if(!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({campaign:{target:500,budget:2000,durationDays:7},registrations:[],students:[],referrals:[],checkpoints:[],mentorMessages:[],strategyRuns:[],budgetLog:[],codeWorkspaces:[]},null,2));
}
function load(){ensureDB(); return JSON.parse(fs.readFileSync(DB,'utf8'));}
function save(data){
  const tmp=DB+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(data,null,2)); fs.renameSync(tmp,DB);
}
function id(prefix='id'){return `${prefix}_${crypto.randomUUID()}`;}
function json(res,obj,status=200){const b=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'});res.end(b);}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(new Error('Invalid JSON'))}});req.on('error',reject);});}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function now(){return new Date().toISOString()}
function spent(data){return data.budgetLog.reduce((n,x)=>n+Number(x.amount||0),0)}
function registrationStats(data){
  const total=data.registrations.length, target=Number(data.campaign.target), remaining=Math.max(0,target-total);
  const start=data.campaign.startDate?new Date(data.campaign.startDate):null;
  const elapsed=start?Math.max(1,Math.ceil((Date.now()-start.getTime())/86400000)):0;
  const daysLeft=start?Math.max(0,Number(data.campaign.durationDays)-elapsed):Number(data.campaign.durationDays);
  return {total,target,remaining,progressPercent:target?Math.min(100,+(total/target*100).toFixed(1)):0,daysElapsed:elapsed,daysLeft,budget:Number(data.campaign.budget),spent:spent(data),budgetRemaining:Number(data.campaign.budget)-spent(data),blendedCpa:total?+(spent(data)/total).toFixed(2):0};
}
function channelStats(data){const out={}; for(const r of data.registrations){const k=r.source||'Direct';out[k]=(out[k]||0)+1} return out;}
function leaderboard(data){
  const refs={}; for(const r of data.referrals) refs[r.referrerId]=(refs[r.referrerId]||0)+1;
  return data.students.map(s=>({id:s.id,name:s.name,college:s.college,referrals:refs[s.id]||0,progress:s.progress||0,streak:s.streak||0})).sort((a,b)=>b.referrals-a.referrals||b.progress-a.progress||b.streak-a.streak||a.name.localeCompare(b.name)).map((x,i)=>({...x,rank:i+1}));
}
function buildStrategy(data, input={}){
  const target=Number(input.target||data.campaign.target||500), budget=Number(input.budget??data.campaign.budget??2000), days=Number(input.durationDays||data.campaign.durationDays||7);
  const stats=registrationStats(data); const current=stats.total; const remaining=Math.max(0,target-current); const dayRemaining=stats.daysLeft||days;
  const requiredPerDay=dayRemaining?Math.ceil(remaining/dayRemaining):remaining;
  const currentRate=stats.daysElapsed?+(current/stats.daysElapsed).toFixed(1):0;
  const refCount=data.referrals.length;
  const referralShare=current?+(refCount/current*100).toFixed(1):0;
  const channel=channelStats(data);
  const suggestions=[];
  if(current===0) suggestions.push('Start with trackable student coordinators: recruit 10–15 campus/community connectors and give each a unique referral code.');
  else if(currentRate < remaining/Math.max(1,dayRemaining)) suggestions.push('You are behind the required pace. Increase referral-led distribution first and add urgency to the workshop CTA.');
  else suggestions.push('You are on pace or ahead. Preserve the strongest channels and avoid spending simply because budget remains.');
  if(referralShare < 35) suggestions.push('Referral contribution is below 35%. Push a simple share-to-friends CTA and give coordinators ready-to-forward copy.');
  else suggestions.push('Referral contribution is healthy. Double down on the top referrers and communities producing registrations.');
  suggestions.push('Use WhatsApp groups, college clubs/placement cells and email as the priority channels; keep the message focused on a concrete 60-minute outcome.');
  const paidReserve=Math.min(Math.max(0,budget-stats.spent), Math.max(0, Math.round(remaining*2)));
  const dailyBudget=dayRemaining?Math.floor(Math.max(0,budget-stats.spent)/dayRemaining):0;
  const channelPlan=[
    {channel:'Student referrals + ambassadors',goal:Math.ceil(target*.45),budget:0,why:'Lowest-friction distribution with trackable ownership.'},
    {channel:'WhatsApp communities',goal:Math.ceil(target*.25),budget:0,why:'High reach inside student communities; use coordinator-owned groups.'},
    {channel:'College clubs / placement cells',goal:Math.ceil(target*.20),budget:0,why:'Direct access to final-year engineering cohorts.'},
    {channel:'Email + organic social',goal:Math.max(0,target-Math.ceil(target*.45)-Math.ceil(target*.25)-Math.ceil(target*.20)),budget:0,why:'Value-first reminders and proof of the 60-minute build.'},
  ];
  const spendAdvice = stats.spent===0 ? `Keep paid spend at ₹0 initially; reserve up to ₹${budget} as a contingency only after measuring organic/referral conversion.` : `You have ₹${stats.budgetRemaining} remaining. Cap discretionary spend at roughly ₹${dailyBudget}/day while the campaign is active.`;
  const strategy={generatedAt:now(),inputs:{target,budget,durationDays:days},actual:{...stats,referrals:refCount,referralSharePercent:Number(referralShare),channels:channel},decision:{remainingRegistrations:remaining,requiredRegistrationsPerDay:requiredPerDay,currentRegistrationsPerDay:currentRate,dailyBudgetCap:dailyBudget,contingencyReserve:paidReserve},recommendations:suggestions,channelPlan,spendAdvice,guardrails:['Never count a registration unless it exists in the registry.','Do not fabricate referral or conversion numbers.','Stay within the ₹2,000 total campaign cap.','Recalculate the plan whenever actual registrations, referrals or spend change.']};
  return strategy;
}
function mentorFallback(student,message,workspace){
  const q=message.toLowerCase(); const p=student.progress||0; const project=student.projectName||student.goal||'your project'; const code=workspace?.code||'';
  if(q.includes('404')||q.includes('not found')) return `For ${project}, a 404 usually means the URL or route is wrong. Check the exact frontend request URL, confirm the backend route exists, and verify the backend port. If you paste the failing request and route here, I can trace them together.`;
  if(q.includes('cors')) return `For a CORS error, first confirm the API origin and frontend origin. Then allow the exact frontend origin in the backend. Don't disable browser security globally; fix the server policy instead.`;
  if(q.includes('api')||q.includes('backend')) return `Let's debug ${project} from the boundary inward: 1) test the API endpoint directly, 2) inspect the request payload, 3) inspect the server response/status, 4) connect the UI only after the endpoint works. Your current progress is ${p}%.`;
  if(q.includes('database')||q.includes('sql')) return `For the database part of ${project}, define the smallest data model first: one entity, its required fields, and one read/write flow. Then test persistence before adding more tables.`;
  if(q.includes('deploy')||q.includes('deployment')) return `Before deploying ${project}, verify environment variables, production API URL, build command and one end-to-end smoke test. Keep a rollback path.`;
  if(q.includes('code')||q.includes('error')||q.includes('bug')) return `For ${project}, don't change several things at once. Reproduce the issue, isolate the smallest failing function, inspect the exact error, make one change, and retest. ${code?'I can also reason through the code you saved in your Build Lab.':'Paste the relevant code snippet in the Build Lab if you want code-specific guidance.'}`;
  if(p<25) return `For ${project}, keep the next step small: get one complete input → processing → output path working. Once that works, record it as a checkpoint before expanding scope.`;
  if(p<70) return `You're at ${p}% on ${project}. Your next focus should be validation: test the core flow with a real example, log the failure, and fix the highest-impact issue before polishing.`;
  return `You're at ${p}% on ${project}. Prioritize demo reliability now: test the happy path, handle one important failure case, and prepare a short explanation of what the project solves.`;
}
function mentorWithOpenAI(student,message,workspace){
  if(!process.env.OPENAI_API_KEY) return Promise.resolve(null);
  const payload={model:process.env.OPENAI_MODEL||'gpt-5.6',input:[{role:'system',content:[{type:'input_text',text:'You are GrowthOS AI Mentor. Your only job is to help a student solve doubts about the project they are building. Be practical, technical, encouraging and concise. Use the project context. Do not invent project state. If code is provided, reason about it carefully. Give steps, not generic motivation.'}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({student:{name:student.name,goal:student.goal,projectName:student.projectName,stack:student.stack,progress:student.progress},workspace:{code:workspace?.code||'',language:workspace?.language||''},question:message})}]}]};
  return fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(payload)}).then(r=>r.ok?r.json():null).then(x=>x?.output?.flatMap(o=>o.content||[]).map(c=>c.text).filter(Boolean).join('\n')||null).catch(()=>null);
}
function xmlEscape(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function crc32(buf){let table=crc32.table;if(!table){table=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}crc32.table=table;}let c=0xffffffff;for(const b of buf)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0,0);return b;}
function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n,0);return b;}
function zipStore(files){
  const chunks=[]; const central=[]; let offset=0;
  for(const f of files){const name=Buffer.from(f.name), data=Buffer.isBuffer(f.data)?f.data:Buffer.from(f.data); const comp=zlib.deflateRawSync(data); const crc=crc32(data); const local=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(comp.length),u32(data.length),u16(name.length),u16(0),name,comp]); chunks.push(local); central.push(Buffer.concat([Buffer.from([0x50,0x4b,0x01,0x02]),u16(20),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(comp.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name])); offset+=local.length; }
  const cd=Buffer.concat(central); const end=Buffer.concat([Buffer.from([0x50,0x4b,0x05,0x06]),u16(0),u16(0),u16(files.length),u16(files.length),u32(cd.length),u32(offset),u16(0)]); return Buffer.concat([...chunks,cd,end]);
}
function makeXlsx(rows){
  const sheetRows=rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>`<c r="${String.fromCharCode(65+c)}${r+1}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`).join('')}</row>`).join('');
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Registrations" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rel=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wbrel=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const ct=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  return zipStore([{name:'[Content_Types].xml',data:ct},{name:'_rels/.rels',data:rel},{name:'xl/workbook.xml',data:workbook},{name:'xl/_rels/workbook.xml.rels',data:wbrel},{name:'xl/worksheets/sheet1.xml',data:sheet}]);
}
async function route(req,res){
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'});return res.end();}
  const url=new URL(req.url,`http://${req.headers.host}`); const d=load(); const p=url.pathname;
  if(p==='/api/health') return json(res,{status:'healthy',service:'GrowthOS API',port:4000,database:'connected',timestamp:now(),records:{registrations:d.registrations.length,students:d.students.length,referrals:d.referrals.length}});
  if(p==='/api/campaign'&&req.method==='GET') return json(res,{...d.campaign,stats:registrationStats(d)});
  if(p==='/api/summary'&&req.method==='GET') return json(res,{stats:registrationStats(d),channels:channelStats(d),leaderboard:leaderboard(d).slice(0,10),referrals:d.referrals});
  if(p==='/api/registrations'&&req.method==='GET') return json(res,d.registrations);
  if(p==='/api/registrations'&&req.method==='POST'){
    const x=await body(req); const required=['name','email','phone','college','branch','graduationYear']; const missing=required.filter(k=>!clean(x[k])); if(missing.length)return json(res,{error:`Missing required fields: ${missing.join(', ')}`},400);
    const email=clean(x.email,200).toLowerCase(); if(d.registrations.some(r=>r.email===email))return json(res,{error:'This email is already registered.'},409);
    const created=now(); const referralCode=`AI60-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const reg={id:id('reg'),name:clean(x.name),email,phone:clean(x.phone,40),college:clean(x.college),branch:clean(x.branch,120),graduationYear:clean(x.graduationYear,20),goal:clean(x.goal,500),projectName:clean(x.projectName,160),stack:clean(x.stack,300),source:clean(x.source,100)||'Direct',referralCode,referrerCode:clean(x.referrerCode,80),createdAt:created};
    const student={id:id('stu'),name:reg.name,email:reg.email,phone:reg.phone,college:reg.college,branch:reg.branch,graduationYear:reg.graduationYear,goal:reg.goal,projectName:reg.projectName||'My AI Project',stack:reg.stack,referralCode,createdAt:created,progress:0,streak:0,lastActiveAt:null};
    d.registrations.push(reg); d.students.push(student);
    if(reg.referrerCode){const parent=d.students.find(s=>s.referralCode===reg.referrerCode); if(parent&&parent.id!==student.id)d.referrals.push({id:id('ref'),referrerId:parent.id,referredStudentId:student.id,createdAt:created});}
    save(d); return json(res,{registration:reg,student},201);
  }
  if(p==='/api/student-login'&&req.method==='POST'){
    const x=await body(req); const email=clean(x.email,200).toLowerCase(); const s=d.students.find(s=>s.email===email); return s?json(res,{student:s},200):json(res,{error:'No student found for that email. Register first.'},404);
  }
  if(p==='/api/students'&&req.method==='GET') return json(res,d.students.map(s=>({...s,referrals:d.referrals.filter(r=>r.referrerId===s.id).length})));
  if(p.startsWith('/api/students/')&&p.endsWith('/checkpoints')&&req.method==='GET'){const sid=p.split('/')[3];return json(res,d.checkpoints.filter(c=>c.studentId===sid));}
  if(p.startsWith('/api/students/')&&p.endsWith('/checkpoints')&&req.method==='POST'){
    const sid=p.split('/')[3],s=d.students.find(s=>s.id===sid); if(!s)return json(res,{error:'Student not found'},404); const x=await body(req); const progress=Math.max(0,Math.min(100,Number(x.progress))); if(!clean(x.title))return json(res,{error:'Checkpoint title is required'},400);
    const created=now(); const c={id:id('cp'),studentId:sid,title:clean(x.title,160),description:clean(x.description,800),progress,createdAt:created}; d.checkpoints.push(c); s.progress=Math.max(s.progress||0,progress); const day=new Date(created).toISOString().slice(0,10); const last=s.lastActiveAt?s.lastActiveAt.slice(0,10):null; if(day!==last)s.streak=(s.streak||0)+1; s.lastActiveAt=created; save(d); return json(res,c,201);
  }
  if(p.startsWith('/api/students/')&&req.method==='GET'){const sid=p.split('/')[3];const s=d.students.find(s=>s.id===sid);if(!s)return json(res,{error:'Student not found'},404);return json(res,{student:{...s,referrals:d.referrals.filter(r=>r.referrerId===sid).length},checkpoints:d.checkpoints.filter(c=>c.studentId===sid),mentorMessages:d.mentorMessages.filter(m=>m.studentId===sid),workspace:d.codeWorkspaces.find(w=>w.studentId===sid)||{studentId:sid,language:'javascript',code:''}})}
  if(p==='/api/workspace'&&req.method==='POST'){const x=await body(req),s=d.students.find(s=>s.id===x.studentId);if(!s)return json(res,{error:'Student not found'},404);let w=d.codeWorkspaces.find(w=>w.studentId===s.id);if(!w){w={id:id('ws'),studentId:s.id,createdAt:now()};d.codeWorkspaces.push(w)}w.language=clean(x.language,40)||'javascript';w.code=String(x.code||'').slice(0,30000);w.updatedAt=now();save(d);return json(res,w);}
  if(p==='/api/referrals'&&req.method==='GET')return json(res,d.referrals);
  if(p==='/api/leaderboard'&&req.method==='GET')return json(res,leaderboard(d));
  if(p==='/api/budget'&&req.method==='GET')return json(res,{cap:d.campaign.budget,spent:spent(d),remaining:d.campaign.budget-spent(d),log:d.budgetLog});
  if(p==='/api/budget'&&req.method==='POST'){const x=await body(req),amount=Number(x.amount);if(!Number.isFinite(amount)||amount<=0)return json(res,{error:'Enter a positive spend amount.'},400);if(spent(d)+amount>d.campaign.budget)return json(res,{error:`This spend exceeds the ₹${d.campaign.budget} campaign cap.`},400);const item={id:id('spend'),amount,channel:clean(x.channel,100)||'Other',note:clean(x.note,500),createdAt:now()};d.budgetLog.push(item);save(d);return json(res,item,201);}
  if(p==='/api/strategy'&&req.method==='POST'){const x=await body(req);const result=buildStrategy(d,x);d.strategyRuns.unshift({id:id('strategy'),...result});d.strategyRuns=d.strategyRuns.slice(0,20);save(d);return json(res,result);}
  if(p==='/api/strategy/history'&&req.method==='GET')return json(res,d.strategyRuns);
  if(p==='/api/mentor'&&req.method==='POST'){const x=await body(req),s=d.students.find(s=>s.id===x.studentId);if(!s)return json(res,{error:'Student not found'},404);const w=d.codeWorkspaces.find(w=>w.studentId===s.id);let reply=mentorFallback(s,clean(x.message,2000),w);const ai=await mentorWithOpenAI(s,clean(x.message,2000),w);if(ai)reply=ai;const msg={id:id('mentor'),studentId:s.id,message:clean(x.message,2000),reply,createdAt:now()};d.mentorMessages.push(msg);save(d);return json(res,msg);}
  if(p==='/api/export/registrations.xlsx'&&req.method==='GET'){
    const headers=['Registration ID','Name','Email','Phone','College','Branch','Graduation Year','Goal','Project Name','Stack','Source','Referral Code','Referrer Code','Registered At'];
    const rows=[headers,...d.registrations.map(r=>[r.id,r.name,r.email,r.phone,r.college,r.branch,r.graduationYear,r.goal,r.projectName,r.stack,r.source,r.referralCode,r.referrerCode,r.createdAt])];
    const xlsx=makeXlsx(rows);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="GrowthOS_Registration_Registry.xlsx"','Content-Length':xlsx.length});return res.end(xlsx);
  }
  return json(res,{error:'Route not found'},404);
}
http.createServer((req,res)=>route(req,res).catch(e=>{console.error(e);json(res,{error:e.message},500)})).listen(PORT,()=>console.log(`GrowthOS API ready on http://localhost:${PORT}`));
