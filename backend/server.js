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
if (!process.env.DATABASE_URL || !jwtSecret) throw new Error('DATABASE_URL و JWT_SECRET الزامی هستند.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized:true } });
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => { if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true); return cb(new Error('CORS_ORIGIN_NOT_ALLOWED')); } }));
app.disable('x-powered-by');
app.use(express.json({ limit:'12mb' }));

const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const maxFile = Number(process.env.MAX_FILE_SIZE_MB || 100) * 1024 * 1024;
const upload = multer({ dest: uploadDir, limits:{fileSize:maxFile} });

function issueToken(t){ return jwt.sign({sub:t.id,username:t.username},jwtSecret,{expiresIn:'30d'}); }
async function auth(req,res,next){
  try{ const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):''; req.user=jwt.verify(token,jwtSecret); next(); }
  catch{ res.status(401).json({error:'UNAUTHORIZED'}); }
}
function validUsername(u){ return /^[^\s]{3,32}$/.test(String(u||'')); }

app.get('/api/health',(_,res)=>res.json({ok:true,service:'daftar-kelasi',time:new Date().toISOString()}));
app.post('/api/auth/register',async(req,res)=>{
  const username=String(req.body?.username||'').trim(), password=String(req.body?.password||'');
  if(!validUsername(username)||password.length<6) return res.status(400).json({error:'INVALID_CREDENTIALS'});
  try{
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query('INSERT INTO teachers(username,password_hash) VALUES($1,$2) RETURNING id,username',[username,hash]);
    const t=r.rows[0];
    await pool.query('INSERT INTO teacher_snapshots(teacher_id,revision,payload) VALUES($1,$2,$3)',[t.id,'initial',{}]);
    res.status(201).json({token:issueToken(t),teacher:{id:t.id,username:t.username}});
  }catch(e){ if(e.code==='23505') return res.status(409).json({error:'USERNAME_EXISTS'}); res.status(500).json({error:'SERVER_ERROR'}); }
});
app.post('/api/auth/login',async(req,res)=>{
  const username=String(req.body?.username||'').trim(), password=String(req.body?.password||'');
  const r=await pool.query('SELECT id,username,password_hash FROM teachers WHERE lower(username)=lower($1)',[username]);
  if(!r.rowCount || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:'INVALID_CREDENTIALS'});
  const t=r.rows[0]; res.json({token:issueToken(t),teacher:{id:t.id,username:t.username}});
});
app.get('/api/sync/pull',auth,async(req,res)=>{
  const r=await pool.query('SELECT revision,payload,updated_at FROM teacher_snapshots WHERE teacher_id=$1',[req.user.sub]);
  res.json(r.rows[0]||{revision:'initial',payload:{},updated_at:null});
});
app.post('/api/sync/push',auth,async(req,res)=>{
  const revision=String(req.body?.revision||''), baseRevision=String(req.body?.baseRevision||''), payload=req.body?.payload;
  if(!revision || payload===undefined) return res.status(400).json({error:'INVALID_SYNC_PAYLOAD'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=await client.query('SELECT revision,payload,updated_at FROM teacher_snapshots WHERE teacher_id=$1 FOR UPDATE',[req.user.sub]);
    const currentRevision=current.rowCount ? current.rows[0].revision : 'initial';
    if(baseRevision && currentRevision !== baseRevision && currentRevision !== revision){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'SYNC_CONFLICT',revision:currentRevision,payload:current.rows[0].payload,updated_at:current.rows[0].updated_at});
    }
    await client.query('INSERT INTO sync_events(teacher_id,revision,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[req.user.sub,revision,payload]);
    await client.query('INSERT INTO teacher_snapshots(teacher_id,revision,payload) VALUES($1,$2,$3) ON CONFLICT(teacher_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now()',[req.user.sub,revision,payload]);
    await client.query('COMMIT'); res.json({ok:true,revision});
  }catch(e){ await client.query('ROLLBACK'); res.status(500).json({error:'SYNC_FAILED'}); } finally{client.release();}
});
app.post('/api/files',auth,upload.single('file'),async(req,res)=>{
  if(!req.file) return res.status(400).json({error:'FILE_REQUIRED'});
  const ext=path.extname(req.file.originalname).slice(0,12); const safe=crypto.randomUUID()+ext; const target=path.join(uploadDir,safe);
  fs.renameSync(req.file.path,target);
  res.status(201).json({id:safe,name:req.file.originalname,size:req.file.size,mime:req.file.mimetype});
});
app.use((err,req,res,next)=>{ if(err?.code==='LIMIT_FILE_SIZE') return res.status(413).json({error:'FILE_TOO_LARGE'}); res.status(500).json({error:'SERVER_ERROR'}); });
app.listen(port,()=>console.log(`Daftar backend listening on ${port}`));
