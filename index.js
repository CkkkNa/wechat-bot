require('dotenv').config();
const express = require('express');
const axios = require('axios');
const {execFile} = require('child_process');
const {parseStringPromise} = require('xml2js');
const fs = require('fs');
const localtunnel = require('localtunnel');

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

function logErr(...args){
  fs.appendFileSync('./error.log', new Date().toISOString()+" "+args.join(' ')+"\n");
}

// simple in-memory task queue with persistence to tasks.json
const TASKS_FILE = './tasks.json';
let tasks = [];
if(fs.existsSync(TASKS_FILE)){
  try{ tasks = JSON.parse(fs.readFileSync(TASKS_FILE)); }catch(e){ tasks = []; }
}
function persistTasks(){ fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks,null,2)); }
function enqueueTask(task){ task.id = (tasks.length?tasks[tasks.length-1].id:0)+1; task.status='pending'; task.created_at = new Date().toISOString(); tasks.push(task); persistTasks(); return task; }
function updateTask(id, changes){ const t = tasks.find(x=>x.id===id); if(t){ Object.assign(t,changes); persistTasks(); } return t; }

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

// worker: process pending tasks sequentially
let workerRunning = false;
async function workerLoop(){ if(workerRunning) return; workerRunning = true;
  while(true){ const next = tasks.find(t=>t.status==='pending'); if(!next) break; try{ updateTask(next.id,{status:'running', started_at:new Date().toISOString()}); await sendReply(next.from, `任务 ${next.id} 开始执行：${next.command||next.text}`);
      // simulate progress
      updateTask(next.id,{progress:10}); await sendReply(next.from, `任务 ${next.id} 进度：10%`);
      const out = await runCopilotPrompt(next.text || next.command);
      updateTask(next.id,{progress:90}); await sendReply(next.from, `任务 ${next.id} 进度：90%`);
      updateTask(next.id,{status:'done', result:out, finished_at:new Date().toISOString(), progress:100});
      await sendReply(next.from, `任务 ${next.id} 完成。
结果：\n${out}`);
    }catch(err){ logErr('worker error', err.message||err); updateTask(next.id,{status:'failed',error:err.message||String(err)}); await sendReply(next.from, `任务 ${next.id} 执行失败：${err.message||err}`); }
  }
  workerRunning = false;
}

// simple signature verification placeholder (Enterprise WeChat)
function verifySignature(query){
  // query: {msg_signature, timestamp, nonce}
  // For production, implement the signature verification per WeChat docs using TOKEN, timestamp, nonce, and request body
  return true;
}

// decrypt placeholder
function decryptMessage(encrypt){
  // If EncodingAESKey is provided, implement AES decrypt here. For now return encrypt as-is for demo.
  return encrypt;
}

app.post('/wechat/callback', async (req,res)=>{
  try{
    // verify signature if present
    if(!verifySignature(req.query)) return res.status(400).send('signature failed');
    let data = req.body;
    if(!data || Object.keys(data).length===0){ let raw=''; req.setEncoding('utf8'); for await (const chunk of req) raw += chunk; if(raw.startsWith('<')){ const parsed = await parseStringPromise(raw,{explicitArray:false}); data = parsed.xml || parsed; } }
    // handle encrypted payload
    if(data.Encrypt){ const decrypted = decryptMessage(data.Encrypt); // parse decrypted xml
      try{ const parsed = await parseStringPromise(decrypted,{explicitArray:false}); data = parsed.xml || parsed; }catch(e){ /* continue */ }
    }
    const from = data.FromUserName || data.From || data.from || DEFAULT_TOUSER;
    const msg = (data.Content || data.content || data.Msg || data.msg || '').toString();
    if(!msg){ res.json({err:'no text'}); return; }
    // Command parsing: if message starts with /task then treat as a task; otherwise wrap as quick task
    let taskPayload = {};
    if(msg.trim().startsWith('/task')){
      // allow /task {"command":"..."}
      const rest = msg.trim().slice(5).trim();
      try{ taskPayload = JSON.parse(rest); }catch(e){ taskPayload = {command: rest || ''}; }
    } else {
      taskPayload = {command: msg};
    }
    const task = enqueueTask({from, text: taskPayload.command || taskPayload.text || msg, meta: taskPayload.meta||null});
    // acknowledge immediately
    await sendReply(from, `已接收任务 ${task.id}，稍后开始执行。`);
    // trigger worker
    workerLoop().catch(e=>logErr('workerLoop',e));
    res.json({ok:true,task_id:task.id});
  }catch(err){ logErr('callback error', err.message||err); res.status(500).json({error:err.message||String(err)}); }
});

app.get('/tasks', (req,res)=>{ res.json(tasks); });
app.get('/tasks/:id', (req,res)=>{ const id = parseInt(req.params.id); const t = tasks.find(x=>x.id===id); if(!t) return res.status(404).json({error:'not found'}); res.json(t); });

app.get('/health',(req,res)=>res.json({ok:true}));

app.listen(PORT, async ()=>{
  console.log('Wechat bot listening on',PORT);
  // try to start localtunnel but ignore errors
  try{ const tunnel = await localtunnel({port:PORT}); console.log('Tunnel URL:', tunnel.url); tunnel.on('close', ()=>{ console.log('Tunnel closed'); }); }catch(e){ console.error('localtunnel start failed', e.message||e); logErr('localtunnel start failed', e.message||e); }
});
