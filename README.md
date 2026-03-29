# 🐋 whyWhale — User Guide

> Your AI terminal assistant. Chat, write code, manage files, and run shell commands — all from one prompt.

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🐋 whyWhale</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#030a12;overflow:hidden;font-family:'Courier New',monospace;height:100vh;width:100vw}

canvas#bg{position:fixed;inset:0;z-index:0}

.scene{position:fixed;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center}

/* Rays */
.rays{position:fixed;inset:0;z-index:1;pointer-events:none}
.ray{position:absolute;left:50%;top:0;width:2px;background:linear-gradient(to bottom,rgba(30,180,255,0.18),transparent);transform-origin:top center;animation:rayPulse 4s ease-in-out infinite}
.ray:nth-child(1){transform:rotate(-60deg);height:120vh;animation-delay:0s}
.ray:nth-child(2){transform:rotate(-35deg);height:100vh;animation-delay:0.4s}
.ray:nth-child(3){transform:rotate(-15deg);height:130vh;animation-delay:0.8s}
.ray:nth-child(4){transform:rotate(5deg);height:110vh;animation-delay:1.2s}
.ray:nth-child(5){transform:rotate(25deg);height:100vh;animation-delay:1.6s}
.ray:nth-child(6){transform:rotate(50deg);height:120vh;animation-delay:2s}
@keyframes rayPulse{0%,100%{opacity:0.3}50%{opacity:1}}

/* Bubbles */
.bubbles{position:fixed;inset:0;z-index:2;pointer-events:none}
.bubble{position:absolute;bottom:-20px;border-radius:50%;border:1px solid rgba(30,180,255,0.4);animation:riseUp linear infinite}
@keyframes riseUp{0%{transform:translateX(0) translateY(0) scale(1);opacity:0.6}100%{transform:translateX(var(--dx,20px)) translateY(-110vh) scale(1.2);opacity:0}}

/* ASCII logo */
.logo-wrap{position:relative;animation:floatY 5s ease-in-out infinite}
@keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-18px)}}

