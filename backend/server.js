import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 8080);
const jwtSecret = process.env.JWT_SECRET;
if (!process.env.DATABASE_URL || !jwtSecret || jwtSecret.length < 32) throw new Error('DATABASE_URL و JWT_SECRET با حداقل ۳۲ نویسه الزامی هستند.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized:true } });
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => { if (!origin || allowedOrigins.includes(origin)) return cb(null, true); return cb(null, false); } }));
app.disable('x-powered-by');
app.use(express.json({ limit:'12mb' }));

const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const maxFile = Number(process.env.MAX_FILE_SIZE_MB || 20) * 1024 * 1024;
const allowedMime = new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const upload = multer({ dest: uploadDir, limits:{fileSize:maxFile, files:1}, fileFilter:(_req,file,cb)=>cb(null,allowedMime.has(file.mimetype)) });

function issueToken(t){ return jwt.sign({sub:t.id,username:t.username,role:t.role||'teacher',schoolId:t.school_id||null},jwtSecret,{expiresIn:'12h'}); }
async function auth(req,res,next){
  try{
    const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):'';
    const claims=jwt.verify(token,jwtSecret);
    const r=await pool.query('SELECT id,username,role,school_id FROM teachers WHERE id=$1',[claims.sub]);
    if(!r.rowCount) return res.status(401).json({error:'UNAUTHORIZED'});
    req.user=r.rows[0]; next();
  }catch{ res.status(401).json({error:'UNAUTHORIZED'}); }
}
function adminOnly(req,res,next){ if(req.user?.role!=='admin') return res.status(403).json({error:'ADMIN_REQUIRED'}); if(!req.user.school_id) return res.status(403).json({error:'ADMIN_SCHOOL_REQUIRED'}); next(); }
function validUsername(u){ return /^[^\s]{3,32}$/.test(String(u||'')); }
function safeSchoolCode(){ return crypto.randomBytes(6).toString('hex').toUpperCase(); }
function number(v){ return Number.isFinite(Number(v)) ? Number(v) : 0; }
function summarizePayload(payload){
  const classes=[]; let studentCount=0, attendanceRecords=0, absentRecords=0, lateRecords=0;
  if(payload && typeof payload==='object'){
    for(const [key,value] of Object.entries(payload)){
      if(!value || typeof value!=='object' || !Array.isArray(value.students)) continue;
      const students=value.students; studentCount+=students.length;
      const attendance=Array.isArray(value.attendance)?value.attendance:[]; attendanceRecords+=attendance.length;
      absentRecords+=attendance.filter(a=>/غایب|غائب|absent/i.test(String(a.status||a.state||''))).length;
      lateRecords+=attendance.filter(a=>/تأخیر|تاخیر|late/i.test(String(a.status||a.state||''))).length;
      classes.push({classKey:key,className:String(value.name||value.className||value.grade||key),studentCount:students.length,attendanceRecords:attendance.length,absentRecords:attendance.filter(a=>/غایب|غائب|absent/i.test(String(a.status||a.state||''))).length,lateRecords:attendance.filter(a=>/تأخیر|تاخیر|late/i.test(String(a.status||a.state||''))).length});
    }
  }
  return {studentCount,classes,attendanceRecords,absentRecords,lateRecords};
}

app.get('/api/health',(_,res)=>res.json({ok:true,service:'daftar-kelasi',time:new Date().toISOString(),version:'2.0.0'}));

