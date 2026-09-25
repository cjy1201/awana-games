// AWANA 게임 공통 부분: 게임 트랙(12m × 12m) 그리기, 네 팀 버튼, 소리, 조/회전 경기 진행.
// 각 게임은 Court.create({...}) 에 자기 규칙(상태, 누르기, 진행, 그리기)만 넘기고, 마지막에 g.run() 을 불러요.
// 빌드 없이 <script src="../shared/court.js"> 로 불러와요. 고치면 sw.js 의 VERSION 도 올려 주세요.
// 태블릿에서 아이들이 여기저기 누르다 화면이 확대되지 않게 막아요.
// (iPad Safari 는 viewport 의 user-scalable=no 를 무시해서 이렇게 따로 막아야 해요)
function blockZoom() {
  const stop = e => e.preventDefault();
  // 두 손가락 확대 (Safari 전용 제스처 이벤트)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, stop, { passive: false }));
  // 손가락 두 개 이상으로 움직일 때 (여러 팀이 동시에 누를 때도 확대로 오해하지 않게)
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // 두 번 빠르게 톡톡 쳐서 확대 (설명 창처럼 넘겨보는 곳은 그대로 둬요)
  let lastTouch = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouch < 350 && !e.target.closest('.overlay')) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
}
blockZoom();

// 전체 화면: 브라우저 탭·주소창을 가려서 아이들이 누르다 다른 페이지로 가지 않게.
// 홈 화면에 설치한 앱은 이미 전체 화면이라 건드리지 않아요.
// 브라우저는 버튼을 누른 순간에만 전체 화면을 허락해서, 시작하기·다음 버튼을 누를 때 함께 요청해요.
// Safari(iPad·iPhone 의 모든 브라우저 포함)는 전체 화면에서 연타하면
// "전체 화면인 상태에서 입력하는 것 같습니다" 경고를 계속 띄워서 쓰지 않고, 홈 화면에 추가하도록 안내해요.
function isSafariEngine(ua = navigator.userAgent, platform = navigator.platform, touch = navigator.maxTouchPoints || 0) {
  const appleMobile = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);   // iPad 는 Mac 처럼 보여요
  const desktopSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(ua);
  return appleMobile || desktopSafari;
}
const Fullscreen = (() => {
  const root = document.documentElement;
  const installed = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  const supported = () => !isSafariEngine() && !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const active = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const quiet = p => { if (p && p.catch) p.catch(() => {}); };
  function enter() {
    if (installed() || active() || !supported()) return;
    try { quiet(root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen()); } catch (e) {}
  }
  function exit() {
    if (!active()) return;
    try { quiet(document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); } catch (e) {}
  }
  const usable = () => supported() && !installed();
  // Safari 에서 브라우저로 열었을 때: 홈 화면에 추가하라고 알려줘요
  const suggestInstall = () => isSafariEngine() && !installed();
  return { enter, exit, active, usable, suggestInstall };
})();

