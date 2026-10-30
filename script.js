// Jardim de Girassóis — lógica do jogo
(() => {
  'use strict';

  // ---------- Configurações ----------
  const MAX_PLANTS = 40;     // limite de plantas no campo
  const MIN_GAP = 54;        // distância mínima (px) entre duas plantas
  const FIELD_TOP = 0.2;     // não dá para plantar colado no horizonte
  const DAY_LENGTH = 60;     // segundos de um ciclo completo (dia + noite)
  const DAY_PART = 0.7;      // parte do ciclo que é dia (70%)
  const STAGE_TIME = 10;     // segundos de sol para passar de fase
  const BOOST = 0.5;         // quanto de fase uma regada ou um sol adiantam
  const SAVE_KEY = 'jardim-girassois-v6';
  const STAGES = ['Semente', 'Broto', 'Muda', 'Botão', 'Girassol'];
  const TOOLS = ['plant', 'water', 'sun', 'harvest'];

  // Cores do céu ao longo do ciclo: [momento, cor de cima, cor de baixo]
  const SKY = [
    [0.00, '#f6b98a', '#fde3c0'],
    [0.10, '#7cc0ea', '#d3ecf7'],
    [0.58, '#6fb7e8', '#cde9f6'],
    [0.70, '#e7805a', '#f8c48c'],
    [0.78, '#1c274b', '#3b4a7a'],
    [0.95, '#1c274b', '#3b4a7a'],
    [1.00, '#f6b98a', '#fde3c0'],
  ];
  // Quão escuro está: 0 = dia claro, 1 = noite
  const NIGHT = [[0, 0.2], [0.1, 0], [0.62, 0], [0.72, 0.6], [0.78, 1], [0.95, 1], [1, 0.2]];

  // ---------- Elementos da página ----------
  const $ = (s) => document.querySelector(s);
  const garden = $('#garden');
  const scene = $('#scene');
  const sunEl = $('#sun');
  const moonEl = $('#moon');
  const clockEl = $('#clock');
  const msgEl = $('#message');
  const dayEl = $('#stat-day');
  const fieldEl = $('#stat-field');
  const harvestEl = $('#stat-harvested');
  const toolBtns = [...document.querySelectorAll('[data-tool]')];
  const seedBar = $('#seeds');
  const resetBtn = $('#reset');

  // ---------- Tipos de flor ----------
  // k = tamanho da planta em relação ao girassol; blade = folhas compridas e finas
  const FLOWERS = {
    girassol: { nome: 'Girassol', plural: 'girassóis', um: 'um', k: 1, blade: false },
    margarida: { nome: 'Margarida', plural: 'margaridas', um: 'uma', k: 0.72, blade: false },
    tulipa: { nome: 'Tulipa', plural: 'tulipas', um: 'uma', k: 0.8, blade: true },
    iris: { nome: 'Íris', plural: 'íris', um: 'uma', k: 0.86, blade: true },
    papoula: { nome: 'Papoula', plural: 'papoulas', um: 'uma', k: 0.78, blade: false },
  };
  const KINDS = Object.keys(FLOWERS);
  const kindOf = (p) => FLOWERS[p.kind] || FLOWERS.girassol;

  // ---------- Estado do jogo ----------
  let nextId = 1;
  function newPlant(x, y, kind = 'girassol', progress = 0) {
    return { id: nextId++, x, y, kind, progress };
  }

  const emptyCount = () => Object.fromEntries(KINDS.map((k) => [k, 0]));

  function newGame() {
    // Um jardim de exemplo para começar (x e y vão de 0 a 1 dentro do campo)
    const plants = [
      newPlant(0.2, 0.62, 'girassol', 4),
      newPlant(0.42, 0.4, 'tulipa', 4),
      newPlant(0.58, 0.7, 'iris', 4),
      newPlant(0.78, 0.48, 'papoula', 4),
      newPlant(0.33, 0.86, 'margarida', 4),
      newPlant(0.85, 0.85, 'girassol', 2.3),
    ];
    return { harvested: emptyCount(), day: 1, time: 0.18, tool: 'plant', seed: 'girassol', plants };
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.plants)) return null;
      nextId = s.plants.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      s.harvested = Object.assign(emptyCount(), s.harvested);
      if (!FLOWERS[s.seed]) s.seed = 'girassol';
      return s;
    } catch (e) {
      return null;
    }
  }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* sem salvamento */ }
  }

  let state = load() || newGame();

  const isDay = () => state.time < DAY_PART;

  // ---------- Mensagens e efeitos ----------
  function say(text) { msgEl.textContent = text; }

  function effect(p, kind, text = '') {
    const el = plantEls.get(p.id);
    if (!el) return;
    const fx = document.createElement('span');
    fx.className = 'fx ' + kind;
    fx.textContent = text;
    el.appendChild(fx);
    setTimeout(() => fx.remove(), 1200);
  }

  // Efeito solto no campo (quando a planta some ao ser colhida)
  function fieldEffect(p, kind, text = '') {
    const fx = document.createElement('span');
    fx.className = 'fx ' + kind;
    fx.textContent = text;
    Object.assign(fx.style, {
      inset: 'auto', left: p.x * 100 + '%', top: p.y * 100 + '%',
      width: '110px', height: '60px', transform: 'translate(-50%, -80%)', zIndex: 998
    });
    garden.appendChild(fx);
    setTimeout(() => fx.remove(), 1200);
  }

  // Posição do clique dentro do campo, de 0 a 1
  function fieldPoint(e) {
    const r = garden.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
  }

  // Em telas estreitas as plantas ficam menores (17% da largura da tela, até 104px)
  const plantUnit = () => Math.min(104, window.innerWidth * 0.17) / 104;

  function canPlantAt(pt) {
    if (pt.y < FIELD_TOP) return 'Plante um pouco mais para baixo, longe do horizonte.';
    if (pt.x < 0.04 || pt.x > 0.96 || pt.y > 0.97) return 'Plante um pouco mais para dentro do campo.';
    const tooClose = state.plants.some((p) => {
      const dx = (p.x - pt.x) * pt.r.width, dy = (p.y - pt.y) * pt.r.height;
      return Math.hypot(dx, dy * 1.6) < MIN_GAP * scaleFor(pt.y) * plantUnit();
    });
    if (tooClose) return 'Muito perto de outra planta. Flor precisa de espaço.';
    if (state.plants.length >= MAX_PLANTS) return 'O campo está cheio. Colha algumas flores primeiro.';
    return '';
  }

  // Clique no campo vazio: só serve para plantar
  function plantAt(pt) {
    if (state.tool !== 'plant') return say('Clique numa planta para usar essa ferramenta.');
    const problem = canPlantAt(pt);
    if (problem) return say(problem);
    const p = newPlant(pt.x, pt.y, state.seed);
    state.plants.push(p);
    say(`Semente de ${FLOWERS[state.seed].nome.toLowerCase()} plantada. Ela cresce sozinha durante o dia.`);
    render();
    effect(p, 'dirt');
    save();
  }

  // Clique numa planta
  function act(p) {
    const remove = () => { state.plants = state.plants.filter((q) => q !== p); };
    switch (state.tool) {
      case 'plant': {
        const f = kindOf(p), st = Math.floor(p.progress);
        say(st >= 4
          ? `${f.nome} ${f.um === 'um' ? 'aberto' : 'aberta'}. Use Colher para colher.`
          : `${f.nome}: ${STAGES[st].toLowerCase()}, ${Math.floor((p.progress % 1) * 100)}% da fase. Clique num espaço livre para plantar.`);
        break;
      }

      case 'water':
      case 'sun': {
        const isSun = state.tool === 'sun';
        if (isSun && !isDay()) return say('É noite. Espere amanhecer para dar sol.');
        if (p.progress >= 4) return say(`Essa ${kindOf(p).nome.toLowerCase()} já floriu. Use Colher para colher.`);
        grow(p, BOOST);
        effect(p, isSun ? 'glow' : 'drops');
        if (p.progress < 4) say(isSun ? 'A planta tomou sol e cresceu um pouco.' : 'Planta regada. Ela cresceu um pouco.');
        break;
      }

      case 'harvest':
        if (p.progress >= 4) {
          const f = kindOf(p);
          state.harvested[p.kind] = (state.harvested[p.kind] || 0) + 1;
          remove();
          fieldEffect(p, 'pop', `+1 ${f.nome.toLowerCase()}`);
          say(`Você colheu ${f.um} ${f.nome.toLowerCase()}.`);
          break;
        }
        return say(`Ainda está na fase ${STAGES[Math.floor(p.progress)]}. Espere florescer.`);
    }
    render();
    save();
  }

  function setTool(tool) {
    state.tool = tool;
    render();
  }

  // Faz a planta avançar e avisa quando ela floresce
  function grow(p, amount) {
    if (p.progress >= 4) return;
    p.progress = Math.min(4, p.progress + amount);
    if (p.progress >= 4) say(`${kindOf(p).um === 'um' ? 'Um' : 'Uma'} ${kindOf(p).nome.toLowerCase()} abriu! Use Colher para colher.`);
  }

  // ---------- Passagem do tempo ----------
  function tick(dt) {
    state.time += dt / DAY_LENGTH;
    if (state.time >= 1) {
      state.time -= 1;
      state.day++;
      say(`Amanheceu. Começou o dia ${state.day}.`);
    }
    const day = isDay();

    // As plantas crescem sozinhas durante o dia
    if (day) state.plants.forEach((p) => grow(p, dt / STAGE_TIME));
  }

  // ---------- Desenho das plantas (SVG) ----------
  const svg = (inner) => `<svg viewBox="0 0 100 140" aria-hidden="true">${inner}</svg>`;
  const MOUND = '<ellipse class="mound" cx="50" cy="132" rx="28" ry="6"/>';

  function leaf(x, y, len, ang) {
    const w = len * 0.38;
    return `<path class="leaf" transform="translate(${x} ${y}) rotate(${ang})" d="M0 0 Q${len * 0.5} ${-w} ${len} 0 Q${len * 0.5} ${w} 0 0Z"/>`;
  }

  function stem(top) {
    const h = 131 - top;
    return `<path class="stem" d="M50 131 C49 ${top + h * 0.6} 51 ${top + h * 0.3} 50 ${top}"/>`;
  }

  let headCache = '';
  function head() {
    if (headCache) return headCache;
    let s = '';
    for (let k = 0; k < 14; k++) s += `<ellipse class="petal deep" cx="0" cy="-17" rx="4.6" ry="10" transform="rotate(${k * 360 / 14 + 12.8})"/>`;
    for (let k = 0; k < 14; k++) s += `<ellipse class="petal" cx="0" cy="-16" rx="4.4" ry="10" transform="rotate(${k * 360 / 14})"/>`;
    s += '<circle class="disk" r="11.5"/>';
    // Sementes do miolo em espiral, usando o ângulo de ouro (137,5°)
    for (let n = 1; n <= 90; n++) {
      const r = 1.2 * Math.sqrt(n);
      if (r > 10.5) break;
      const th = n * 137.508 * Math.PI / 180;
      s += `<circle class="seedpt" cx="${(r * Math.cos(th)).toFixed(2)}" cy="${(r * Math.sin(th)).toFixed(2)}" r="0.75"/>`;
    }
    headCache = s;
    return s;
  }

  function bud(tip = 'petal') {
    let s = '';
    for (let k = 0; k < 8; k++) s += `<path class="sepal" d="M0 -12 L3 -4 L-3 -4Z" transform="rotate(${k * 45})"/>`;
    return s + `<circle class="bud" r="7.5"/><circle class="${tip}" cy="-5" r="2.6"/>`;
  }

  // Área invisível que recebe o clique, do tamanho da planta
  const hit = (top, w = 40) => `<rect class="hit" x="${50 - w / 2}" y="${top}" width="${w}" height="${140 - top}" rx="8"/>`;

  // Folha comprida e fina (tulipa, íris)
  function blade(x, y, len, ang) {
    const w = len * 0.13;
    return `<path class="leaf" transform="translate(${x} ${y}) rotate(${ang})" d="M0 0 Q${len * 0.5} ${-w} ${len} 0 Q${len * 0.5} ${w} 0 0Z"/>`;
  }

  // Cabeças das flores abertas, desenhadas em volta do ponto (0, 0)
  const ring = (n, fn) => Array.from({ length: n }, (_, k) => fn((k * 360) / n)).join('');
  const HEADS = {
    girassol: () => head(),
    margarida: () =>
      ring(20, (a) => `<ellipse class="daisy-petal" cx="0" cy="-10" rx="2.3" ry="7.5" transform="rotate(${a})"/>`) +
      '<circle class="daisy-center" r="5.2"/><circle class="daisy-center-dark" r="5.2" fill-opacity="0.35" cx="0.8" cy="0.8"/>',
    tulipa: () =>
      '<path class="tulip-back" d="M-9 -2 C-11 -14 -6 -21 0 -23 C6 -21 11 -14 9 -2 C6 4 -6 4 -9 -2Z"/>' +
      '<path class="tulip" d="M-10 -3 C-11 -13 -7 -19 -2 -21 C-3 -12 -1 -4 1 4 C-4 5 -9 2 -10 -3Z"/>' +
      '<path class="tulip" d="M10 -3 C11 -13 7 -19 2 -21 C3 -12 1 -4 -1 4 C4 5 9 2 10 -3Z"/>',
    iris: () =>
      [-28, 0, 28].map((a) => `<ellipse class="iris-up" cx="0" cy="-10" rx="4" ry="9.5" transform="rotate(${a})"/>`).join('') +
      [-55, 0, 55].map((a) => `<g transform="rotate(${a})"><ellipse class="iris-fall" cx="0" cy="9" rx="5" ry="10"/><ellipse class="iris-beard" cx="0" cy="4" rx="1.4" ry="4"/></g>`).join(''),
    papoula: () =>
      ring(4, (a) => `<circle class="poppy" cx="0" cy="-7" r="9.5" transform="rotate(${a + 45})"/>`) +
      ring(4, (a) => `<circle class="poppy-light" cx="0" cy="-8" r="6" transform="rotate(${a})" fill-opacity="0.55"/>`) +
      '<circle class="poppy-center" r="4.2"/>' +
      ring(8, (a) => `<circle class="poppy-dot" cx="0" cy="-6.2" r="0.9" transform="rotate(${a})"/>`),
  };

  // Cor da pontinha do botão de cada flor
  const BUD_TIP = { girassol: 'petal', margarida: 'daisy-petal', tulipa: 'tulip', iris: 'iris-fall', papoula: 'poppy' };

  function drawPlant(p) {
    let g = MOUND;
    const s = Math.floor(p.progress);
    const kind = FLOWERS[p.kind] ? p.kind : 'girassol';
    const L = FLOWERS[kind].blade ? blade : leaf;
    g += hit([112, 96, 64, 26, 0][s], s === 4 ? 58 : 44);
    if (s === 0) {
      g += '<ellipse class="seed" cx="50" cy="126" rx="6" ry="3.6" transform="rotate(-12 50 126)"/>' +
        '<path class="seed-stripe" d="M45 126.6 L55 124.4"/>';
    } else if (s === 1) {
      g += stem(108) + leaf(50, 110, 15, -150) + leaf(50, 110, 15, -30);
    } else if (s === 2) {
      g += stem(72) + L(50, 116, 24, -160) + L(50, 104, 24, -20) +
        L(50, 90, 18, -155) + L(50, 78, 13, -35) + L(50, 74, 11, -140);
    } else if (kind === 'girassol') {
      g += stem(46) + leaf(50, 118, 26, -165) + leaf(50, 104, 26, -15) +
        leaf(50, 90, 24, -160) + leaf(50, 76, 21, -22) + leaf(50, 62, 16, -150);
      g += s === 3
        ? `<g transform="translate(50 40)"><g class="head turn">${bud(BUD_TIP.girassol)}</g></g>`
        : `<g transform="translate(50 30)"><g class="head turn">${head()}</g></g>`;
    } else {
      g += stem(48) + (FLOWERS[kind].blade
        ? blade(50, 126, 46, -110) + blade(50, 124, 42, -72) + blade(50, 110, 34, -125)
        : leaf(50, 116, 22, -160) + leaf(50, 100, 20, -20) + leaf(50, 82, 16, -150));
      g += s === 3
        ? `<g transform="translate(50 42) scale(1.1)"><g class="head">${bud(BUD_TIP[kind])}</g></g>`
        : `<g transform="translate(50 36) scale(1.4)"><g class="head">${HEADS[kind]()}</g></g>`;
    }
    return svg(g);
  }

  // Desenho pequeno da flor para os botões de semente
  const flowerIcon = (kind) => `<svg viewBox="-26 -26 52 52" aria-hidden="true">${HEADS[kind]()}</svg>`;

  // ---------- Plantas no campo ----------
  const plantEls = new Map(); // id da planta -> elemento na tela

  // Plantas mais embaixo estão mais perto, então ficam maiores
  const scaleFor = (y) => 0.6 + 0.6 * y;

  function makePlantEl(p) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'plant';
    b.id = 'plant-' + p.id;
    b.innerHTML = '<div class="art"></div><span class="info"><span class="tag"></span></span>';
    b.style.left = (p.x * 100).toFixed(2) + '%';
    b.style.top = (p.y * 100).toFixed(2) + '%';
    b.style.zIndex = Math.round(p.y * 900) + 10;
    b.style.setProperty('--s', scaleFor(p.y).toFixed(3));
    b.style.setProperty('--k', kindOf(p).k);
    garden.appendChild(b);
    plantEls.set(p.id, b);
    return b;
  }

  garden.addEventListener('click', (e) => {
    const el = e.target.closest('.plant');
    if (el) {
      const p = state.plants.find((q) => 'plant-' + q.id === el.id);
      if (p) act(p);
      return;
    }
    plantAt(fieldPoint(e));
  });

  // ---------- Gramado pintado em pinceladas, com tufos balançando ----------
  const fieldCanvas = document.createElement('canvas');
  fieldCanvas.className = 'field-paint';
  fieldCanvas.setAttribute('aria-hidden', 'true');
  const fieldDecor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  fieldDecor.setAttribute('class', 'decor');
  fieldDecor.setAttribute('aria-hidden', 'true');
  garden.prepend(fieldCanvas, fieldDecor);

  const GRASS = ['#4fa83a', '#6cc04a', '#8fd655', '#3a9136', '#b5e06a', '#2e7f37', '#5cb848', '#3f9a6a'];
  const GRASS_FAR = ['#9fcf5c', '#b9dc6c', '#8cc552', '#cde27a', '#a8d26a'];
  const BLOOMS = ['#ffd23f', '#ffffff', '#ff8c42', '#e8545e', '#b18cf0', '#ffe680'];

  function paintField() {
    const W = garden.clientWidth, H = garden.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    fieldCanvas.width = Math.round(W * dpr);
    fieldCanvas.height = Math.round(H * dpr);
    const c = fieldCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seed = 23;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    c.lineCap = 'round';

    // Fundo: verde-amarelado lá longe, verde forte aqui na frente
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#a6d35e');
    g.addColorStop(0.5, '#6dbb45');
    g.addColorStop(1, '#3f9a3a');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // Pinceladas de grama, menores ao longe (perspectiva) e balançadas pelo vento
    const count = Math.round((W * H) / 38);
    for (let k = 0; k < count; k++) {
      const y = rnd() * H, x = rnd() * W, depth = y / H;
      const z = 0.35 + depth;
      const len = (5 + rnd() * 8) * z;
      const lean = Math.sin(x / 60 + y / 40) * 0.5 + (rnd() - 0.5) * 0.6;
      c.strokeStyle = depth < 0.35 && rnd() < 0.6 ? pick(GRASS_FAR) : pick(GRASS);
      c.lineWidth = (1.4 + rnd() * 1.8) * z;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + lean * len * 0.4, y - len * 0.6, x + lean * len, y - len);
      c.stroke();
    }

    // Florzinhas do campo
    for (let k = 0; k < (W * H) / 1800; k++) {
      const y = rnd() * H, x = rnd() * W, z = 0.35 + y / H;
      c.fillStyle = pick(BLOOMS);
      c.beginPath();
      c.arc(x, y, (1.3 + rnd() * 1.6) * z, 0, Math.PI * 2);
      c.fill();
    }

    // Tufos na frente, que balançam com o vento (animados pelo CSS)
    let s = '';
    for (let k = 0; k < Math.round(W / 9); k++) {
      const y = H * (0.15 + rnd() * 0.85), x = rnd() * W, z = 0.4 + y / H;
      const h = (10 + rnd() * 8) * z, w = 4 * z;
      const color = pick(['#2e7f37', '#4fa83a', '#8fd655', '#3a9136']);
      s += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><path class="blade" style="stroke:${color};stroke-width:${(1.6 * z).toFixed(2)};animation-delay:${(-rnd() * 4).toFixed(2)}s" d="M0 0 Q${-w * 0.4} ${-h * 0.5} ${-w} ${-h} M0 0 Q0 ${-h * 0.6} ${w * 0.3} ${-h * 1.25} M0 0 Q${w * 0.4} ${-h * 0.5} ${w} ${-h * 0.9}"/></g>`;
    }
    fieldDecor.setAttribute('viewBox', `0 0 ${W} ${H}`);
    fieldDecor.innerHTML = s;
  }

  let fieldTimer = null;
  let lastFieldW = 0;
  new ResizeObserver(() => {
    if (garden.clientWidth === lastFieldW) return;
    lastFieldW = garden.clientWidth;
    clearTimeout(fieldTimer);
    fieldTimer = setTimeout(paintField, 120);
  }).observe(garden);

  // Marcador que mostra onde a semente vai cair
  const ghost = document.createElement('span');
  ghost.className = 'ghost';
  ghost.hidden = true;
  garden.appendChild(ghost);
  garden.addEventListener('pointermove', (e) => {
    if (state.tool !== 'plant' || e.pointerType === 'touch' || e.target.closest('.plant')) {
      ghost.hidden = true;
      return;
    }
    const pt = fieldPoint(e);
    ghost.hidden = false;
    ghost.style.left = pt.x * 100 + '%';
    ghost.style.top = pt.y * 100 + '%';
    ghost.style.scale = scaleFor(pt.y).toFixed(2);
    ghost.classList.toggle('blocked', !!canPlantAt(pt));
  });
  garden.addEventListener('pointerleave', () => { ghost.hidden = true; });

  // ---------- Céu pintado, no estilo de A Noite Estrelada (Van Gogh, 1889) ----------
  const skyEl = document.querySelector('.sky');
  const paintDay = $('#paint-day');
  const paintNight = $('#paint-night');
  const twinkles = $('#twinkles');

  // Estrelas: [x, y, tamanho] com x e y de 0 a 1
  const STARS = [[0.1, 0.2, 1], [0.24, 0.1, 0.75], [0.33, 0.44, 0.7], [0.53, 0.13, 0.9],
  [0.66, 0.4, 0.75], [0.76, 0.12, 0.8], [0.91, 0.28, 1], [0.45, 0.62, 0.55], [0.18, 0.5, 0.6]];
  // Redemoinhos: [x, y, raio (fração da largura), força e sentido]
  const SWIRLS = [[0.4, 0.4, 0.15, 1.5], [0.58, 0.33, 0.11, -1.2], [0.84, 0.58, 0.09, 1]];

  const PALETTES = {
    night: {
      base: '#1b2f6b',
      strokes: ['#16285e', '#22408a', '#2f56a6', '#4a74c4', '#1a3a7a', '#5f86cc'],
      swirl: ['#a9c3e8', '#d8e4f0', '#6f97d6', '#f2e6a0'],
      halo: ['#fff6b0', '#f4d35e', '#ffffff', '#e8b93a', '#bcd3f0'],
      hill: ['#14234f', '#1d3263', '#283f73', '#30487e'],
      cypress: ['#0f1a12', '#1d2b18', '#2c3a1c', '#3b2a14'],
    },
    day: {
      base: '#6fa6dc',
      strokes: ['#5e97d6', '#7fb3e6', '#9cc7ef', '#4f86c8', '#b7d8f3', '#6aa0dc'],
      swirl: ['#ffffff', '#eaf3fb', '#cfe4f6', '#fff3c8'],
      halo: null,
      hill: ['#4f7fb0', '#5f93b8', '#7aa6c2', '#6d9a84'],
      cypress: ['#1f3a1e', '#2f4f22', '#406428', '#24401f'],
    },
  };

  // Direção da pincelada em cada ponto: vento ondulado + redemoinhos
  function flow(x, y, W, H) {
    let vx = 1;
    let vy = 0.35 * Math.sin((x / W) * 6 + (y / H) * 3);
    const spin = (cx, cy, R, k) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) + 1;
      const w = k * 3 * Math.exp(-(d * d) / (R * R));
      vx += (-dy / d) * w;
      vy += (dx / d) * w;
    };
    SWIRLS.forEach(([sx, sy, sr, k]) => spin(sx * W, sy * H, sr * W, k));
    STARS.forEach(([sx, sy, r]) => spin(sx * W, sy * H, 0.05 * W * r, 1.2));
    const m = Math.hypot(vx, vy) || 1;
    return [vx / m, vy / m];
  }

  function swirlWeight(x, y, W, H) {
    let best = 0;
    SWIRLS.forEach(([sx, sy, sr]) => {
      const d2 = (x - sx * W) ** 2 + (y - sy * H) ** 2;
      best = Math.max(best, Math.exp(-d2 / ((sr * W) ** 2)));
    });
    return best;
  }

  function paint(cv, pal, seedStart) {
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seed = seedStart;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // Pincelada que segue o fluxo do céu
    const stroke = (x, y, steps, width, color) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(x, y);
      for (let s = 0; s < steps; s++) {
        const [vx, vy] = flow(x, y, W, H);
        x += vx * 3;
        y += vy * 3;
        c.lineTo(x, y);
      }
      c.stroke();
    };

    // 1. Fundo de pinceladas
    c.fillStyle = pal.base;
    c.fillRect(0, 0, W, H);
    const count = Math.round((W * H) / 70);
    for (let k = 0; k < count; k++) {
      const x = rnd() * W, y = rnd() * H;
      const sw = swirlWeight(x, y, W, H);
      const color = sw > 0.3 && rnd() < sw ? pick(pal.swirl) : pick(pal.strokes);
      stroke(x, y, 4 + Math.floor(rnd() * 6), 1.8 + rnd() * 2.4, color);
    }

    // 2. Halos das estrelas: anéis feitos de pinceladas curtas
    if (pal.halo) {
      STARS.forEach(([sx, sy, r]) => {
        const cx = sx * W, cy = sy * H, R = 0.032 * W * r + 6;
        for (let ring = 3; ring >= 0; ring--) {
          const rad = R * (0.45 + ring * 0.32);
          for (let a = rnd(); a < Math.PI * 2; a += 0.32) {
            c.strokeStyle = ring > 1 ? pick(pal.halo.slice(2)) : pick(pal.halo.slice(0, 4));
            c.lineWidth = 2 + rnd() * 1.6;
            c.beginPath();
            c.arc(cx, cy, rad, a, a + 0.24);
            c.stroke();
          }
        }
        c.fillStyle = '#fffbe0';
        c.beginPath();
        c.arc(cx, cy, R * 0.32, 0, Math.PI * 2);
        c.fill();
      });
    }

    // 3. Morros no horizonte
    const hillY = (x) => H * 0.82 + Math.sin((x / W) * 5) * H * 0.045 + Math.sin((x / W) * 13 + 1) * H * 0.02;
    c.save();
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 8) c.lineTo(x, hillY(x));
    c.lineTo(W, H);
    c.closePath();
    c.fillStyle = pal.hill[0];
    c.fill();
    c.clip();
    for (let k = 0; k < W / 2; k++) {
      const x = rnd() * W, y = hillY(x) + rnd() * H * 0.2;
      c.strokeStyle = pick(pal.hill);
      c.lineWidth = 2 + rnd() * 2;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 6, y - 2 + rnd() * 4, x + 12 + rnd() * 8, y + (rnd() - 0.5) * 3);
      c.stroke();
    }
    c.restore();

    // 4. Cipreste em forma de chama, à esquerda
    const cx = W * 0.065, base = Math.max(26, W * 0.055), top = H * 0.06;
    const half = (y) => {
      const t = (H - y) / (H - top); // 0 embaixo, 1 no topo
      return (base / 2) * Math.pow(1 - t, 0.75) * (0.85 + 0.15 * Math.sin(t * 22));
    };
    c.save();
    c.beginPath();
    c.moveTo(cx - base / 2, H);
    for (let y = H; y >= top; y -= 4) c.lineTo(cx - half(y) + Math.sin(y * 0.15) * 2, y);
    for (let y = top; y <= H; y += 4) c.lineTo(cx + half(y) + Math.sin(y * 0.11) * 2, y);
    c.closePath();
    c.fillStyle = pal.cypress[0];
    c.fill();
    c.clip();
    for (let k = 0; k < 220; k++) {
      const y = top + rnd() * (H - top), x = cx + (rnd() - 0.5) * half(y) * 2;
      c.strokeStyle = pick(pal.cypress);
      c.lineWidth = 1.6 + rnd() * 2;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + (rnd() - 0.5) * 10, y - 10, x + (rnd() - 0.5) * 6, y - 18 - rnd() * 10);
      c.stroke();
    }
    c.restore();
  }

  function paintSky() {
    paint(paintDay, PALETTES.day, 5);
    paint(paintNight, PALETTES.night, 11);
    const W = skyEl.clientWidth, H = skyEl.clientHeight;
    twinkles.innerHTML = STARS.map(([x, y, r], k) =>
      `<span class="twinkle" style="left:${x * 100}%;top:${y * 100}%;--r:${((0.032 * W * r + 6) * 0.9).toFixed(1)}px;animation-delay:${-k * 0.7}s"></span>`).join('');
    if (!H) return;
  }

  let paintTimer = null;
  let lastSkyW = 0;
  new ResizeObserver(() => {
    if (skyEl.clientWidth === lastSkyW) return;
    lastSkyW = skyEl.clientWidth;
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paintSky, 120);
  }).observe(skyEl);

  // ---------- Cores e posição do céu ----------
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  function mix(a, b, t) {
    const A = hex(a), B = hex(b);
    return 'rgb(' + A.map((v, k) => Math.round(v + (B[k] - v) * t)).join(',') + ')';
  }
  function sample(frames, t) {
    for (let k = 0; k < frames.length - 1; k++) {
      const [t0, ...a] = frames[k];
      const [t1, ...b] = frames[k + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0 || 1);
        return a.map((v, j) => (typeof v === 'number' ? v + (b[j] - v) * f : mix(v, b[j], f)));
      }
    }
    return frames[frames.length - 1].slice(1);
  }

  function phaseName() {
    const t = state.time;
    if (t >= DAY_PART) return 'Noite';
    if (t < 0.1) return 'Amanhecer';
    if (t < 0.3) return 'Manhã';
    if (t < 0.42) return 'Meio-dia';
    if (t < 0.6) return 'Tarde';
    return 'Pôr do sol';
  }

  // ---------- Desenhar tudo na tela ----------
  function render() {
    const t = state.time;
    const day = isDay();

    // Placar
    dayEl.textContent = state.day;
    fieldEl.textContent = state.plants.length;
    harvestEl.textContent = KINDS.reduce((sum, k) => sum + (state.harvested[k] || 0), 0);

    // Botões de semente, com quantas de cada flor já foram colhidas
    seedBar.querySelectorAll('[data-seed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.seed === state.seed));
      b.querySelector('.count').textContent = state.harvested[b.dataset.seed] || 0;
    });

    // Céu
    const [top, bottom] = sample(SKY, t);
    const [night] = sample(NIGHT, t);
    scene.style.setProperty('--sky-top', top);
    scene.style.setProperty('--sky-bottom', bottom);
    scene.style.setProperty('--night', night.toFixed(3));
    scene.classList.toggle('night', !day);
    clockEl.textContent = phaseName();

    const f = day ? t / DAY_PART : (t - DAY_PART) / (1 - DAY_PART);
    const body = day ? sunEl : moonEl;
    const size = day ? 44 : 40;
    const skyH = skyEl.clientHeight || 200;
    sunEl.hidden = !day;
    moonEl.hidden = day;
    body.style.left = `calc(${(f * 100).toFixed(2)}% - ${(f * size).toFixed(1)}px)`;
    body.style.top = `${((1 - Math.sin(Math.PI * f)) * (skyH * 0.55) + 18).toFixed(1)}px`;

    // Girassóis olham para o sol: leste (-28°) até oeste (+28°)
    garden.style.setProperty('--turn', (day ? -28 + 56 * f : -28).toFixed(1) + 'deg');

    // Ferramentas
    toolBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
      if (b.dataset.tool === 'sun') {
        b.disabled = !day;
        b.title = day ? '' : 'De noite não tem sol';
      }
    });
    if (!day && state.tool === 'sun') state.tool = 'water';

    garden.classList.toggle('tool-plant', state.tool === 'plant');
    if (state.tool !== 'plant') ghost.hidden = true;

    // Remove da tela as plantas que saíram do jogo
    const alive = new Set(state.plants.map((p) => p.id));
    plantEls.forEach((el, id) => {
      if (!alive.has(id)) { el.remove(); plantEls.delete(id); }
    });

    // Plantas
    state.plants.forEach((p) => {
      let el = plantEls.get(p.id);
      if (!el) { el = makePlantEl(p); if (p.progress === 0) el.classList.add('new'); }
      const stage = Math.floor(p.progress);
      const key = String(stage);
      if (el.dataset.key !== key) {
        el.querySelector('.art').innerHTML = drawPlant(p);
        el.dataset.key = key;
      }

      const ready = stage >= 4;
      const nome = kindOf(p).nome;
      const tag = ready ? nome : `${nome} · ${STAGES[stage]} ${Math.floor((p.progress % 1) * 100)}%`;
      el.querySelector('.tag').textContent = tag;
      el.classList.toggle('ready', ready);
      el.setAttribute('aria-label', ready ? `${nome} ${kindOf(p).um === 'um' ? 'aberto' : 'aberta'}` : tag);
    });
  }

  // ---------- Musiquinha de fundo (gerada no próprio navegador) ----------
  // Uma valsinha original em Fá maior, tocada com a Web Audio API.
  // Não usa arquivo de áudio nem serviço externo.
  const musicBtn = $('#music');
  const MUSIC_KEY = 'jardim-girassois-musica';

  // Acordes de cada compasso: [baixo, notas do acorde] em números MIDI (60 = Dó central)
  const CHORDS = [
    [41, [53, 57, 60]], // Fá
    [38, [50, 53, 57]], // Ré menor
    [46, [50, 53, 58]], // Si bemol
    [36, [48, 52, 55]], // Dó
  ];
  // Melodia: [compasso, tempo dentro do compasso, nota, duração em tempos] — valsa em 3 tempos
  const MELODY = [
    [0, 0, 69, 1], [0, 1, 72, 1], [0, 2, 77, 1],
    [1, 0, 76, 1.5], [1, 1.5, 74, 0.5], [1, 2, 69, 1],
    [2, 0, 74, 1], [2, 1, 72, 0.5], [2, 1.5, 70, 0.5], [2, 2, 74, 1],
    [3, 0, 72, 2],
    [4, 0, 69, 1], [4, 1, 72, 1], [4, 2, 81, 1],
    [5, 0, 77, 1], [5, 1, 76, 0.5], [5, 1.5, 74, 0.5], [5, 2, 77, 1],
    [6, 0, 74, 1], [6, 1, 70, 1], [6, 2, 67, 1],
    [7, 0, 76, 1], [7, 1, 74, 0.5], [7, 1.5, 72, 0.5], [7, 2, 67, 1],
  ];
  const BARS = 8;

  const music = {
    ctx: null, master: null, echo: null,
    on: true, playing: false, bar: 0, nextBar: 0, timer: null,
  };
  try { music.on = localStorage.getItem(MUSIC_KEY) !== 'off'; } catch (e) { /* padrão: ligada */ }

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function setupAudio() {
    if (music.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    // Eco suave para dar sensação de espaço
    const echo = ctx.createDelay();
    echo.delayTime.value = 0.32;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.35;
    echo.connect(feedback).connect(echo);
    echo.connect(echoOut).connect(master);
    Object.assign(music, { ctx, master, echo });
    return true;
  }

  // Uma nota: caixinha de música (melodia), sopro suave (acordes) ou baixo
  function note(midi, start, dur, kind) {
    const { ctx, master, echo } = music;
    const g = ctx.createGain();
    const o = ctx.createOscillator();
    o.frequency.value = hz(midi);
    let peak, attack, release;
    if (kind === 'bell') {
      o.type = 'sine'; peak = 0.22; attack = 0.01; release = Math.max(0.6, dur * 1.6);
      // um harmônico agudo bem baixinho deixa o som de caixinha de música
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = 'sine';
      o2.frequency.value = hz(midi) * 3;
      g2.gain.setValueAtTime(0.03, start);
      g2.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      o2.connect(g2).connect(master);
      o2.start(start);
      o2.stop(start + 0.6);
      g.connect(echo);
    } else if (kind === 'pad') {
      o.type = 'triangle'; peak = 0.045; attack = 0.35; release = dur;
      o.detune.value = (Math.random() - 0.5) * 10;
    } else {
      o.type = 'sine'; peak = 0.16; attack = 0.02; release = dur;
    }
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
    o.connect(g).connect(master);
    o.start(start);
    o.stop(start + attack + release + 0.05);
  }

  // À noite a música fica mais lenta e uma oitava mais grave
  function scheduleBar(bar, t) {
    const night = !isDay();
    const beat = 60 / (night ? 66 : 84);
    const shift = night ? -12 : 0;
    const [bass, chord] = CHORDS[bar % 4];
    note(bass, t, beat * 2.5, 'bass');
    chord.forEach((m) => note(m, t, beat * 3, 'pad'));
    MELODY.filter(([b]) => b === bar).forEach(([, at, m, d]) => note(m + shift, t + at * beat, d * beat, 'bell'));
    return beat * 3;
  }

  function tickMusic() {
    const { ctx } = music;
    while (music.nextBar < ctx.currentTime + 0.4) {
      music.nextBar += scheduleBar(music.bar, music.nextBar);
      music.bar = (music.bar + 1) % BARS;
    }
  }

  function startMusic() {
    if (music.playing || !setupAudio()) return;
    const { ctx, master } = music;
    ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.7, ctx.currentTime, 0.4);
    music.bar = 0;
    music.nextBar = ctx.currentTime + 0.1;
    music.playing = true;
    tickMusic();
    music.timer = setInterval(tickMusic, 100);
  }

  function stopMusic() {
    if (!music.playing) return;
    const { ctx, master } = music;
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    clearInterval(music.timer);
    music.playing = false;
    setTimeout(() => { if (!music.playing) ctx.suspend(); }, 800);
  }

  function renderMusicBtn() {
    musicBtn.setAttribute('aria-pressed', String(music.on));
    musicBtn.querySelector('span').textContent = music.on ? 'Música ligada' : 'Música desligada';
  }

  function toggleMusic() {
    music.on = !music.on;
    try { localStorage.setItem(MUSIC_KEY, music.on ? 'on' : 'off'); } catch (e) { /* sem salvamento */ }
    if (music.on) startMusic(); else stopMusic();
    renderMusicBtn();
  }

  musicBtn.addEventListener('click', toggleMusic);
  // O navegador só deixa tocar som depois que a pessoa interage com a página
  const firstTouch = (e) => {
    if (e.target.closest('#music')) return;
    document.removeEventListener('pointerdown', firstTouch);
    document.removeEventListener('keydown', firstTouch);
    if (music.on) startMusic();
  };
  document.addEventListener('pointerdown', firstTouch);
  document.addEventListener('keydown', firstTouch);
  renderMusicBtn();

  // ---------- Controles ----------
  // Monta os botões de escolher a semente
  seedBar.insertAdjacentHTML('beforeend', KINDS.map((k) =>
    `<button type="button" class="seed-btn" id="seed-${k}" data-seed="${k}" aria-pressed="false">` +
    `<span class="seed-icon">${flowerIcon(k)}</span><span class="seed-name">${FLOWERS[k].nome}</span>` +
    `<span class="count" title="Colhidas">0</span></button>`).join(''));
  seedBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seed]');
    if (!b) return;
    state.seed = b.dataset.seed;
    state.tool = 'plant';
    say(`Semente de ${FLOWERS[state.seed].nome.toLowerCase()} escolhida. Clique no campo para plantar.`);
    render();
    save();
  });

  toolBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') return toggleMusic();
    const n = Number(e.key);
    if (n >= 1 && n <= 4) {
      const tool = TOOLS[n - 1];
      if (tool === 'sun' && !isDay()) return say('É noite. Os girassóis descansam até amanhecer.');
      setTool(tool);
    }
  });

  // Recomeçar pede confirmação no próprio botão
  let resetTimer = null;
  resetBtn.addEventListener('click', () => {
    if (!resetBtn.classList.contains('confirm')) {
      resetBtn.classList.add('confirm');
      resetBtn.textContent = 'Apagar o jardim?';
      resetTimer = setTimeout(() => {
        resetBtn.classList.remove('confirm');
        resetBtn.textContent = 'Recomeçar';
      }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    resetBtn.classList.remove('confirm');
    resetBtn.textContent = 'Recomeçar';
    state = newGame();
    say('Jardim novo. Boa sorte!');
    render();
    save();
  });

  // ---------- Loop principal ----------
  let last = performance.now();
  let saveClock = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(1, (now - last) / 1000); // no máximo 1s por passo
    last = now;
    tick(dt);
    render();
    saveClock += dt;
    if (saveClock > 2) { save(); saveClock = 0; }
  }, 200);

  render();
})();