pre.whale{
  color:#1eb4ff;
  font-size:clamp(4px,1.05vw,11px);
  line-height:1.18;
  text-shadow:0 0 8px rgba(30,180,255,0.7),0 0 20px rgba(30,180,255,0.3);
  animation:whaleGlow 3s ease-in-out infinite;
  filter:drop-shadow(0 0 12px rgba(30,180,255,0.5));
  user-select:none;
}
@keyframes whaleGlow{
  0%,100%{color:#1eb4ff;text-shadow:0 0 8px rgba(30,180,255,0.7),0 0 20px rgba(30,180,255,0.3)}
  33%{color:#3cdcc8;text-shadow:0 0 12px rgba(60,220,200,0.9),0 0 30px rgba(60,220,200,0.4)}
  66%{color:#b96eff;text-shadow:0 0 10px rgba(185,110,255,0.8),0 0 25px rgba(185,110,255,0.3)}
}

/* Title */
.title{
  font-size:clamp(24px,5vw,64px);
  font-weight:700;
  letter-spacing:0.15em;
  color:#fff;
  margin-top:18px;
  overflow:hidden;
  white-space:nowrap;
  animation:typeIn 1.8s steps(9,end) 0.3s both, titleGlow 4s ease-in-out 2.5s infinite;
}
@keyframes typeIn{from{width:0}to{width:100%}}
@keyframes titleGlow{
  0%,100%{text-shadow:0 0 20px rgba(30,180,255,0.5)}
  50%{text-shadow:0 0 40px rgba(185,110,255,0.8),0 0 80px rgba(60,220,200,0.3)}
}

.title span{
  background:linear-gradient(90deg,#1eb4ff,#3cdcc8,#b96eff,#1eb4ff);
  background-size:300% 100%;
  -webkit-background-clip:text;
  -webkit-text-fill-color:transparent;
  background-clip:text;
  animation:gradShift 4s linear infinite;
}
@keyframes gradShift{0%{background-position:0%}100%{background-position:300%}}

/* Tagline */
.tagline{
  font-size:clamp(10px,1.5vw,16px);
  color:rgba(30,180,255,0.8);
  letter-spacing:0.25em;
  text-transform:uppercase;
  margin-top:10px;
  animation:fadeSlideUp 1s ease 2s both;
}
@keyframes fadeSlideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}

/* Pills */
.pills{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px;animation:fadeSlideUp 1s ease 2.6s both}
.pill{
  padding:4px 14px;
  border-radius:20px;
  font-size:11px;
  letter-spacing:0.12em;
  text-transform:uppercase;
  border:1px solid;
  animation:pillPop 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
}
.pill:nth-child(1){color:#1eb4ff;border-color:rgba(30,180,255,0.5);background:rgba(30,180,255,0.08);animation-delay:2.8s}
.pill:nth-child(2){color:#3cdcc8;border-color:rgba(60,220,200,0.5);background:rgba(60,220,200,0.08);animation-delay:3.0s}
.pill:nth-child(3){color:#b96eff;border-color:rgba(185,110,255,0.5);background:rgba(185,110,255,0.08);animation-delay:3.2s}
.pill:nth-child(4){color:#ffc83c;border-color:rgba(255,200,60,0.5);background:rgba(255,200,60,0.08);animation-delay:3.4s}
.pill:nth-child(5){color:#ff6b2b;border-color:rgba(255,107,43,0.5);background:rgba(255,107,43,0.08);animation-delay:3.6s}
@keyframes pillPop{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}

/* Version badge */
.version{
  position:fixed;top:18px;right:22px;
  font-size:12px;color:rgba(30,180,255,0.7);
  letter-spacing:0.1em;
  animation:fadeSlideUp 1s ease 3.8s both;
  border:1px solid rgba(30,180,255,0.3);
  padding:4px 10px;border-radius:8px;
  background:rgba(30,180,255,0.06);
}

/* Dev badge */
.dev{
  position:fixed;bottom:18px;left:50%;transform:translateX(-50%);
  font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:0.2em;
  text-transform:uppercase;animation:fadeSlideUp 1s ease 4.2s both;
}

/* Ocean floor */
.ocean-floor{
  position:fixed;bottom:0;left:0;right:0;height:80px;
  background:linear-gradient(to top,rgba(0,30,60,0.9),transparent);
  z-index:2;
}
.seaweed{position:fixed;bottom:0;z-index:3}
.seaweed svg{animation:sway 3s ease-in-out infinite}
@keyframes sway{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}

/* Scan line */
.scanline{
  position:fixed;inset:0;z-index:10;pointer-events:none;
  background:repeating-linear-gradient(to bottom,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);
}

/* Cursor blink on title */
.cursor{
  display:inline-block;width:3px;height:1em;
  background:#1eb4ff;vertical-align:middle;margin-left:3px;
  animation:blink 1s step-end infinite 2s;
}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}

/* Ring pulse */
.ring{
  position:absolute;border-radius:50%;border:1px solid rgba(30,180,255,0.25);
  animation:ringExpand 3.5s ease-out infinite;
  pointer-events:none;
}
.ring:nth-child(1){animation-delay:0s}
.ring:nth-child(2){animation-delay:1.16s}
.ring:nth-child(3){animation-delay:2.33s}
@keyframes ringExpand{
  0%{width:40px;height:40px;opacity:0.8;transform:translate(-50%,-50%) scale(1)}
  100%{width:500px;height:500px;opacity:0;transform:translate(-50%,-50%) scale(1)}
}
.rings-container{position:absolute;left:50%;top:50%;z-index:0;pointer-events:none}
</style>
</head>
<body>

<canvas id="bg"></canvas>

<div class="rays">
  <div class="ray"></div><div class="ray"></div><div class="ray"></div>
  <div class="ray"></div><div class="ray"></div><div class="ray"></div>
</div>

<div class="bubbles" id="bubbles"></div>

<div class="rings-container">
  <div class="ring"></div><div class="ring"></div><div class="ring"></div>
</div>

<div class="scene">
  <div class="logo-wrap">
    <pre class="whale">⣿⣶⣄⡀
⠘⣿⣿⣿⣶⣄⡀
⠀⠘⣿⣿⣿⣿⣿⣦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣀⡀
⠀⠀⠹⣿⣿⣿⣿⣿⣿⣦⠀⠀⠀⠀⢀⣠⣤⣴⣾⣿⣿⣿⠁
⠀⠀⠀⠙⣿⣿⣿⣿⣿⣿⣧⠀⣠⣾⣿⣿⣿⣿⣿⣿⡿⠁
⠀⠀⠀⠀⢹⣿⣿⣿⣿⣿⣿⣾⣿⣿⣿⣿⣿⣿⡿⠋⠀⣠⣤⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣤⣴⣶⣶⣦⣤⣤⣀
⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠛⠁⠀⠀⣿⣿⣿⣿⣿⣦⡀⠀⠀⢀⣤⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀
⠀⠀⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣷⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆
⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⢹⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠛⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧
⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠈⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆
⠀⠀⠀⠀⠀⠀⠀⠸⣿⣿⣿⣿⣿⣿⡄⠀⠀⠀⠀⠀⠀⠀⢹⣿⣿⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⢀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿⣿⣦⣀⠀⠀⠀⠀⢀⣿⣿⣿⣿⣿⣿⣿⣿⡿⠀⠀⠀⠀⢀⣾⣿⣿⣿⣿⣿⠟⠋⠉⠉⠙⢿⣿⣿
⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇⠀⠀⠀⣠⣾⣿⣿⣿⡿⠋⠁⠀⠀⠀⠀⠀⢸⣿⣿
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⡟⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣾⣿⣿⣿⣿⠋⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⡟
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⣷⠸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⢀⣿⣿⠃
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⡇⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⡟
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣿⣿⡄⠈⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⡿
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⡄⠀⠘⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣿⡿⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣷⡄⠀⠀⠀⠉⠉⠉⠉⢸⣿⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⡿
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢿⣿⣆⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⣿⠟
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢻⣿⣷⣄⠀⠀⠀⠀⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣼⣿⡿⠋
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣷⣤⡀⠀⢻⣿⣿⠟⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣼⣿⣿⠟⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣶⣤⣉⡁⠀⠀⠀⠀⠀⠀⠀⣀⣠⣴⣾⣿⣿⠟⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠻⠿⣿⣿⣿⣿⣶⣶⣶⣶⣾⣿⣿⣿⡿⠿⠋⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠙⠛⠻⠿⠿⠿⠛⠛⠉⠉</pre>
  </div>

  <div class="title"><span>whyWhale</span><span class="cursor"></span></div>
  <div class="tagline">AI Terminal · Self-Testing Brain · Memory · Skills</div>

  <div class="pills">
    <div class="pill">7-Phase AI</div>
    <div class="pill">Self-Testing</div>
    <div class="pill">Memory</div>
    <div class="pill">Multi-Provider</div>
    <div class="pill">Skills</div>
  </div>
</div>

<div class="ocean-floor"></div>

<!-- Seaweed left -->
<div class="seaweed" style="left:5%">
<svg width="18" height="70" viewBox="0 0 18 70">
  <path d="M9 70 Q3 55 9 42 Q15 30 9 18 Q3 8 9 0" fill="none" stroke="#0f6e56" stroke-width="3" stroke-linecap="round"/>
</svg></div>
<div class="seaweed" style="left:11%;animation-delay:0.5s">
<svg width="14" height="50" viewBox="0 0 14 50">
  <path d="M7 50 Q2 38 7 28 Q12 18 7 8 Q2 2 7 0" fill="none" stroke="#0f6e56" stroke-width="2.5" stroke-linecap="round"/>
</svg></div>
<div class="seaweed" style="right:8%;animation-delay:1s">
<svg width="18" height="65" viewBox="0 0 18 65">
  <path d="M9 65 Q3 50 9 38 Q15 26 9 14 Q3 5 9 0" fill="none" stroke="#085041" stroke-width="3" stroke-linecap="round"/>
</svg></div>
<div class="seaweed" style="right:15%;animation-delay:0.3s">
<svg width="14" height="45" viewBox="0 0 14 45">
  <path d="M7 45 Q2 34 7 24 Q12 14 7 5 Q2 1 7 0" fill="none" stroke="#0f6e56" stroke-width="2" stroke-linecap="round"/>
</svg></div>

<div class="scanline"></div>

<div class="version">v4.0.0</div>
<div class="dev">developed by CVKI &nbsp;·&nbsp; 7-Phase Neural Pipeline</div>

<script>
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
let W, H, stars = [], fish = [];

function resize(){
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// Stars/particles
for(let i=0;i<180;i++){
  stars.push({
    x: Math.random()*2000,
    y: Math.random()*1200,
    r: Math.random()*1.5+0.3,
    alpha: Math.random(),
    speed: Math.random()*0.003+0.001,
    phase: Math.random()*Math.PI*2
  });
}

// Small fish
for(let i=0;i<8;i++){
  fish.push({
    x: Math.random()*W,
    y: Math.random()*H*0.7+H*0.1,
    speed: (Math.random()*0.4+0.15)*(Math.random()<0.5?1:-1),
    size: Math.random()*6+4,
    alpha: Math.random()*0.4+0.2,
    wave: Math.random()*Math.PI*2,
    waveSpeed: Math.random()*0.04+0.02
  });
}

let t = 0;
function draw(){
  t += 0.01;
  ctx.clearRect(0,0,W,H);

  // Deep gradient
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#030a12');
  g.addColorStop(0.5,'#041525');
  g.addColorStop(1,'#001530');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // Caustics (wavy light patches)
  for(let i=0;i<5;i++){
    const cx = W*(0.1+i*0.2) + Math.sin(t*0.3+i)*40;
    const cy = H*0.3 + Math.cos(t*0.2+i*1.3)*30;
    const r = 80+Math.sin(t+i)*20;
    const cg = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    cg.addColorStop(0,'rgba(30,180,255,0.04)');
    cg.addColorStop(1,'transparent');
    ctx.fillStyle=cg;
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fill();
  }

  // Stars / particles
  stars.forEach(s=>{
    s.phase+=s.speed;
    const a = (Math.sin(s.phase)+1)/2 * 0.7 + 0.1;
    ctx.beginPath();
    ctx.arc(s.x%W, s.y%H, s.r, 0, Math.PI*2);
    ctx.fillStyle=`rgba(100,200,255,${a})`;
    ctx.fill();
  });

  // Fish silhouettes
  fish.forEach(f=>{
    f.x += f.speed;
    f.wave += f.waveSpeed;
    f.y += Math.sin(f.wave)*0.4;
    if(f.x > W+20) f.x=-20;
    if(f.x < -20) f.x=W+20;

    ctx.save();
    ctx.translate(f.x, f.y);
    if(f.speed < 0) ctx.scale(-1,1);
    ctx.globalAlpha = f.alpha;
    // body
    ctx.beginPath();
    ctx.ellipse(0,0,f.size*1.8,f.size*0.7,0,0,Math.PI*2);
    ctx.fillStyle='rgba(30,130,200,0.5)';
    ctx.fill();
    // tail
    ctx.beginPath();
    ctx.moveTo(-f.size*1.6,0);
    ctx.lineTo(-f.size*2.5,-f.size*0.8);
    ctx.lineTo(-f.size*2.5,f.size*0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  // Flowing particles going up
  if(t%0.3 < 0.01){
    const bEl = document.createElement('div');
    bEl.className='bubble';
    const size = Math.random()*8+3;
    bEl.style.cssText=`width:${size}px;height:${size}px;left:${Math.random()*100}%;--dx:${(Math.random()-0.5)*60}px;animation-duration:${Math.random()*6+5}s;animation-delay:${Math.random()*2}s;opacity:0`;
    document.getElementById('bubbles').appendChild(bEl);
    setTimeout(()=>bEl.remove(), 9000);
  }

  requestAnimationFrame(draw);
}
draw();
</script>
</body>
</html>

---

## Installation

```bash
# Clone or extract the whyWhale folder, then:
git clone https://github.com/CVAKI/whyWhale.git
cd whyWhale
npm install -g .

# Launch with:
whywhale
# or the short alias:
ww
```

On first launch, whyWhale will ask you to pick a provider, enter your API key, and choose a model. This is saved automatically — you won't be asked again.

---

## First-Time Setup

```
1. Select a provider:
   [1] Anthropic (Claude)
   [2] OpenRouter
   [3] Groq
   [4] Ollama (local, no key needed)

2. Enter your API key (skip for Ollama)

3. Pick a model from the live list
```

To redo setup at any time: `whywhale --setup`

---

## Basic Usage

Just type anything and press Enter — whyWhale sends it to the AI and streams the response back.

```
┌[11:08:55]────[whyWhale]────[</> code]────[#1]
└[my-project]──► explain how async/await works in JS
```

---

## Switching AI Modes

Different modes change how the AI thinks and responds.

| Command | Mode | Best For |
|---|---|---|
| `/mode code` | 💻 Code | Writing and generating code |
| `/mode debug` | ⚡ Debug | Finding and fixing bugs |
| `/mode review` | ⊕ Review | Code quality review with ratings |
| `/mode explain` | ❋ Explain | Teaching concepts simply |
| `/mode architect` | ⬡ Architect | System design and planning |
| `/mode plan` | 📋 Plan | Project planning |
| `/mode agent` | ◈ Agent | Autonomous — AI creates files without asking |
| `/mode chat` | ◉ Chat | General conversation |

```bash
/mode debug
```

---

## Running Shell Commands

Prefix any terminal command with `!` to run it directly:

```bash
!ls -la
!git status
!npm install
!node server.js
!python app.py
```

Output is shown inline in a styled box with the exit code.

---

## File Commands

| Command | What it does |
|---|---|
| `/ls` | List files in current directory |
| `/ls path/to/dir` | List files in a specific folder |
| `/tree` | Show directory tree (3 levels deep) |
| `/tree 5` | Tree with custom depth |
| `/read filename.js` | Read and display a file with syntax highlighting |
| `/analyse filename.js` | Deep AI analysis of a file (quality score, issues, suggestions) |
| `/write filename.js` | AI generates content for a file (prompts you for description) |
| `/create filename.js` | Create a new empty file |
| `/delete filename.js` | Delete a file (asks for confirmation) |
| `/rename old.js new.js` | Rename or move a file |

---

## Scanning Your Project

whyWhale can read your project files and load them into the AI's context window, so the AI understands your codebase before you even ask a question.

```bash
/scan          # scan current directory
/autoscan      # toggle auto-scan on every startup
```

After scanning, the AI will reference your actual files when answering questions.

---

## Memory

whyWhale remembers facts between sessions. You can store things manually, or the AI saves them automatically.

```bash
/memory                        # view all saved facts
/memory set project myapp      # save a fact manually
/memory clear                  # wipe everything
```

The AI also saves facts on its own using `@@MEMORY: key: value` in its responses — things like your project name, stack, preferences, etc.

---

## Skills

Skills are prompt packs that make the AI smarter in specific areas.

```bash
/skill list                    # see all available skills
/skill install react           # install the React skill
/skill install python          # install the Python skill
/skill remove react            # uninstall a skill
/skill show react              # preview what a skill does
```

**Available skills:** `react` · `python` · `security` · `testing` · `api-design` · `docker` · `database` · `git` · `performance` · `typescript`

---

## Auto Self-Testing

When enabled, whyWhale runs any code the AI generates, reads errors, and automatically fixes them (up to 3 rounds).

```bash
/autotest      # toggle on or off
```

Supports `.js`, `.py`, `.sh`, `.ts` files.

---

## Session Management

```bash
/save                          # save current conversation
/save my-session-name         # save with a custom name
/load                          # pick a saved session to restore
/export                        # export full chat as a styled HTML file
/history                       # show messages from this session
/clear                         # wipe the current conversation (keeps memory)
```

---

## Dashboard

Opens a live web dashboard at `http://localhost:7070` showing session stats, memory, mode, and message history.

```bash
/dashboard
/dashboard 8080    # custom port
```

---

## Other Commands

```bash
/stats         # session stats (tokens, uptime, model, message count)
/tokens        # quick token usage
/system        # view current system prompt
/copy          # copy last AI response to clipboard
/config        # show current config (provider, model, settings)
/setup         # reconfigure provider, model, or API key
/reset         # wipe config and start fresh
/help          # full command reference
/exit          # quit (saves session summary to memory)
```

---

## Multi-line Input

End any line with `\\` to continue typing on the next line:

```
Write me a function that does X \\
and also handles Y \\
and returns Z
```

---

## Providers & API Keys

| Provider | Where to get a key |
|---|---|
| Anthropic | https://console.anthropic.com |
| OpenRouter | https://openrouter.ai (free models available) |
| Groq | https://console.groq.com (free, very fast) |
| Ollama | https://ollama.com (runs locally, no key needed) |

Switch provider at any time with `/provider`.

---

## Data & Config Files

| File | What's stored |
|---|---|
| `~/.whywhale.json` | Your provider, model, API key, settings |
| `~/.whywhale_memory.json` | All persistent memory facts |
| `~/.whywhale_sessions/` | Saved conversation sessions |
| `~/.whywhale_skills/` | Installed skill files |

---

*whyWhale v4.0.0 · developed by CVKI*