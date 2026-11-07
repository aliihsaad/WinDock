/**
 * GPU-drawn dot field behind the touchpad. Pointer handlers only store numbers and
 * the frame loop stops once the surface settles, so cursor packets sharing the main
 * thread never wait for it. touch() returns false whenever the DOM feedback should
 * be used instead: Performance mode, reduced motion, or no usable WebGL.
 */
const VERTEX = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
const FRAGMENT = `precision highp float;
uniform vec2 R,F,ZC,D;
uniform float Z,ZV,ZI,S,E,L,T,DP,PK;
uniform vec3 H;
uniform vec3 C[2];
uniform vec3 W[6];
const float G=28.,DS=1.1,BR=.7,PU=.34,RC=70.,SW=1.4,GL=.6,WV=.55,WS=420.,SL=6.;
float g(float d,float s){return exp(-d*d/(2.*s*s));}
float dots(vec2 q,float r,vec2 s){
  float m=G*.5-1.;r=min(r,m);
  float l=length(s),room=max(m-r,0.);
  if(l>room)s*=room/max(l,.001);
  vec2 d=q-(floor(q/G)+.5)*G;
  float h=clamp(dot(d,s)/max(dot(s,s),.0001),-1.,1.);
  return 1.-smoothstep(r-.7,r+.6,length(d-s*h));
}
void main(){
  vec2 p=vec2(gl_FragCoord.x,R.y-gl_FragCoord.y)/S,dq=vec2(0.);
  float e=0.,w=0.,ring=0.;
  for(int i=0;i<2;i++){
    vec2 d=p-C[i].xy;
    float r=length(d)+.001,s=C[i].z;
    e+=s*g(r,RC*1.6);dq-=d*s*PU*PK*g(r,RC);
    if(L>.01){
      dq+=vec2(-d.y,d.x)*L*s*.5*g(r,80.);
      ring+=s*L*g(r-38.,7.)*(.55+.45*sin(atan(d.y,d.x)*6.-T*6.));
    }
  }
  for(int i=0;i<6;i++){
    float a=W[i].z;
    if(a>=0.){
      vec2 d=p-W[i].xy;
      float r=length(d)+.001,front=a*WS;
      float b=g(r-front,32.)*exp(-a*3.2),echo=g(r-front+64.,22.)*exp(-a*4.5)*.5;
      w+=(b+echo)*WV;dq+=d/r*(b+echo)*WV*15.*sin((r-front)*.11);
    }
  }
  e=clamp(e,0.,1.5);ring=min(ring,1.);
  vec2 s=D+(p-ZC)/(length(p-ZC)+20.)*ZV*9.5;
  float sl=length(s);
  if(sl>SL)s*=SL/sl;
  float radius=(DS+min(e,1.)*SW+w*4.2+ring*3.)*ZI;
  float k=clamp(e+w+ring,0.,1.);
  float vignette=1.-.38*smoothstep(.35,.95,length(p*S/R-.5)*1.25);
  vec3 c=vec3(.031,.043,.063);
  c+=dots(ZC+(p-ZC)/Z+dq/Z+F,radius,s*ZI)*mix(vec3(.2,.27,.37)*vignette,mix(H,vec3(.82,.95,1.),.55-L*.42),k)*(BR+E*.5+e*.55+w*1.1+ring*1.2);
  if(DP>.5){
    vec2 q=ZC+(p-ZC)/(1.+(Z-1.)*.5)+dq*.4/Z+F*.45+vec2(G*.5);
    c+=dots(q,(.9+e*1.2+w*1.4)*ZI,s*.5*ZI)*mix(vec3(.11,.16,.24)*vignette,H,k*.5)*(BR*.9+e*.7+w*.9);
  }
  c+=H*(e*.1+w*.08+ring*.12)*GL;
  gl_FragColor=vec4(c,1.);
}`;
const UNIFORMS = ["R", "F", "ZC", "D", "Z", "ZV", "ZI", "S", "E", "L", "T", "DP", "PK", "H", "C", "W"];
const AURORA = [.42, .9, .72], AMBER = [1, .62, .2];
const SCALES = [1.25, 1, .75];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createTouchpadField(canvas, surface) {
  const contacts = [0, 1].map(() => ({ id: null, x: 0, y: 0, targetX: 0, targetY: 0, strength: 0, velocity: 0 }));
  const contactData = new Float32Array(6), rippleData = new Float32Array(18), ripples = [];
  let gl = null, program = null, uniforms = {}, unusable = false, visible = false, frame = 0, last = 0;
  let quality = 0, scale = 1, depth = true, slowTime = 0, slowFrames = 0, lastLift = null, scrolled = 0;
  let offsetX = 0, offsetY = 0, velocityX = 0, velocityY = 0, flow = 0, pivotX = 0, pivotY = 0;
  let magnify = 1, magnifyTarget = 1, magnifyPrevious = 1, magnifyVelocity = 0, lens = 1, lock = 0, lockTarget = 0;

  const allowed = () => !document.documentElement.classList.contains("perf") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const live = () => visible && Boolean(program) && allowed();
  const touching = () => contacts.some((contact) => contact.id !== null);

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  }
  function setup() {
    gl ??= canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: true });
    if (!gl) { unusable = true; return; }
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT), linked = gl.createProgram();
    if (!vertex || !fragment) { unusable = !gl.isContextLost(); return; }
    gl.attachShader(linked, vertex); gl.attachShader(linked, fragment); gl.linkProgram(linked);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) { unusable = !gl.isContextLost(); return; }
    gl.useProgram(linked);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(linked, "a");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(linked, name)]));
    program = linked;
  }
  function resize() {
    scale = Math.min(window.devicePixelRatio || 1, SCALES[quality]);
    const width = Math.round(surface.clientWidth * scale), height = Math.round(surface.clientHeight * scale);
    if (!width || !height) return false;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); }
    if (magnifyTarget === 1 && magnify === 1) { pivotX = surface.clientWidth / 2; pivotY = surface.clientHeight / 2; }
    return true;
  }
  function draw(now) {
    contacts.forEach((contact, index) => contactData.set([contact.x, contact.y, contact.strength], index * 3));
    rippleData.fill(-1);
    ripples.forEach((ripple, index) => rippleData.set([ripple.x, ripple.y, ripple.age], index * 3));
    const speed = Math.hypot(velocityX, velocityY), streak = speed > 1 ? Math.min(speed / 110, 6) / speed : 0;
    gl.uniform2f(uniforms.R, canvas.width, canvas.height);
    gl.uniform2f(uniforms.F, offsetX, offsetY);
    gl.uniform2f(uniforms.ZC, pivotX, pivotY);
    gl.uniform2f(uniforms.D, velocityX * streak, velocityY * streak);
    gl.uniform1f(uniforms.Z, magnify);
    gl.uniform1f(uniforms.ZV, magnifyVelocity);
    gl.uniform1f(uniforms.ZI, magnify ** -.55);
    gl.uniform1f(uniforms.S, scale);
    gl.uniform1f(uniforms.E, flow);
    gl.uniform1f(uniforms.L, lock);
    gl.uniform1f(uniforms.T, now / 1000 % 100);
    gl.uniform1f(uniforms.DP, depth ? 1 : 0);
    gl.uniform1f(uniforms.PK, lens);
    gl.uniform3fv(uniforms.H, AURORA.map((value, index) => value + (AMBER[index] - value) * lock));
    gl.uniform3fv(uniforms.C, contactData);
    gl.uniform3fv(uniforms.W, rippleData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // A phone that cannot keep up gives back resolution first, then the depth layer.
  function watchPace(elapsed) {
    if (elapsed > 250) return;
    slowTime += elapsed; slowFrames++;
    if (slowFrames < 40) return;
    if (slowTime / slowFrames > 28) {
      if (quality < SCALES.length - 1) { quality++; resize(); } else depth = false;
    }
    slowTime = slowFrames = 0;
  }
  function settling() {
    return touching() || ripples.length > 0 || flow > .01 || Math.hypot(velocityX, velocityY) > 4
      || contacts.some((contact) => Math.abs(contact.strength) > .008 || Math.abs(contact.velocity) > .05)
      || Math.abs(magnify - 1) > .003 || Math.abs(magnifyVelocity) > .004 || Math.abs(lock - lockTarget) > .01 || Math.abs(lens - 1) > .01;
  }
  function tick(now) {
    frame = 0;
    if (!live()) return;
    const elapsed = Math.max(now - last, 0), seconds = Math.min(elapsed / 1000, .05); last = now;
    const ease = 1 - Math.exp(-seconds * 20), follow = 1 - Math.exp(-seconds * 34);
    for (const contact of contacts) {
      contact.x += (contact.targetX - contact.x) * follow; contact.y += (contact.targetY - contact.y) * follow;
      contact.velocity += (((contact.id !== null ? 1 : 0) - contact.strength) * 260 - contact.velocity * 26.8) * seconds;
      contact.strength += contact.velocity * seconds;
    }
    for (const ripple of ripples) ripple.age += seconds;
    while (ripples.length && ripples[0].age > 1.5) ripples.shift();
    // The field coasts after a flick, but fingers resting on the glass stop it quickly.
    const coasting = !touching();
    if (coasting) { offsetX += velocityX * seconds; offsetY += velocityY * seconds; }
    if (coasting || now - scrolled > 60) {
      const decay = Math.exp(-seconds * (coasting ? 3.2 : 12)); velocityX *= decay; velocityY *= decay;
    }
    flow += (Math.min(Math.hypot(velocityX, velocityY) / 900, 1) - flow) * ease;
    magnify += (magnifyTarget - magnify) * (1 - Math.exp(-seconds * (touching() ? 28 : 9)));
    magnifyVelocity += (clamp((magnify - magnifyPrevious) / Math.max(seconds, .001) * .4, -1, 1) - magnifyVelocity) * ease; magnifyPrevious = magnify;
    lens += ((magnifyTarget !== 1 ? .35 : 1) - lens) * ease;
    lock += (lockTarget - lock) * ease;
    draw(now); watchPace(elapsed);
    if (settling()) frame = requestAnimationFrame(tick);
  }
  function kick() { if (!frame && live()) { last = performance.now(); frame = requestAnimationFrame(tick); } }

  function update({ open, dragging }) {
    visible = open; lockTarget = dragging ? 1 : 0;
    if (open && !program && !unusable && allowed()) setup();
    canvas.hidden = !live();
    if (live() && resize()) kick();
  }
  function touch(id, x, y) {
    if (!live()) return false;
    const contact = contacts.find((candidate) => candidate.id === id) ?? contacts.find((candidate) => candidate.id === null);
    if (contact) {
      if (contact.id === null) {
        if (!touching()) velocityX = velocityY = 0;
        contact.id = id; contact.x = x; contact.y = y;
      }
      contact.targetX = x; contact.targetY = y;
      kick();
    }
    return true;
  }
  function lift(id) {
    const contact = contacts.find((candidate) => candidate.id === id);
    if (!contact) return;
    contact.id = null; lastLift = { x: contact.targetX, y: contact.targetY };
    if (!touching()) magnifyTarget = 1;
    kick();
  }
  function clear() {
    for (const contact of contacts) contact.id = null;
    magnifyTarget = 1; lastLift = null;
    kick();
  }
  function ripple(x, y) {
    if (!live()) return;
    ripples.push({ x, y, age: 0 });
    if (ripples.length > 6) ripples.shift();
    kick();
  }
  function tap() { if (lastLift) ripple(lastLift.x, lastLift.y); }
  function scroll(dx, dy) {
    if (!live()) return;
    const now = performance.now(), seconds = Math.max(now - scrolled, 1) / 1000; scrolled = now;
    offsetX -= dx; offsetY -= dy;
    velocityX += (-dx / seconds - velocityX) * .35; velocityY += (-dy / seconds - velocityY) * .35;
    kick();
  }
  function zoom(steps) {
    if (!live()) return;
    const [a, b] = contacts;
    if (magnifyTarget === 1 && a.id !== null && b.id !== null) { pivotX = (a.targetX + b.targetX) / 2; pivotY = (a.targetY + b.targetY) / 2; }
    magnifyTarget = clamp(magnifyTarget * 1.1 ** steps, .55, 2.6);
    kick();
  }

  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); program = null; canvas.hidden = true; });
  canvas.addEventListener("webglcontextrestored", () => { update({ open: visible, dragging: lockTarget === 1 }); });
  new ResizeObserver(() => { if (live() && resize()) kick(); }).observe(surface);
  return { update, touch, lift, clear, tap, ripple, scroll, zoom };
}