window.Court = (() => {
  const TAU = Math.PI * 2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // AWANA 게임 트랙: 빨강 위, 파랑 오른쪽, 초록 아래, 노랑 왼쪽.
  // angle = 그 팀 대각선 방향. 대각선이 원과 만나는 곳에 그 팀 색깔 핀, 그 바깥이 출발선.
  const TEAMS = [
    { id: 'red',    name: '빨강', color: '#E8403A', dark: '#A8231E', text: '#fff',    key: 'q', angle: -3 * Math.PI / 4, rot: 180, note: 523 },
    { id: 'blue',   name: '파랑', color: '#2F6FE4', dark: '#1B47A3', text: '#fff',    key: 'p', angle: -Math.PI / 4,     rot: -90, note: 587 },
    { id: 'green',  name: '초록', color: '#1FA35A', dark: '#12713C', text: '#fff',    key: 'm', angle: Math.PI / 4,      rot: 0,   note: 659 },
    { id: 'yellow', name: '노랑', color: '#F5C21B', dark: '#B88A00', text: '#16224A', key: 'z', angle: 3 * Math.PI / 4,  rot: 90,  note: 698 },
  ];
  const POINTS = [400, 200];   // 조(회전)마다 1등, 2등 점수

  // 트랙 좌표 s: 출발선에서 시계 반대 방향으로 간 거리(라디안). 원 위 핀은 s = 0, π/2, π, 3π/2 에 있어요.
  const ZC = Math.PI / 4;      // 네모칸(배턴 존) 가운데 = 출발선 45° 전 (우리 팀 변의 가운데)
  const START_S = -0.1;        // 출발 자리: 출발선 바로 뒤 (선을 밟지 않게)
  const MIN_TAP_GAP = 55;      // 이보다 빠른 연타는 한 번으로 쳐요 (ms)
  // 종료 핀 슬라이딩: 최고 속도의 FINISH_SAFE 배 넘게 빠르면, 빠를수록 최대 FINISH_CHANCE 확률로 실격
  const FINISH_SAFE = 0.6;
  const FINISH_CHANCE = 0.3;

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const font = px => `${Math.round(px)}px Jua, sans-serif`;
  const easeOut = x => 1 - Math.pow(1 - x, 3);

  // opts: 게임마다 다른 것
  //   settings    { teams: Set, heats, ... } — 설정 칩(data-*)이 바꿔요
  //   chips       ['heats', ...] — data-<이름> 칩 묶음 (settings[이름] 에 숫자로)
  //   heatName    '조' 또는 '회전'
  //   goText, idleText, nextReady — 출발할 때 / 달리는 중 가운데 / 결과의 다음 버튼 글자
  //   heatTitle(heat)  조 결과 제목 뒤에 붙는 글자 (예: " (No1~No5)")
  //   resultSub(t, h)  조 결과 한 줄 설명 (기본: 걸린 시간)
  //   padShift(S, btn) 팀 버튼을 변 가운데에서 다음 팀 모서리 쪽으로 옮기는 거리
  //   center      가운데 글자 자리 (R 배수): { top, sub, rank, width, subWidth }
  //   teamState(t)     팀 상태 중 게임 고유 값
  //   onReset()        상태를 새로 만들 때 더 할 일
  //   padText(st)      달리는 중 버튼 글자,  padDots(st) 버튼의 작은 동그라미들
  //   tap(t, st, el)   달리는 중 눌렀을 때,  press(id, down) 꾹 누르기 (있을 때만)
  //   race(dt)         달리는 중 매 프레임,  tick(dt) 매 프레임 (핀 넘어짐 등)
  //   draw(now)        트랙·핀·선수 그리기,  progress(st, t) 달리는 중 순위용 진행도
  //   points      등수별 점수 (기본 [400, 200])
  //   heatScore(t, st)  등수 대신 이 판에서 얻은 점수를 바로 줄 때 (컬링: 후프 안 100 · 닿으면 50)
  //   isOver()    경기가 끝났는지 (기본: 모든 팀이 끝나거나 실격). 한 팀만 이기면 끝나는 게임에서 써요
  //   countdown() 3-2-1 대신 기다리는 시간(초)을 돌려줘요 (콩주머니 옮기기: 번호를 부를 때까지 두근두근)
  //   drawWait(left)   countdown 을 쓸 때 가운데 그림,  waitPad  그동안 버튼 글자
  //   early(t, st, el) 출발 전에 눌렀을 때 (기본: '아직이에요' 흔들기)
  //   goText, idleText 는 함수여도 돼요 (그때그때 바뀌는 글자)
  function create(opts) {
    const settings = opts.settings;
    const points = opts.points || POINTS;
    const rankText = r => (r ? r + '등' : '—');   // 등수 없이 끝난 팀은 —
    const heatName = opts.heatName;
    const center = { top: 0.37, sub: 0.4, rank: 0.38, width: 1.6, subWidth: 1.4, ...opts.center };
    const txt = v => (typeof v === 'function' ? v() : v);

    const stage = document.getElementById('stage');
    const canvas = document.getElementById('court');
    const ctx = canvas.getContext('2d');
    const introEl = document.getElementById('intro');
    const resultEl = document.getElementById('result');
    const pads = {};
    document.querySelectorAll('.pad').forEach(el => { pads[el.dataset.team] = el; });

    const g = {
      settings, ctx, pads,
      S: 600, dpr: 1,
      phase: 'intro',          // intro | countdown | race | over | result
      countdownT: 0, raceT: 0, lastCount: null, overT: 0,
      rankCounter: 0,
      particles: [],
      banner: { text: '', color: '#16224A', t: 0 },
      state: {},
      match: { heat: 1, scores: {}, history: [] },
    };

    // ---------- 소리 ----------
    let audio = null, soundOn = true;
    function ac() {
      if (!soundOn) return null;
      try {
        if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
      } catch (e) { return null; }
      return audio;
    }
    function tone(freq, dur = 0.08, type = 'square', vol = 0.06, delay = 0) {
      const a = ac(); if (!a) return;
      const t0 = a.currentTime + delay;
      const o = a.createOscillator(), gain = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gain).connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    // 게임마다 더 필요한 소리는 g.sfx 에 붙여요
    const sfx = {
      tap: n => tone(n, 0.04, 'triangle', 0.05),
      count: () => tone(440, 0.18, 'square', 0.07),
      go: () => tone(880, 0.4, 'square', 0.08),
      pass: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.1, 'triangle', 0.08, i * 0.07)),
      last: () => [440, 554, 659].forEach((f, i) => tone(f, 0.12, 'square', 0.06, i * 0.09)),
      pin: () => { tone(120, 0.35, 'sawtooth', 0.09); [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.2, 'square', 0.07, 0.15 + i * 0.11)); },
      drop: () => [520, 380, 260].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, i * 0.08)),
      ok: () => [523, 784].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, i * 0.08)),
      foul: () => { tone(150, 0.4, 'sawtooth', 0.07); tone(110, 0.4, 'sawtooth', 0.06, 0.2); },
    };

    // ---------- 경기장 치수 ----------
    function geo() {
      const S = g.S;
      const m = S * 0.055;              // 바깥 팀 색 띠
      const C = S - 2 * m;              // 12m × 12m 트랙
      const c = S / 2;
      const R = C * 0.37;               // 원 (서클 라인)
      const band = C * 0.085;           // 달리는 길
      const laneR = R + band * 0.5;
      const box = C * 0.09;             // 가운데 사각형 반쪽
      return { m, C, c, R, band, laneR, box };
    }
    const at = (a, r) => { const { c } = geo(); return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r }; };

    // ③ 종료핀: 가운데 사각형 안, 우리 팀 대각선 위
    function pinOf(t) { return at(t.angle, geo().C * 0.075); }
    // 원 위 색깔 핀: 서클 라인과 팀 대각선이 만나는 곳
    function ringPinOf(t) { return at(t.angle, geo().R); }
    // ⑤ 네모칸: 서클 라인 안쪽, 우리 팀 변 가운데 방향
    // ⑤ 네모칸: 바깥 변이 서클 라인에 붙어 있어요 (서클 라인 두께 절반만큼 안쪽)
    const BOX_H = () => geo().C * 0.026;
    const boxR = () => { const { R, C } = geo(); return R - BOX_H() - Math.max(2, C * 0.005); };
    function cornerOf(t) {
      const { C } = geo();
      return at(t.angle, C / Math.SQRT2);
    }

    // 마지막 주자 길: 우리 팀 핀을 오른쪽 바깥으로 돌아 → 원 안으로 → 대각선 따라 종료 핀까지
    let pathCache = { key: '', paths: {} };
    function finalPath(t) {
      const key = g.S + '';
      if (pathCache.key !== key) pathCache = { key, paths: {} };
      if (pathCache.paths[t.id]) return pathCache.paths[t.id];
      const { R, laneR, C } = geo();
      const A = t.angle;
      const P0 = at(A, laneR);
      const tan = A - Math.PI / 2;
      const C1 = { x: P0.x + Math.cos(tan) * laneR * 0.34, y: P0.y + Math.sin(tan) * laneR * 0.34 };
      const C2 = at(A - 0.34, R * 0.7);
      const P3 = at(A, R * 0.6);
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, v = 1 - u;
        pts.push({
          x: v * v * v * P0.x + 3 * v * v * u * C1.x + 3 * v * u * u * C2.x + u * u * u * P3.x,
          y: v * v * v * P0.y + 3 * v * v * u * C1.y + 3 * v * u * u * C2.y + u * u * u * P3.y,
        });
      }
      pts.push(at(A, C * 0.075 + C * 0.035));
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      return (pathCache.paths[t.id] = { pts, len, L: len[len.length - 1] });
    }

    // 트랙 좌표 s 의 화면 위치: 한 바퀴(TAU)까지는 원을 따라, 그 뒤는 마지막 주자 길
    function posOf(t, s) {
      const { laneR } = geo();
      if (s <= TAU) {
        const a = t.angle - s;
        const p = at(a, laneR);
        return { x: p.x, y: p.y, dir: a - Math.PI / 2 };
      }
      const { pts, len, L } = finalPath(t);
      const d = Math.min((s - TAU) * laneR, L);
      let i = 1;
      while (i < len.length - 1 && len[i] < d) i++;
      const f = (d - len[i - 1]) / ((len[i] - len[i - 1]) || 1);
      const a = pts[i - 1], b = pts[i];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dir: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    // 원 위 핀이 어느 팀 것인지: 출발선에서 k × 90° 간 곳
    function ringTeamAt(t, k) {
      const i = TEAMS.indexOf(t);
      return TEAMS[((i - k) % 4 + 4) % 4];
    }

    // ---------- 화면 배치 ----------
    const padShift = opts.padShift || ((S, btn) => Math.min(S * 0.3, S / 2 - btn * 0.55));
    function layout() {
      const W = stage.clientWidth, H = stage.clientHeight;
      const minD = Math.min(W, H);
      const btn = Math.max(84, Math.min(160, minD * 0.17));
      const S = g.S = Math.floor(Math.max(240, Math.min(W - btn * 1.3, H - btn * 1.3)));
      g.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = S * g.dpr; canvas.height = S * g.dpr;
      canvas.style.width = S + 'px'; canvas.style.height = S + 'px';
      const left = (W - S) / 2, top = (H - S) / 2;
      canvas.style.left = left + 'px';
      canvas.style.top = top + 'px';
      TEAMS.forEach(t => {
        const el = pads[t.id];
        el.style.width = el.style.height = btn + 'px';
        el.style.setProperty('--s', btn + 'px');
        el.style.setProperty('--c', t.color);
        el.style.setProperty('--d', t.dark);
        el.style.setProperty('--t', t.text);
        el.style.transform = `rotate(${t.rot}deg)`;
        const side = t.angle + Math.PI / 4;
        const out = S / 2 + btn * 0.15;
        const along = side + Math.PI / 2;           // 변을 따라 (다음 팀 모서리 쪽)
        const shift = padShift(S, btn);
        // 화면 밖으로 나가지 않게
        const bx = left + S / 2 + Math.cos(side) * out + Math.cos(along) * shift - btn / 2;
        const by = top + S / 2 + Math.sin(side) * out + Math.sin(along) * shift - btn / 2;
        el.style.left = Math.max(4, Math.min(W - btn - 4, bx)) + 'px';
        el.style.top = Math.max(4, Math.min(H - btn - 4, by)) + 'px';
      });
    }
    addEventListener('resize', layout);

    // ---------- 게임 상태 ----------
    function resetState() {
      g.state = {};
      if (opts.onReset) opts.onReset();
      TEAMS.forEach(t => {
        g.state[t.id] = {
          active: settings.teams.has(t.id),
          lastTap: 0, rank: 0, finished: false, time: 0, pinFall: 0,
          dq: false, dqReason: '', label: '',
          ...opts.teamState(t),
        };
      });
      g.rankCounter = 0; g.overT = 0; g.particles = []; g.raceT = 0;
      g.banner = { text: '', color: '#16224A', t: 0 };
      TEAMS.forEach(t => { pads[t.id].hidden = !g.state[t.id].active; });
      updatePads();
    }

    // 게임 중에는 화면이 꺼지지 않게
    let wakeLock = null;
    // 방문 통계에 '게임 시작' 한 번을 셉니다 (오프라인이거나 통계 스크립트가 없으면 그냥 넘어가요)
    function countStart() {
      try {
        const game = location.pathname.split('/').filter(p => p && p !== 'index.html').pop() || 'game';
        if (window.goatcounter && goatcounter.count) goatcounter.count({ path: 'start-' + game, title: document.title + ' · 시작', event: true });
      } catch (e) {}
    }
    async function keepAwake() {
      try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && g.phase !== 'intro') keepAwake();
    });

    function startMatch() {
      keepAwake();
      countStart();
      const match = g.match;
      match.heat = 1; match.scores = {}; match.history = [];
      TEAMS.forEach(t => { match.scores[t.id] = 0; });
      startHeat();
    }
    function startHeat() {
      resetState();
      introEl.hidden = true; resultEl.hidden = true;
      g.phase = 'countdown'; g.countdownT = opts.countdown ? opts.countdown() : 3.999; g.lastCount = null;
      updatePads();
      ac();
    }

    // 버튼 글자: 실격 · 등수 · 준비는 공통, 달리는 중 글자는 게임마다
    function padText(st) {
      if (st.dq) return '실격';
      if (st.rank) return st.rank + '등';
      if (g.phase === 'countdown' && opts.waitPad) return opts.waitPad;
      if (g.phase !== 'race') return g.match.heat + heatName + ' 준비';
      return opts.padText(st);
    }
    // 버튼의 작은 동그라미: 기본은 주자 한 명에 하나
    const padDots = opts.padDots || (st => {
      const dots = [];
      for (let i = 0; i < settings.runners; i++) dots.push(i < st.runner ? 'done' : (i === st.runner && g.phase === 'race' ? 'now' : ''));
      return dots;
    });
    function updatePads() {
      TEAMS.forEach(t => {
        const st = g.state[t.id]; if (!st) return;
        const el = pads[t.id];
        el.querySelector('.pad-runners').innerHTML = padDots(st).map(cls => `<i class="${cls}"></i>`).join('');
        st.label = padText(st);
        el.querySelector('.pad-state').textContent = st.label;
        el.classList.toggle('done', !!st.rank || st.dq);
      });
    }
    // 매 프레임 바뀔 수 있는 글자는 바뀔 때만 다시 써요
    function refreshPad(t) {
      const st = g.state[t.id];
      const text = padText(st);
      if (text !== st.label) { st.label = text; pads[t.id].querySelector('.pad-state').textContent = text; }
    }

    function say(text, color, secs = 1.6) { g.banner = { text, color, t: secs }; }
    function shakePad(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    // 너무 빠른 연타는 무시하고, 받아들이면 true
    function tapGap(st) {
      const now = performance.now();
      if (now - st.lastTap < MIN_TAP_GAP) return false;
      st.lastTap = now;
      return true;
    }

    function tap(id) {
      const t = TEAMS.find(x => x.id === id);
      const st = g.state[id];
      if (!t || !st || !st.active) return;
      const el = pads[id];
      el.classList.add('hit');
      clearTimeout(el._hit); el._hit = setTimeout(() => el.classList.remove('hit'), 70);

      if (g.phase === 'countdown') {
        if (opts.early) { if (!st.dq) opts.early(t, st, el); return; }
        shakePad(el);
        sfx.foul();
        say(`${t.name}! 아직이에요`, t.color, 1.0);
        return;
      }
      if (g.phase !== 'race' || st.finished || st.dq) return;
      opts.tap(t, st, el);
    }

    // ---------- 입력 ----------
    const press = opts.press;
    TEAMS.forEach(t => {
      const el = pads[t.id];
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (press) {
          try { el.setPointerCapture?.(e.pointerId); } catch (err) {}
          press(t.id, true);
        }
        tap(t.id);
      });
      // touchend 도 함께 봐요: 확대 막기 때문에 기본 동작을 막아도 손 뗀 걸 놓치지 않게
      if (press) ['pointerup', 'pointercancel', 'lostpointercapture', 'touchend', 'touchcancel'].forEach(ev => el.addEventListener(ev, () => press(t.id, false)));
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
    addEventListener('keydown', e => {
      const t = TEAMS.find(x => x.key === e.key.toLowerCase());
      if (!t) return;
      if (press) press(t.id, true);
      if (!e.repeat) tap(t.id);
    });
    if (press) addEventListener('keyup', e => {
      const t = TEAMS.find(x => x.key === e.key.toLowerCase());
      if (t) press(t.id, false);
    });

    document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.pick;
      if (settings.teams.has(id)) {
        if (settings.teams.size <= 2) return;
        settings.teams.delete(id);
      } else settings.teams.add(id);
      b.setAttribute('aria-pressed', settings.teams.has(id));
      resetState();
    }));
    (opts.chips || []).forEach(attr => {
      document.querySelectorAll(`[data-${attr}]`).forEach(b => b.addEventListener('click', () => {
        settings[attr] = +b.dataset[attr];
        document.querySelectorAll(`[data-${attr}]`).forEach(x => x.setAttribute('aria-pressed', x === b));
        resetState();
      }));
    });
    function toMenu() { resultEl.hidden = true; introEl.hidden = false; g.phase = 'intro'; g.match.heat = 1; resetState(); }
    document.getElementById('startBtn').addEventListener('click', () => { Fullscreen.enter(); startMatch(); });
    document.getElementById('nextBtn').addEventListener('click', () => {
      Fullscreen.enter();
      const match = g.match;
      if (match.heat < settings.heats && match.history.length === match.heat) { match.heat++; startHeat(); }
      else startMatch();
    });
    document.getElementById('menuBtn').addEventListener('click', toMenu);
    document.getElementById('helpBtn').addEventListener('click', toMenu);
    const soundBtn = document.getElementById('soundBtn');
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      soundBtn.textContent = soundOn ? '소리 켜짐' : '소리 꺼짐';
      soundBtn.setAttribute('aria-pressed', soundOn);
    });
    // 전체 화면 버튼 (브라우저에서 열었을 때만)
    if (Fullscreen.usable()) {
      const fsBtn = document.createElement('button');
      fsBtn.className = 'tool'; fsBtn.id = 'fsBtn'; fsBtn.type = 'button';
      const label = () => {
        fsBtn.textContent = Fullscreen.active() ? '전체 화면 끄기' : '전체 화면';
        fsBtn.setAttribute('aria-pressed', Fullscreen.active());
      };
      fsBtn.addEventListener('click', () => (Fullscreen.active() ? Fullscreen.exit() : Fullscreen.enter()));
      ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, label));
      label();
      document.getElementById('tools').appendChild(fsBtn);
    }
    // Safari: 전체 화면 대신 홈 화면에 추가하도록 설명 화면에 안내
    if (Fullscreen.suggestInstall()) {
      const tip = document.createElement('p');
      tip.className = 'install-tip';
      tip.innerHTML = '<b>탭 없이 쓰려면</b> Safari <kbd>공유</kbd> → <kbd>홈 화면에 추가</kbd> 로 설치해서 열어 주세요. '
        + 'Safari 는 전체 화면에서 빠르게 누르면 경고가 떠서, 브라우저에서는 전체 화면을 쓰지 않아요.';
      const start = document.getElementById('startBtn');
      start.parentNode.insertBefore(tip, start.nextSibling);
    }

    // ---------- 진행 ----------
    function burst(x, y, color, n = 26) {
      if (reduceMotion) n = Math.ceil(n / 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = (0.15 + Math.random() * 0.35) * g.S;
        g.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.4, max: 1.2, color, r: 3 + Math.random() * 4 });
      }
    }

    function update(dt) {
      if (g.phase === 'countdown') {
        g.countdownT -= dt;
        const n = Math.ceil(g.countdownT);
        if (n !== g.lastCount) { g.lastCount = n; if (n > 0 && !opts.countdown) sfx.count(); }
        if (g.countdownT <= 0) {
          g.phase = 'race';
          sfx.go();
          say(`${g.match.heat}${heatName} ${txt(opts.goText)}`, '#16224A', 1.0);
          updatePads();
        }
      }
      if (g.phase === 'race') {
        g.raceT += dt;
        opts.race(dt);
        if (opts.isOver ? opts.isOver() : TEAMS.every(t => !g.state[t.id].active || g.state[t.id].finished || g.state[t.id].dq)) g.phase = 'over';
      }
      TEAMS.forEach(t => {
        const st = g.state[t.id];
        if (st.pinFall > 0) st.pinFall = Math.min(1, st.pinFall + dt * 3);
      });
      if (opts.tick) opts.tick(dt);
      if (g.phase === 'over') {
        g.overT += dt;
        if (g.overT > 2.2) showResult();
      }
      g.particles.forEach(p => {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= Math.exp(-3 * dt); p.vy *= Math.exp(-3 * dt);
      });
      g.particles = g.particles.filter(p => p.life > 0);
      if (g.banner.t > 0) g.banner.t -= dt;
    }

    // 종료 핀에 닿을 때 속도(최고 속도 대비 0~1)로 슬라이딩 실격인지 정해요
    function slideFoul(speed) {
      if (speed <= FINISH_SAFE) return false;
      const over = Math.min(1, (speed - FINISH_SAFE) / (1 - FINISH_SAFE));
      return Math.random() < FINISH_CHANCE * (0.4 + 0.6 * over);
    }

    // 종료 핀을 넘어뜨리면 등수가 정해져요
    function knockPin(t) {
      const st = g.state[t.id];
      st.finished = true;
      st.v = 0;
      st.rank = ++g.rankCounter;
      st.time = g.raceT;
      st.pinFall = 0.001;
      const p = pinOf(t);
      burst(p.x, p.y, t.color, st.rank === 1 ? 70 : 40);
      if (st.rank === 1) burst(p.x, p.y, '#FFFFFF', 30);
      sfx.pin();
      const pts = points[st.rank - 1];
      say(`${t.name} ${st.rank}등!${pts ? ` +${pts}점` : ''}`, t.color, 2.2);
      updatePads();
    }

    function showResult() {
      g.phase = 'result';
      const match = g.match;
      const actives = TEAMS.filter(t => g.state[t.id].active);
      const heatRow = {};
      actives.forEach(t => {
        const st = g.state[t.id];
        const pts = st.dq ? 0 : (opts.heatScore ? opts.heatScore(t, st) : (points[st.rank - 1] || 0));
        heatRow[t.id] = { rank: st.rank, dq: st.dq, reason: st.dqReason, time: st.time, pts };
      });
      if (match.history.length < match.heat) {
        match.history.push(heatRow);
        actives.forEach(t => { match.scores[t.id] += heatRow[t.id].pts; });
      }
      const finalHeat = match.heat >= settings.heats;
      const titleEl = document.getElementById('resultTitle');
      const nextBtn = document.getElementById('nextBtn');
      let rows;
      if (!finalHeat) {
        titleEl.textContent = `${match.heat}${heatName} 결과${opts.heatTitle ? opts.heatTitle(match.heat) : ''}`;
        nextBtn.textContent = `${match.heat + 1}${heatName} ${opts.nextReady}`;
        const sub = opts.resultSub || ((t, h) => `${h.time.toFixed(1)}초`);
        rows = actives.slice().sort((a, b) => (heatRow[a.id].dq - heatRow[b.id].dq) || ((heatRow[a.id].rank || 99) - (heatRow[b.id].rank || 99)))
          .map(t => {
            const h = heatRow[t.id];
            return place(t, h.dq ? '실격' : rankText(h.rank), h.dq ? h.reason : sub(t, h), `${h.pts}점`, h.dq);
          });
      } else {
        titleEl.textContent = settings.heats > 1 ? '최종 점수' : '경기 결과';
        nextBtn.textContent = '처음부터 다시';
        // 점수 → 조별 순위 합(실격은 꼴찌 취급) 순으로 정렬
        const tie = t => match.history.reduce((sum, h) => sum + (h[t.id].dq || !h[t.id].rank ? 9 : h[t.id].rank), 0);
        const key = t => match.scores[t.id] * 100 - tie(t);
        const order = actives.slice().sort((a, b) => key(b) - key(a));
        rows = order.map(t => {
          const same = order.filter(x => key(x) === key(t));
          const rk = order.findIndex(x => key(x) === key(t)) + 1;
          const parts = match.history.map((h, hi) => {
            const r = h[t.id];
            return `${hi + 1}${heatName} ${r.dq ? '실격' : rankText(r.rank)}`;
          }).join(' · ');
          return place(t, (same.length > 1 ? '공동 ' : '') + rk + '등', parts, `${match.scores[t.id]}점`, false);
        });
      }
      document.getElementById('podium').innerHTML = rows.join('');
      resultEl.hidden = false;
    }
    function place(t, rk, sub, pts, dq) {
      return `<div class="place${dq ? ' dq' : ''}" style="--c:${t.color};--t:${t.text}"><span class="rk">${rk}</span><span class="nm">${t.name} 팀<span class="sub">${sub}</span></span><span class="tm">${pts}</span></div>`;
    }

    // ---------- 그리기 ----------
    // track(on): 달리는 길 위, 대각선 아래에 그릴 게임 고유 표시 (배턴 존, 네모칸)
    // startLines: 출발선 + 방향 표시
    function drawCourt({ track, startLines, boxes } = {}) {
      const { m, C, c, R, band, laneR, box } = geo();
      const S = g.S;
      const on = t => g.state[t.id]?.active !== false;

      ctx.fillStyle = '#DCE3EC';
      ctx.fillRect(0, 0, S, S);
      // 팀 색 띠 (변 바깥)
      TEAMS.forEach(t => {
        const a = cornerOf(t), next = cornerOf(TEAMS[(TEAMS.indexOf(t) + 1) % 4]);
        const side = t.angle + Math.PI / 4;
        const ox = Math.cos(side) * m, oy = Math.sin(side) * m;
        ctx.fillStyle = on(t) ? t.color : hexA(t.color, 0.3);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(next.x, next.y);
        ctx.lineTo(next.x + ox, next.y + oy); ctx.lineTo(a.x + ox, a.y + oy);
        ctx.closePath(); ctx.fill();
      });
      ctx.fillStyle = '#F2F5F9';
      ctx.fillRect(m, m, C, C);
      // 팀 구역
      TEAMS.forEach(t => {
        const a = cornerOf(t), next = cornerOf(TEAMS[(TEAMS.indexOf(t) + 1) % 4]);
        ctx.fillStyle = hexA(t.color, on(t) ? 0.1 : 0.03);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(next.x, next.y); ctx.lineTo(c, c); ctx.closePath(); ctx.fill();
      });
      ctx.strokeStyle = '#16224A'; ctx.lineWidth = 2;
      ctx.strokeRect(m, m, C, C);

      // 달리는 길
      ctx.beginPath(); ctx.arc(c, c, R + band, 0, TAU); ctx.arc(c, c, R, 0, TAU, true);
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();

      if (track) track(on);
      if (boxes !== false) drawWaitBoxes(on);   // 네모칸은 경기장 기본 선이라 모든 게임에 그려요

      // 대각선
      TEAMS.forEach(t => {
        const a = cornerOf(t), b = at(t.angle, box * Math.SQRT2);
        ctx.strokeStyle = on(t) ? t.color : hexA(t.color, 0.3);
        ctx.lineWidth = Math.max(3, C * 0.008); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });

      // 서클 라인
      ctx.beginPath(); ctx.arc(c, c, R, 0, TAU);
      ctx.lineWidth = Math.max(4, C * 0.01); ctx.strokeStyle = '#16224A'; ctx.stroke();

      // 가운데 사각형
      const sq = [
        ['red', c - box, c - box, c + box, c - box],
        ['blue', c + box, c - box, c + box, c + box],
        ['green', c + box, c + box, c - box, c + box],
        ['yellow', c - box, c + box, c - box, c - box],
      ];
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(c - box, c - box, box * 2, box * 2);
      sq.forEach(([id, x1, y1, x2, y2]) => {
        const t = TEAMS.find(x => x.id === id);
        ctx.strokeStyle = on(t) ? t.color : hexA(t.color, 0.3);
        ctx.lineWidth = Math.max(4, C * 0.011); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });

      // 출발선 + 방향 표시
      if (startLines) TEAMS.forEach(t => {
        if (!on(t)) return;
        const a = at(t.angle, R + band * 0.25), b = at(t.angle, R + band);
        ctx.strokeStyle = '#16224A'; ctx.lineWidth = Math.max(5, C * 0.012); ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = t.color; ctx.lineWidth = Math.max(3, C * 0.007);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const aa = t.angle - 0.3;
        const ap = at(aa, laneR);
        const dir = aa - Math.PI / 2, hs = C * 0.018;
        ctx.strokeStyle = 'rgba(22,34,74,.35)'; ctx.lineWidth = Math.max(3, C * 0.007); ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ap.x + Math.cos(dir + 2.5) * hs, ap.y + Math.sin(dir + 2.5) * hs);
        ctx.lineTo(ap.x, ap.y);
        ctx.lineTo(ap.x + Math.cos(dir - 2.5) * hs, ap.y + Math.sin(dir - 2.5) * hs);
        ctx.stroke();
        const lp = at(t.angle, R + band + C * 0.04);
        ctx.fillStyle = '#16224A'; ctx.font = font(C * 0.028);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('출발', lp.x, lp.y);
      });
      ctx.lineCap = 'butt';
    }

    // ⑤ 네모칸: 서클 라인 안쪽 (drawCourt 의 track 에서 불러요)
    function drawWaitBoxes(on) {
      TEAMS.forEach(t => {
        const q = at(t.angle + ZC, boxR());
        const h = BOX_H();
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(t.angle + ZC);
        ctx.strokeStyle = on(t) ? '#16224A' : 'rgba(22,34,74,.35)'; ctx.lineWidth = 2;
        ctx.strokeRect(-h, -h, h * 2, h * 2);
        ctx.restore();
      });
    }

    function pinShape(h) {
      ctx.beginPath(); ctx.arc(0, -h * 0.82, h * 0.13, 0, TAU);
      ctx.moveTo(-h * 0.08, -h * 0.7);
      ctx.bezierCurveTo(-h * 0.07, -h * 0.55, -h * 0.26, -h * 0.4, -h * 0.2, -h * 0.02);
      ctx.lineTo(h * 0.2, -h * 0.02);
      ctx.bezierCurveTo(h * 0.26, -h * 0.4, h * 0.07, -h * 0.55, h * 0.08, -h * 0.7);
      ctx.closePath();
    }
    function drawOnePin(x, y, h, color, fall, fallDir, glow, now, shake = 0) {
      ctx.save();
      ctx.translate(x, y + h * 0.45);
      if (glow && !reduceMotion) {
        ctx.beginPath(); ctx.arc(0, -h * 0.45, h * (0.62 + Math.sin(now / 150) * 0.06), 0, TAU);
        ctx.fillStyle = glow; ctx.fill();
      }
      ctx.rotate((Math.cos(fallDir) >= 0 ? 1 : -1) * (Math.PI / 2) * easeOut(fall) + (reduceMotion ? 0 : Math.sin(now / 45) * 0.35 * shake));
      pinShape(h); ctx.lineWidth = Math.max(3, h * 0.1); ctx.strokeStyle = '#16224A'; ctx.lineJoin = 'round'; ctx.stroke();
      pinShape(h); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(-h * 0.1, -h * 0.66, h * 0.2, h * 0.06);
      ctx.fillRect(-h * 0.13, -h * 0.57, h * 0.26, h * 0.06);
      ctx.restore();
    }

    function drawRunner(t, x, y, dir, size, legPhase, o = {}) {
      const moving = o.moving;
      ctx.fillStyle = 'rgba(22,34,74,.18)';
      ctx.beginPath(); ctx.ellipse(x, y + size * 0.9, size * 0.9, size * 0.35, 0, 0, TAU); ctx.fill();
      if (moving && o.speed > 0.55) {
        ctx.strokeStyle = hexA(t.color, 0.45); ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          const ox = x - Math.cos(dir) * size * 1.4 + Math.cos(dir + Math.PI / 2) * i * size * 0.5;
          const oy = y - Math.sin(dir) * size * 1.4 + Math.sin(dir + Math.PI / 2) * i * size * 0.5;
          const len = size * (0.6 + o.speed);
          ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox - Math.cos(dir) * len, oy - Math.sin(dir) * len); ctx.stroke();
        }
      }
      const swing = moving ? Math.sin(legPhase) * size * 0.55 : 0;
      ctx.strokeStyle = '#16224A'; ctx.lineWidth = Math.max(3, size * 0.22); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - size * 0.3, y + size * 0.5); ctx.lineTo(x - size * 0.3 + swing, y + size * 1.05);
      ctx.moveTo(x + size * 0.3, y + size * 0.5); ctx.lineTo(x + size * 0.3 - swing, y + size * 1.05);
      ctx.stroke();
      ctx.globalAlpha *= o.faded ? 0.45 : 1;
      ctx.beginPath(); ctx.arc(x, y, size, 0, TAU);
      ctx.fillStyle = t.color; ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.18); ctx.strokeStyle = o.last ? '#F5C21B' : '#fff'; ctx.stroke();
      if (o.baton) {
        const bx = x + Math.cos(dir) * size * 1.05, by = y + Math.sin(dir) * size * 1.05;
        ctx.save(); ctx.translate(bx, by); ctx.rotate(dir);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#16224A'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(-size * 0.55, -size * 0.2, size * 1.1, size * 0.4, size * 0.15); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      if (o.label != null) {
        ctx.fillStyle = t.text; ctx.font = font(size * (String(o.label).length > 1 ? 0.9 : 1.1));
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(o.label, x, y + size * 0.05);
      }
      ctx.globalAlpha = 1;
    }

    function drawCoach(t, x, y, size) {
      ctx.beginPath(); ctx.arc(x, y, size * 1.15, 0, TAU);
      ctx.fillStyle = '#16224A'; ctx.fill();
      ctx.lineWidth = Math.max(3, size * 0.28); ctx.strokeStyle = t.color; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = font(size * 0.8);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('코치', x, y + size * 0.05);
    }

    function warnLabel(x, y, text, good) {
      const { C } = geo();
      ctx.font = font(C * 0.036); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = C * 0.01; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = good ? '#1FA35A' : '#E8403A';
      ctx.fillText(text, x, y);
    }

    function drawParticles() {
      g.particles.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function fitText(text, maxW, px) {
      let fs = px;
      ctx.font = font(fs);
      while (ctx.measureText(text).width > maxW && fs > 10) { fs -= 1; ctx.font = font(fs); }
    }

    // 가운데: 카운트다운, 알림 글자, 지금 순위
    function drawCenter() {
      const { c, R, C } = geo();
      const heat = g.match.heat;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      if (g.phase === 'countdown' && opts.drawWait) { opts.drawWait(g.countdownT); return; }
      if (g.phase === 'countdown') {
        const n = Math.ceil(g.countdownT);
        const frac = g.countdownT - Math.floor(g.countdownT);
        const scale = reduceMotion ? 1 : 0.8 + frac * 0.4;
        ctx.font = font(C * 0.2 * scale);
        ctx.lineWidth = C * 0.02; ctx.strokeStyle = '#fff'; ctx.strokeText(n, c, c);
        ctx.fillStyle = '#16224A'; ctx.fillText(n, c, c);
        const sub = `${heat}${heatName} · 출발 소리를 기다려요`;
        ctx.fillStyle = '#5A6689'; fitText(sub, R * center.subWidth, C * 0.04);
        ctx.fillText(sub, c, c + R * center.sub);
        return;
      }
      if (g.phase === 'race' || g.phase === 'over' || g.phase === 'result') {
        const banner = g.banner;
        const showBanner = banner.t > 0;
        const text = showBanner ? banner.text : `${heat}${heatName} · ${txt(opts.idleText)}`;
        fitText(text, R * center.width, C * (showBanner ? 0.052 : 0.042));
        if (showBanner) {
          ctx.lineWidth = C * 0.012; ctx.strokeStyle = '#fff'; ctx.strokeText(text, c, c - R * center.top);
        }
        ctx.fillStyle = showBanner ? (banner.color === '#F5C21B' ? '#B88A00' : banner.color) : 'rgba(22,34,74,.4)';
        ctx.fillText(text, c, c - R * center.top);
        const actives = TEAMS.filter(t => g.state[t.id].active);
        const order = actives.slice().sort((a, b) => {
          const A = g.state[a.id], B = g.state[b.id];
          if (A.dq !== B.dq) return A.dq ? 1 : -1;
          if (A.rank || B.rank) return (A.rank || 99) - (B.rank || 99);
          return opts.progress(B, b) - opts.progress(A, a);
        });
        const dot = C * 0.022, gap = C * 0.01;
        ctx.font = font(C * 0.026);
        const label = '순위', lw = ctx.measureText(label).width + C * 0.015;
        const total = lw + order.length * dot * 2 + (order.length - 1) * gap;
        ctx.fillStyle = 'rgba(22,34,74,.45)'; ctx.textAlign = 'left';
        const y = c + R * center.rank;
        ctx.fillText(label, c - total / 2, y);
        ctx.textAlign = 'center';
        let x = c - total / 2 + lw + dot;
        order.forEach(t => {
          ctx.globalAlpha = g.state[t.id].dq ? 0.3 : 1;
          ctx.beginPath(); ctx.arc(x, y, dot, 0, TAU);
          ctx.fillStyle = t.color; ctx.fill();
          x += dot * 2 + gap;
        });
        ctx.globalAlpha = 1;
      }
    }

    function draw(now) {
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      opts.draw(now);
      drawParticles();
      drawCenter();
    }

    function run() {
      let last = performance.now();
      function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        update(dt);
        draw(now);
        requestAnimationFrame(frame);
      }
      layout();
      resetState();
      requestAnimationFrame(frame);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw(performance.now()));
    }

    return Object.assign(g, {
      ac, tone, sfx,
      geo, at, pinOf, ringPinOf, boxR, BOX_H, cornerOf, finalPath, posOf, ringTeamAt,
      resetState, updatePads, refreshPad, say, shakePad, tapGap, burst, knockPin, slideFoul,
      fitText, drawCourt, drawWaitBoxes, drawOnePin, drawRunner, drawCoach, warnLabel,
      run,
    });
  }

  return { TAU, reduceMotion, TEAMS, POINTS, ZC, START_S, FINISH_SAFE, hexA, font, easeOut, create };
})();
