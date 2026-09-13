const ROOM_CODE=/^[A-Z0-9]{6,10}$/;
const enc=new TextEncoder();
function b64(a){return btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function token(){return b64(crypto.getRandomValues(new Uint8Array(32)))}
function clean(s,max){return typeof s==="string"?s.replace(/[\\u0000-\\u001F\\u007F]/g,"").trim().slice(0,max):""}
function json(o,status=200){return new Response(JSON.stringify(o),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function cors(h=new Headers()){h.set("x-content-type-options","nosniff");h.set("referrer-policy","no-referrer");h.set("permissions-policy","camera=(), microphone=(), geolocation=()");h.set("content-security-policy","default-src 'self'; connect-src 'self' wss: https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' data: https://i.ytimg.com https://i.ytimg.com; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");return h}
export default {async fetch(req,env){
  const u=new URL(req.url); const h=cors(new Headers());
  if(u.pathname==="/api/create"&&req.method==="POST"){let x=await req.json().catch(()=>null);if(!x)return json({error:"Invalid request"},400);
    const code=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n%30]).join("");
    const auth=token(); const id=env.ROOMS.idFromName(code); const stub=env.ROOMS.get(id);
    const r=await stub.fetch("https://room/init",{method:"POST",body:JSON.stringify({code,name:clean(x.name,60)||"Listen Together",roomName:clean(x.roomName,80)||"My Room",mode:["public","private","invite"].includes(x.mode)?x.mode:"private",password:clean(x.password,64),max:[5,10,25,50].includes(x.max)?x.max:10,auth})});
    const d=await r.json(); return new Response(JSON.stringify(d),{status:r.status,headers:h});
  }
  if(u.pathname.startsWith("/api/room/")){const code=u.pathname.split("/").pop().toUpperCase();if(!ROOM_CODE.test(code))return json({error:"Invalid room"},400);return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req)}
  if(u.pathname.startsWith("/room/")&&req.headers.get("Upgrade")==="websocket"){const code=u.pathname.split("/")[2]?.toUpperCase();if(!ROOM_CODE.test(code))return json({error:"Invalid room"},400);return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req)}
  if(u.pathname==="/health")return new Response("ok",{headers:h});
  let r=await env.ASSETS.fetch(req); if(r.status===404) r=await env.ASSETS.fetch(new Request(new URL("/",req.url),req)); return r;
}};
export class Room{
 constructor(state){this.state=state;this.clients=new Map()}
 async fetch(req){const u=new URL(req.url);
  if(req.method==="POST"&&u.pathname==="/init"){const x=await req.json();await this.state.storage.put("room",{code:x.code,name:x.name,roomName:x.roomName,mode:x.mode,password:x.password,max:x.max,auth:x.auth,invite:token(),locked:false,ended:false,host:null,videoId:"",position:0,isPlaying:false,serverTimestamp:Date.now(),queue:[],members:[]});return json({code:x.code,token:x.auth,invite:(new URL("/join/"+x.code,req.url)).toString()+"?token="+(await this.state.storage.get("room")).invite})}
  if(req.headers.get("Upgrade")==="websocket"){const p=u.searchParams, auth=p.get("token"), room=await this.state.storage.get("room");if(!room||room.ended)return json({error:"Room unavailable"},410);
    if(room.mode!=="public"&&auth!==room.auth&&auth!==room.invite)return json({error:"Authorization required"},401);
    const pair=new WebSocketPair();const [client,server]=Object.values(pair);server.accept();const sid=token();this.clients.set(sid,server);
    let member={id:sid,name:clean(p.get("name")||"Listener",32),host:!room.host,muted:false};if(!room.host)room.host=sid;room.members=[...room.members.filter(m=>m.id!==sid),member];await this.state.storage.put("room",room);
    server.send(JSON.stringify({type:"welcome",requestId:"",timestamp:Date.now(),sessionId:sid,room:{...room,auth:undefined,password:undefined}}));this.broadcast({type:"member_joined",member, timestamp:Date.now()},sid);
    server.addEventListener("message",async e=>{if(typeof e.data!=="string"||e.data.length>12000)return;let m;try{m=JSON.parse(e.data)}catch{return}await this.message(sid,m)});
    server.addEventListener("close",async()=>{this.clients.delete(sid);let r=await this.state.storage.get("room");r.members=r.members.filter(m=>m.id!==sid);if(r.host===sid)r.host=r.members[0]?.id||null;await this.state.storage.put("room",r);this.broadcast({type:"member_left",sessionId:sid,timestamp:Date.now()})});
    return new Response(null,{status:101,webSocket:client});
  } return new Response("not found",{status:404})
 }
 async message(sid,m){const r=await this.state.storage.get("room");if(!r||r.ended)return;const me=r.members.find(x=>x.id===sid);if(!me)return;
  const id=typeof m.requestId==="string"?m.requestId.slice(0,64):""; const t=typeof m.type==="string"?m.type:"";
  const host=me.host;
  const send=(o)=>this.broadcast({...o,requestId:id,timestamp:Date.now()});
  if(t==="chat"){if(me.muted)return;const text=clean(m.text,500);if(!text)return;send({type:"chat",message:{id:token().slice(0,12),name:me.name,text,time:Date.now()}});return}
  if(t==="play"||t==="pause"||t==="seek"||t==="load"){if(!host)return this.err(sid,"Only the host can perform this action");if(t==="load"){const v=clean(m.videoId,20);if(!/^[A-Za-z0-9_-]{11}$/.test(v))return this.err(sid,"Invalid YouTube video ID");r.videoId=v;r.position=0;r.isPlaying=false}if(t==="play")r.isPlaying=true;if(t==="pause")r.isPlaying=false;if(t==="seek")r.position=Math.max(0,Math.min(Number(m.position)||0,86400));r.serverTimestamp=Date.now();await this.state.storage.put("room",r);send({type:"playback",videoId:r.videoId,position:r.position,isPlaying:r.isPlaying,serverTimestamp:r.serverTimestamp,sequence:(r.sequence||0)+1});r.sequence=(r.sequence||0)+1;await this.state.storage.put("room",r);return}
  if(t==="queue_add"){const v=clean(m.videoId,20);if(!/^[A-Za-z0-9_-]{11}$/.test(v)||r.queue.length>=100)return this.err(sid,"Invalid queue item");r.queue.push({id:token().slice(0,12),videoId:v,title:clean(m.title,120)||"YouTube video"});await this.state.storage.put("room",r);send({type:"room_state",room:{...r,password:undefined,auth:undefined}});return}
  if(t==="queue_remove"||t==="queue_clear"||t==="queue_move"){if(!host)return this.err(sid,"Only the host can perform this action");if(t==="queue_clear")r.queue=[];else if(t==="queue_remove")r.queue=r.queue.filter(x=>x.id!==m.id);else {const i=Number(m.index);const j=i+(Number(m.direction)||0);if(i>=0&&j>=0&&i<r.queue.length&&j<r.queue.length)[r.queue[i],r.queue[j]]=[r.queue[j],r.queue[i]]}await this.state.storage.put("room",r);send({type:"room_state",room:{...r,password:undefined,auth:undefined}});return}
  if(t==="lock"){if(!host)return this.err(sid,"Only the host can perform this action");r.locked=!!m.value;await this.state.storage.put("room",r);send({type:r.locked?"room_locked":"room_unlocked"});return}
  if(t==="remove"){if(!host)return this.err(sid,"Only the host can perform this action");const target=this.clients.get(m.sessionId);if(target){target.send(JSON.stringify({type:"error",message:"You were removed"}));target.close()};return}
  if(t==="transfer"){if(!host||!r.members.some(x=>x.id===m.sessionId))return this.err(sid,"Unable to transfer host");r.host=m.sessionId;r.members=r.members.map(x=>({...x,host:x.id===r.host}));await this.state.storage.put("room",r);send({type:"host_changed",host:r.host});return}
  if(t==="end"){if(!host)return this.err(sid,"Only the host can end the room");r.ended=true;await this.state.storage.put("room",r);this.broadcast({type:"room_ended"});for(const c of this.clients.values())c.close();return}
  if(t==="sync"){send({type:"room_state",room:{...r,password:undefined,auth:undefined}})}
 }
 err(sid,message){this.clients.get(sid)?.send(JSON.stringify({type:"error",message}))}
 broadcast(o,skip){const s=JSON.stringify(o);for(const [id,c] of this.clients)if(id!==skip)try{c.send(s)}catch{}}
}