// One-time bootstrap endpoint. Set ADMIN_SETUP_KEY on the server and call it only over HTTPS.
app.post('/api/admin/setup',async(req,res)=>{
  const setupKey=String(req.headers['x-admin-setup-key']||'');
  if(!process.env.ADMIN_SETUP_KEY || process.env.ADMIN_SETUP_KEY.length<20 || setupKey.length<20 || Buffer.byteLength(setupKey)!==Buffer.byteLength(process.env.ADMIN_SETUP_KEY) || !crypto.timingSafeEqual(Buffer.from(setupKey),Buffer.from(process.env.ADMIN_SETUP_KEY))) return res.status(403).json({error:'SETUP_FORBIDDEN'});
  const schoolName=String(req.body?.schoolName||'').trim().slice(0,160);
  const username=String(req.body?.username||'').trim();
  const password=String(req.body?.password||'');
  if(!schoolName || !validUsername(username) || password.length<10) return res.status(400).json({error:'INVALID_SETUP_DATA',message:'نام مدرسه و نام کاربری لازم است؛ رمز مدیر حداقل ۱۰ نویسه باشد.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(731945210)');
    const existing=await client.query("SELECT 1 FROM teachers WHERE role='admin' LIMIT 1");
    if(existing.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({error:'ADMIN_ALREADY_INITIALIZED'}); }
    const code=safeSchoolCode();
    const school=(await client.query('INSERT INTO schools(name,join_code) VALUES($1,$2) RETURNING id,name,join_code',[schoolName,code])).rows[0];
    const hash=await bcrypt.hash(password,12);
    const admin=(await client.query("INSERT INTO teachers(username,password_hash,role,school_id) VALUES($1,$2,'admin',$3) RETURNING id,username,role,school_id",[username,hash,school.id])).rows[0];
    await client.query('INSERT INTO teacher_snapshots(teacher_id,revision,payload) VALUES($1,$2,$3)',[admin.id,'initial',{}]);
    await client.query('COMMIT');
    res.status(201).json({ok:true,school:{name:school.name,joinCode:school.join_code},admin:{username:admin.username,role:admin.role},message:'کد عضویت مدرسه را فقط در اختیار معلمان مورد تأیید قرار دهید.'});
  }catch(e){ await client.query('ROLLBACK'); if(e.code==='23505') return res.status(409).json({error:'USERNAME_EXISTS'}); res.status(500).json({error:'SERVER_ERROR'}); }finally{client.release();}
});

app.post('/api/auth/register',async(req,res)=>{
  const username=String(req.body?.username||'').trim(), password=String(req.body?.password||''), schoolCode=String(req.body?.schoolCode||'').trim().toUpperCase();
  if(!validUsername(username)||password.length<6) return res.status(400).json({error:'INVALID_CREDENTIALS'});
  try{
    let schoolId=null;
    if(schoolCode){ const s=await pool.query('SELECT id FROM schools WHERE join_code=$1',[schoolCode]); if(!s.rowCount) return res.status(400).json({error:'INVALID_SCHOOL_CODE'}); schoolId=s.rows[0].id; }
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query("INSERT INTO teachers(username,password_hash,role,school_id) VALUES($1,$2,'teacher',$3) RETURNING id,username,role,school_id",[username,hash,schoolId]);
    const t=r.rows[0];
    await pool.query('INSERT INTO teacher_snapshots(teacher_id,revision,payload) VALUES($1,$2,$3)',[t.id,'initial',{}]);
    res.status(201).json({token:issueToken(t),teacher:{id:t.id,username:t.username,role:t.role,schoolId:t.school_id}});
  }catch(e){ if(e.code==='23505') return res.status(409).json({error:'USERNAME_EXISTS'}); res.status(500).json({error:'SERVER_ERROR'}); }
});
app.post('/api/auth/login',async(req,res)=>{
  const username=String(req.body?.username||'').trim(), password=String(req.body?.password||'');
  const r=await pool.query('SELECT id,username,password_hash,role,school_id FROM teachers WHERE lower(username)=lower($1)',[username]);
  if(!r.rowCount || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:'INVALID_CREDENTIALS'});
  const t=r.rows[0]; res.json({token:issueToken(t),teacher:{id:t.id,username:t.username,role:t.role,schoolId:t.school_id}});
});
app.get('/api/auth/me',auth,async(req,res)=>{
  const r=await pool.query('SELECT t.id,t.username,t.role,t.school_id,s.name AS school_name FROM teachers t LEFT JOIN schools s ON s.id=t.school_id WHERE t.id=$1',[req.user.id]);
  res.json({user:r.rows[0]});
});

