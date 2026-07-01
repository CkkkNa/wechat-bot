require('dotenv').config();
const express = require('express');
const axios = require('axios');
const {execFile} = require('child_process');
const {parseStringPromise} = require('xml2js');
const fs = require('fs');
const localtunnel = require('localtunnel');

const app = express();
app.use(express.json({limit:'128kb'}));
app.use(express.urlencoded({extended:true}));

const PORT = process.env.PORT || 3001;
const CORPID = process.env.CORPID;
const AGENTID = process.env.AGENTID;
const SECRET = process.env.SECRET;
const DEFAULT_TOUSER = process.env.DEFAULT_TOUSER || '';

function logErr(...args){
  fs.appendFileSync('./error.log', new Date().toISOString()+" "+args.join(' ')+"\n");
}

async function getAccessToken(){
  if(!CORPID || !SECRET) throw new Error('CORPID or SECRET missing');
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORPID}&corpsecret=${SECRET}`;
  const r = await axios.get(url,{timeout:5000});
  if(r.data && r.data.access_token) return r.data.access_token;
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
  }catch(e){
    logErr('sendReply error',e.message||e);
    return {err:e.message||String(e)};
  }
}

async function runCopilotPrompt(text){
  return new Promise((resolve)=>{
    const cmd = 'copilot';
    const args = ['-p', text];
    execFile(cmd, args, {timeout:20000}, (err, stdout, stderr)=>{
      if(err){
        logErr('copilot error', err.message || stderr || '');
        // fallback: echo back
        resolve('（copilot 调用失败）'+(stdout?stdout:stderr?stderr:err.message));
      } else {
        resolve(stdout.toString().trim() || '(无输出)');
      }
    });
  });
}

app.post('/wechat/callback', async (req,res)=>{
  try{
    let data = req.body;
    // if body is empty, try raw xml from req
    if(!data || Object.keys(data).length===0){
      let raw = '';
      req.setEncoding('utf8');
      for await (const chunk of req){ raw += chunk; }
      if(raw.startsWith('<')){
        // xml
        const parsed = await parseStringPromise(raw, {explicitArray:false});
        // typical enterprise wechat xml fields: ToUserName, FromUserName, MsgType, Content
        data = parsed.xml || parsed;
      }
    }
    const from = data.FromUserName || data.from || data.From || DEFAULT_TOUSER;
    const msg = (data.Content || data.content || data.msg || '') + '';
    if(!msg){
      res.json({err:'no text'});
      return;
    }
    // run copilot
    const reply = await runCopilotPrompt(msg);
    // send reply back via enterprise wechat API
    const r = await sendReply(from, reply);
    res.json({ok:true, sendResult:r});
  }catch(err){
    logErr('callback error', err.message||err);
    res.status(500).json({error:err.message||String(err)});
  }
});

app.get('/health', (req,res)=>{res.json({ok:true, time:Date.now()})});

app.listen(PORT, async ()=>{
  console.log('Wechat bot listening on',PORT);
  // attempt to start localtunnel
  try{
    const tunnel = await localtunnel({port:PORT});
    console.log('Tunnel URL:', tunnel.url);
    tunnel.on('close', ()=>{ console.log('Tunnel closed'); });
  }catch(e){
    console.error('localtunnel start failed', e.message||e);
    logErr('localtunnel start failed', e.message||e);
  }
});
