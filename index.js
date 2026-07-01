require('dotenv').config();
const express = require('express');
const axios = require('axios');
const {execFile} = require('child_process');
const {parseStringPromise} = require('xml2js');
const fs = require('fs');
const crypto = require('crypto');
const localtunnel = require('localtunnel');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json({limit:'256kb'}));
app.use(express.urlencoded({extended:true}));

const PORT = process.env.PORT || 3001;
const CORPID = process.env.CORPID;
const AGENTID = process.env.AGENTID;
const SECRET = process.env.SECRET;
const DEFAULT_TOUSER = process.env.DEFAULT_TOUSER || '';
const TOKEN = process.env.TOKEN || '';
const ENCODING_AES_KEY = process.env.ENCODING_AES_KEY || '';
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').filter(Boolean); // optional

function logErr(...args){
  fs.appendFileSync('./error.log', new Date().toISOString()+" "+args.join(' ')+"\n");
}

// SQLite tasks DB
const DB_FILE = './data/tasks.db';
fs.mkdirSync('./data', { recursive: true });
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT,
    command TEXT,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    result TEXT,
    error TEXT,
    created_at TEXT,
    started_at TEXT,
    finished_at TEXT
  )`);
});

function enqueueTaskToDB(task){
  return new Promise((resolve, reject)=>{
    const now = new Date().toISOString();
    db.run(`INSERT INTO tasks (from_user,command,status,progress,created_at) VALUES (?,?,?,?,?)`, [task.from, task.text, 'pending', 0, now], function(err){
      if(err) return reject(err);
      db.get('SELECT * FROM tasks WHERE id=?',[this.lastID], (e,row)=> e?reject(e):resolve(row));
    });
  });
}
function updateTaskInDB(id,changes){
  const sets = []; const vals = [];
  Object.keys(changes).forEach(k=>{ sets.push(k+'=?'); vals.push(changes[k]); });
  if(sets.length===0) return Promise.resolve();
  vals.push(id);
  return new Promise((resolve,reject)=>{
    db.run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`, vals, function(err){ if(err) return reject(err); db.get('SELECT * FROM tasks WHERE id=?',[id],(e,row)=> e?reject(e):resolve(row)); });
  });
}
function getNextPending(){
  return new Promise((resolve,reject)=>{
    db.get("SELECT * FROM tasks WHERE status='pending' ORDER BY id LIMIT 1", [], (err,row)=>{ if(err) return reject(err); resolve(row); });
  });
}