app.post('/api/school/join',auth,async(req,res)=>{
  if(req.user.role!=='teacher') return res.status(403).json({error:'TEACHER_ACCOUNT_REQUIRED'});
  const code=String(req.body?.schoolCode||'').trim().toUpperCase();
  if(!code) return res.status(400).json({error:'SCHOOL_CODE_REQUIRED'});
  const s=await pool.query('SELECT id,name FROM schools WHERE join_code=$1',[code]);
  if(!s.rowCount) return res.status(400).json({error:'INVALID_SCHOOL_CODE'});
  await pool.query('UPDATE teachers SET school_id=$1,updated_at=now() WHERE id=$2',[s.rows[0].id,req.user.id]);
  res.json({ok:true,school:{id:s.rows[0].id,name:s.rows[0].name}});
});

app.get('/api/sync/pull',auth,async(req,res)=>{
  const r=await pool.query('SELECT revision,payload,updated_at FROM teacher_snapshots WHERE teacher_id=$1',[req.user.id]);
  res.json(r.rows[0]||{revision:'initial',payload:{},updated_at:null});
});
app.post('/api/sync/push',auth,async(req,res)=>{
  const revision=String(req.body?.revision||''), baseRevision=String(req.body?.baseRevision||''), payload=req.body?.payload;
  if(!revision || revision.length>64 || payload===undefined || !payload || typeof payload!=='object' || Array.isArray(payload)) return res.status(400).json({error:'INVALID_SYNC_PAYLOAD'});
  if(Buffer.byteLength(JSON.stringify(payload),'utf8')>10*1024*1024) return res.status(413).json({error:'SYNC_PAYLOAD_TOO_LARGE'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=await client.query('SELECT revision,payload,updated_at FROM teacher_snapshots WHERE teacher_id=$1 FOR UPDATE',[req.user.id]);
    const currentRevision=current.rowCount ? current.rows[0].revision : 'initial';
    if(baseRevision && currentRevision !== baseRevision && currentRevision !== revision){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'SYNC_CONFLICT',revision:currentRevision,payload:current.rows[0].payload,updated_at:current.rows[0].updated_at});
    }
    await client.query('INSERT INTO sync_events(teacher_id,revision,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[req.user.id,revision,payload]);
    await client.query('INSERT INTO teacher_snapshots(teacher_id,revision,payload) VALUES($1,$2,$3) ON CONFLICT(teacher_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now()',[req.user.id,revision,payload]);
    await client.query('COMMIT'); res.json({ok:true,revision});
  }catch(e){ await client.query('ROLLBACK'); res.status(500).json({error:'SYNC_FAILED'}); } finally{client.release();}
});

app.get('/api/admin/overview',auth,adminOnly,async(req,res)=>{
  const school=await pool.query('SELECT id,name,join_code,created_at FROM schools WHERE id=$1',[req.user.school_id]);
  if(!school.rowCount) return res.status(404).json({error:'SCHOOL_NOT_FOUND'});
  const teachers=await pool.query(`SELECT t.id,t.username,t.role,t.created_at,ts.revision,ts.updated_at,ts.payload
    FROM teachers t LEFT JOIN teacher_snapshots ts ON ts.teacher_id=t.id
    WHERE t.school_id=$1 ORDER BY CASE WHEN t.role='admin' THEN 0 ELSE 1 END,t.username`,[req.user.school_id]);
  let totalStudents=0, totalAttendance=0, totalAbsences=0, totalLate=0, classMap=new Map();
  const staff=teachers.rows.map(t=>{
    const payload=t.payload||{}; const summary=summarizePayload(payload); totalStudents+=summary.studentCount; totalAttendance+=summary.attendanceRecords; totalAbsences+=summary.absentRecords; totalLate+=summary.lateRecords;
    for(const c of summary.classes){ const key=t.id+':'+c.classKey; classMap.set(key,{teacher:t.username,...c}); }
    return {id:t.id,username:t.username,role:t.role,createdAt:t.created_at,lastSync:t.updated_at||null,revision:t.revision||'initial',studentCount:summary.studentCount,attendanceRecords:summary.attendanceRecords,absentRecords:summary.absentRecords,lateRecords:summary.lateRecords,classes:summary.classes};
  });
  res.json({school:school.rows[0],stats:{teacherCount:staff.filter(x=>x.role==='teacher').length,studentCount:totalStudents,classCount:classMap.size,staffCount:staff.length,attendanceRecords:totalAttendance,absentRecords:totalAbsences,lateRecords:totalLate},teachers:staff,classes:[...classMap.values()],generatedAt:new Date().toISOString()});
});
app.get('/api/admin/teacher/:id/snapshot',auth,adminOnly,async(req,res)=>{
  const r=await pool.query(`SELECT t.id,t.username,ts.revision,ts.payload,ts.updated_at FROM teachers t LEFT JOIN teacher_snapshots ts ON ts.teacher_id=t.id WHERE t.id=$1 AND t.school_id=$2 AND t.role='teacher'`,[req.params.id,req.user.school_id]);
  if(!r.rowCount) return res.status(404).json({error:'TEACHER_NOT_FOUND'});
  res.json(r.rows[0]);
});