// Access token cache
let _accessToken = null; let _tokenExpiresAt = 0;
async function getAccessToken(){
  const now = Date.now(); if(_accessToken && now < _tokenExpiresAt) return _accessToken;
  if(!CORPID || !SECRET) throw new Error('CORPID or SECRET missing');
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORPID}&corpsecret=${SECRET}`;
  const r = await axios.get(url,{timeout:5000});
  if(r.data && r.data.access_token){ _accessToken=r.data.access_token; _tokenExpiresAt = now + (r.data.expires_in||7200)*1000 - 60000; return _accessToken; }
  throw new Error('token error:'+JSON.stringify(r.data));
}

async function sendReply(toUser, content){
  try{
    const token = await getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
    const body = {
      touser: toUser || DEFAULT_TOUSER || '@all',
      agentid: parseInt(AGENTID||0) || 0,
      msgtype: 'text',
      text: {content: content}
    };
    const r = await axios.post(url, body, {timeout:5000});
    return r.data;
  }catch(e){ logErr('sendReply error', e.message||e); return {err:e.message||String(e)}; }
}

async function runCopilotPrompt(text){
  return new Promise((resolve)=>{
    const cmd = 'copilot';
    const args = ['-p', text];
    execFile(cmd, args, {timeout:20000}, (err, stdout, stderr)=>{
      if(err){ logErr('copilot error', err.message || stderr || ''); resolve('（copilot 调用失败）'+(stdout?stdout:stderr?stderr:err.message)); }
      else { resolve(stdout.toString().trim() || '(无输出)'); }
    });
  });
}

// worker
let workerRunning = false;
async function workerLoop(){ if(workerRunning) return; workerRunning = true;
  try{
    while(true){
      const next = await getNextPending(); if(!next) break;
      await updateTaskInDB(next.id,{status:'running',started_at:new Date().toISOString()});
      await sendReply(next.from_user, `任务 ${next.id} 开始执行：${next.command}`);
      await updateTaskInDB(next.id,{progress:10});
      await sendReply(next.from_user, `任务 ${next.id} 进度：10%`);
      const out = await runCopilotPrompt(next.command);
      await updateTaskInDB(next.id,{progress:90,result:out});
      await sendReply(next.from_user, `任务 ${next.id} 进度：90%`);
      await updateTaskInDB(next.id,{status:'done',progress:100,finished_at:new Date().toISOString()});
      await sendReply(next.from_user, `任务 ${next.id} 完成。\n结果：\n${out}`);
    }
  }catch(err){ logErr('workerLoop error', err.message||err); }
  workerRunning = false;
}

// verify signature and decrypt
function sha1(str){ return crypto.createHash('sha1').update(str).digest('hex'); }
function verifySignature(query, encrypt){
  try{
    if(!TOKEN) return true; // no token configured -> skip
    const arr = [TOKEN, query.timestamp||'', query.nonce||'', encrypt||''];
    arr.sort();
    const sign = sha1(arr.join(''));
    return sign === (query.msg_signature || query.msgSignature || query.signature || '');
  }catch(e){ logErr('verifySignature error', e.message||e); return false; }
}

function pkcs7Decode(buffer){
  const pad = buffer[buffer.length-1];
  if(pad <1 || pad >32) return buffer;
  return buffer.slice(0, buffer.length - pad);
}

function decryptMessage(encrypt){
  if(!ENCODING_AES_KEY) return encrypt; // no AES key -> assume plaintext
  try{
    const AESKey = Buffer.from(ENCODING_AES_KEY + '=', 'base64');
    const iv = AESKey.slice(0,16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', AESKey, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypt, 'base64'), decipher.final()]);
    decrypted = pkcs7Decode(decrypted);
    // skip 16 random bytes
    const content = decrypted.slice(16);
    const lenBuf = content.slice(0,4);
    const msgLen = lenBuf.readUInt32BE(0);
    const msg = content.slice(4,4+msgLen).toString();
    const fromCorpId = content.slice(4+msgLen).toString();
    if(fromCorpId !== CORPID){ logErr('corpId mismatch', fromCorpId); }
    return msg;
  }catch(e){ logErr('decryptMessage error', e.message||e); return encrypt; }
}

app.post('/wechat/callback', async (req,res)=>{
  try{
    // read raw body if needed
    let rawBody = '';
    if(req.body && Object.keys(req.body).length>0) rawBody = null; else { req.setEncoding('utf8'); for await (const chunk of req) rawBody += chunk; }
    // parse xml if needed
    let data = req.body;
    if((!data || Object.keys(data).length===0) && rawBody && rawBody.startsWith('<')){
      const parsed = await parseStringPromise(rawBody,{explicitArray:false}); data = parsed.xml || parsed;
    }
    // if encrypted
    const encrypt = (data && data.Encrypt) || (data && data.encrypt) || null;
    if(!verifySignature(req.query, encrypt)){
      logErr('signature verification failed', JSON.stringify(req.query)); return res.status(400).send('signature fail');
    }
    if(encrypt){ const dec = decryptMessage(encrypt); const parsed = await parseStringPromise(dec,{explicitArray:false}); data = parsed.xml || parsed; }
    const from = data.FromUserName || data.From || data.from || DEFAULT_TOUSER;
    const msg = (data.Content || data.content || data.Msg || data.msg || '').toString();
    if(!msg){ res.json({err:'no text'}); return; }
    // whitelist check
    if(ALLOWED_USERS.length>0 && !ALLOWED_USERS.includes(from)){
      await sendReply(from, '您无权限执行命令'); return res.json({ok:false,reason:'not allowed'});
    }
    let taskPayload = {};
    if(msg.trim().startsWith('/task')){
      const rest = msg.trim().slice(5).trim();
      try{ taskPayload = JSON.parse(rest); }catch(e){ taskPayload = {command: rest || ''}; }
    } else {
      taskPayload = {command: msg};
    }
    const task = await enqueueTaskToDB({from, text: taskPayload.command || taskPayload.text || msg});
    await sendReply(from, `已接收任务 ${task.id}，稍后开始执行。`);
    workerLoop().catch(e=>logErr('workerLoop',e));
    res.json({ok:true,task_id:task.id});
  }catch(err){ logErr('callback error', err.message||err); res.status(500).json({error:err.message||String(err)}); }
});

app.get('/tasks', (req,res)=>{ db.all('SELECT * FROM tasks ORDER BY id DESC',[],(err,rows)=>{ if(err) return res.status(500).json({error:err.message}); res.json(rows); }); });
app.get('/tasks/:id', (req,res)=>{ const id = parseInt(req.params.id); db.get('SELECT * FROM tasks WHERE id=?',[id],(err,row)=>{ if(err) return res.status(500).json({error:err.message}); if(!row) return res.status(404).json({error:'not found'}); res.json(row); }); });

app.get('/health',(req,res)=>res.json({ok:true}));

app.listen(PORT, async ()=>{
  console.log('Wechat bot listening on',PORT);
  try{ const tunnel = await localtunnel({port:PORT}); console.log('Tunnel URL:', tunnel.url); tunnel.on('close', ()=>{ console.log('Tunnel closed'); }); }catch(e){ console.error('localtunnel start failed', e.message||e); logErr('localtunnel start failed', e.message||e); }
});