// مدیر فقط برای معلم عضو مدرسه خودش بازخورد ثبت می‌کند.
app.get('/api/admin/teacher/:id/feedback',auth,adminOnly,async(req,res)=>{
  const teacher=await pool.query("SELECT id FROM teachers WHERE id=$1 AND school_id=$2 AND role='teacher'",[req.params.id,req.user.school_id]);
  if(!teacher.rowCount) return res.status(404).json({error:'TEACHER_NOT_FOUND'});
  const r=await pool.query('SELECT id,message,created_at FROM teacher_feedback WHERE teacher_id=$1 AND school_id=$2 ORDER BY created_at DESC LIMIT 100',[req.params.id,req.user.school_id]);
  res.json({feedback:r.rows});
});
app.post('/api/admin/teacher/:id/feedback',auth,adminOnly,async(req,res)=>{
  const message=String(req.body?.message||'').trim();
  if(!message || message.length>5000) return res.status(400).json({error:'INVALID_FEEDBACK',message:'متن بازخورد باید بین ۱ تا ۵۰۰۰ نویسه باشد.'});
  const teacher=await pool.query("SELECT id FROM teachers WHERE id=$1 AND school_id=$2 AND role='teacher'",[req.params.id,req.user.school_id]);
  if(!teacher.rowCount) return res.status(404).json({error:'TEACHER_NOT_FOUND'});
  const r=await pool.query('INSERT INTO teacher_feedback(school_id,teacher_id,admin_id,message) VALUES($1,$2,$3,$4) RETURNING id,message,created_at',[req.user.school_id,req.params.id,req.user.id,message]);
  res.status(201).json({feedback:r.rows[0]});
});
app.get('/api/teacher/feedback',auth,async(req,res)=>{
  if(req.user.role!=='teacher') return res.status(403).json({error:'TEACHER_ACCOUNT_REQUIRED'});
  const r=await pool.query('SELECT id,message,created_at FROM teacher_feedback WHERE teacher_id=$1 AND school_id=$2 ORDER BY created_at DESC LIMIT 100',[req.user.id,req.user.school_id]);
  res.json({feedback:r.rows});
});

app.post('/api/files',auth,upload.single('file'),async(req,res)=>{
  if(!req.file) return res.status(400).json({error:'FILE_REQUIRED_OR_TYPE_NOT_ALLOWED'});
  const safe=crypto.randomUUID()+path.extname(req.file.originalname).toLowerCase().slice(0,8); const target=path.join(uploadDir,safe);
  fs.renameSync(req.file.path,target);
  res.status(201).json({id:safe,name:path.basename(req.file.originalname).slice(0,180),size:req.file.size,mime:req.file.mimetype});
});
app.use((err,req,res,next)=>{ if(err?.code==='LIMIT_FILE_SIZE') return res.status(413).json({error:'FILE_TOO_LARGE'}); if(err instanceof multer.MulterError) return res.status(400).json({error:'UPLOAD_REJECTED'}); console.error(err); res.status(500).json({error:'SERVER_ERROR'}); });
app.listen(port,()=>console.log(`Daftar backend listening on ${port}`));
