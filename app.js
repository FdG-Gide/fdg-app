// ============================================================
// FdG PWA — app.js
// https://script.google.com/macros/s/AKfycby0U2F1mBS7SogjsHvAcvFwHZD2Ni3Nl8Hw_NIoVw0VStgwDqQ50YvKAj8MYjclfkgH/exec
// ============================================================


// ---- CONFIGURAÇÃO ----
// Substitua pela URL do seu Web App do Google Apps Script
const API_URL = 'https://script.google.com/macros/s/AKfycby0U2F1mBS7SogjsHvAcvFwHZD2Ni3Nl8Hw_NIoVw0VStgwDqQ50YvKAj8MYjclfkgH/exec';

// ---- ESTADO GLOBAL ----
const App = {
  token:   null,
  user:    null,
  mes:     new Date().getMonth() + 1,
  ano:     new Date().getFullYear(),
  dados:   null,   // { alocacoes, registros, diasFerias, encontros }
  diaSel:  null,   // data string 'yyyy-MM-dd' selecionada (último clicado)
  diasSel: new Set(), // todos os dias selecionados (multi)
  corMap:  {},     // idAlocacao -> cor (0-4)
  regEdit: null,   // registro em edição
  tab:     'agenda'
};

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MESES_ABR = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const DIAS_ABR  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const CORES = [
  { bg:'rgba(23,78,122,.1)',   cor:'#174e7a' },
  { bg:'rgba(67,221,133,.18)', cor:'#0d5c36' },
  { bg:'rgba(255,228,95,.35)', cor:'#6b5300' },
  { bg:'rgba(118,213,255,.3)', cor:'#0a4a6b' },
  { bg:'rgba(200,160,255,.3)', cor:'#4a1f7c' }
];
const DIA_LIMITE_EDICAO = 5;

// ---- UTILITÁRIOS ----

function api(path, opts = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('path', path);
  if (App.token) url.searchParams.set('token', App.token);

  // GAS não suporta CORS em POST com Content-Type: application/json.
  // Solução: tudo como GET com parâmetros na URL (HTTPS protege o tráfego).
  // Para operações com "body", serializa os campos como query params.
  if (opts.params) {
    Object.entries(opts.params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  if (opts.body) {
    Object.entries(opts.body).forEach(([k, v]) => {
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
    });
  }

  return fetch(url.toString(), { redirect: 'follow' })
    .then(r => r.json())
    .then(r => { if (!r.ok) throw new Error(r.error || 'Erro desconhecido'); return r.data; });
}

function dataStr(dt) {
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${m}-${d}`;
}

function parseDateLocal(s) {
  // Evita bug de fuso: 'yyyy-MM-dd' como data local
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function fmtDataBr(s) {
  const dt = parseDateLocal(s);
  return `${DIAS_ABR[dt.getDay()]}, ${dt.getDate()} ${MESES_ABR[dt.getMonth()]}`;
}

function fmtDiaMes(s) {
  const dt = parseDateLocal(s);
  return `${dt.getDate()} ${MESES_ABR[dt.getMonth()]}`;
}

function mesAindaEditavel(dateStr) {
  if (App.user && (App.user.papel === 'Diretor(a)' || App.user.nivel === 'Diretora Técnica')) return true;
  const dt    = parseDateLocal(dateStr);
  const hoje  = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;
  const diaAtual = hoje.getDate();

  // Mês futuro — nunca pode cadastrar
  if (dt.getFullYear() > anoAtual || (dt.getFullYear() === anoAtual && dt.getMonth() + 1 > mesAtual)) return false;

  // Mês atual — pode sempre
  if (dt.getFullYear() === anoAtual && dt.getMonth() + 1 === mesAtual) return true;

  // Mês anterior — só pode se ainda estiver nos primeiros DIA_LIMITE_EDICAO dias do mês atual
  // E apenas o mês imediatamente anterior
  const mesAnterior = mesAtual === 1 ? 12 : mesAtual - 1;
  const anoAnterior = mesAtual === 1 ? anoAtual - 1 : anoAtual;
  const ehMesAnterior = dt.getFullYear() === anoAnterior && dt.getMonth() + 1 === mesAnterior;
  if (ehMesAnterior && diaAtual <= DIA_LIMITE_EDICAO) return true;

  return false;
}

let toastTimer;
function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'vis' + (tipo ? ' ' + tipo : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2800);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleSenha() {
  const inp  = document.getElementById('senha');
  const aberto  = document.getElementById('olho-aberto');
  const fechado = document.getElementById('olho-fechado');
  if (inp.type === 'password') {
    inp.type = 'text';
    aberto.style.display  = 'none';
    fechado.style.display = '';
  } else {
    inp.type = 'password';
    aberto.style.display  = '';
    fechado.style.display = 'none';
  }
}

// ---- SESSÃO ----

function salvarSessao(token, user, lembrar) {
  App.token = token; App.user = user;
  // Se "lembrar", usa localStorage (persiste). Se não, sessionStorage (some ao fechar).
  const store = lembrar ? localStorage : sessionStorage;
  store.setItem('fdg_token', token);
  store.setItem('fdg_user', JSON.stringify(user));
  // Salva ou limpa credenciais conforme checkbox
  if (lembrar) {
    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;
    localStorage.setItem('fdg_email', email);
    localStorage.setItem('fdg_senha', senha);
  } else {
    localStorage.removeItem('fdg_email');
    localStorage.removeItem('fdg_senha');
  }
}

function carregarSessao() {
  // Tenta localStorage primeiro, depois sessionStorage
  App.token = localStorage.getItem('fdg_token') || sessionStorage.getItem('fdg_token');
  try {
    const raw = localStorage.getItem('fdg_user') || sessionStorage.getItem('fdg_user');
    App.user = raw ? JSON.parse(raw) : null;
  } catch(_) {}
}

function preencherCamposLogin() {
  // Preenche email/senha salvos se "lembrar" estava marcado
  const email = localStorage.getItem('fdg_email');
  const senha = localStorage.getItem('fdg_senha');
  if (email) {
    document.getElementById('email').value = email;
    document.getElementById('lembrar').checked = true;
  }
  if (senha) {
    document.getElementById('senha').value = senha;
  }
}

function limparSessao() {
  App.token = App.user = null;
  localStorage.removeItem('fdg_token');
  localStorage.removeItem('fdg_user');
  sessionStorage.removeItem('fdg_token');
  sessionStorage.removeItem('fdg_user');
  // Mantém email/senha para facilitar novo login (se estavam salvos, continuam)
}

// ---- LOGIN ----

function renderLogin() {
  document.getElementById('tela-login').style.display = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('email').value = '';
  document.getElementById('senha').value = '';
  document.getElementById('login-erro').textContent = '';
  // Garante que o botão volta ao estado normal após logout
  const btn = document.getElementById('btn-login');
  btn.disabled = false;
  btn.innerHTML = 'Entrar';
}

async function fazerLogin() {
  const email   = document.getElementById('email').value.trim();
  const senha   = document.getElementById('senha').value;
  const lembrar = document.getElementById('lembrar')?.checked !== false;
  const btn     = document.getElementById('btn-login');
  const erro    = document.getElementById('login-erro');
  erro.textContent = '';

  if (!email || !senha) { erro.textContent = 'Preencha email e senha.'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-btn"></span> Entrando…';

  try {
    const res = await api('login', { body: { email, senha } });
    salvarSessao(res.token, res.user, lembrar);
    iniciarApp();
  } catch (e) {
    erro.textContent = e.message;
    btn.disabled = false;
    btn.innerHTML = 'Entrar';
  }
}

// ---- APP PRINCIPAL ----

function iniciarApp() {
  document.getElementById('tela-login').style.display = 'none';
  const appEl = document.getElementById('app');
  appEl.style.display = 'flex';

  // Topbar
  const u = App.user;
  document.getElementById('avatar').textContent =
    u.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('topbar-nome').textContent = u.nome.split(' ')[0];

  atualizarLabels();
  mudarTab('agenda');
}

function atualizarLabels() {
  document.getElementById('mes-label').textContent = MESES[App.mes - 1] + ' ' + App.ano;
}

function navMes(dir) {
  App.mes += dir;
  if (App.mes > 12) { App.mes = 1; App.ano++; }
  if (App.mes < 1)  { App.mes = 12; App.ano--; }
  App.dados = null; App.diaSel = null; App.diasSel = new Set();
  atualizarLabels();
  if (App.tab === 'agenda') {
    carregarMes().then(function(d) { if (d) renderAgenda(); });
  }
  if (App.tab === 'registros') {
    carregarMes().then(function(d) { if (d) renderRegistros(); });
  }
}

// ---- CARREGAR DADOS ----

async function carregarMes() {
  const main = document.getElementById('main');
  if (!App.dados) {
    main.innerHTML = '<div class="loading-overlay"><div class="spin"></div></div>';
    try {
      App.dados = await api('mes', { params: { mes: App.mes, ano: App.ano } });
      atribuirCores();
    } catch (e) {
      main.innerHTML = `<div class="ev-vazio"><div class="icon">⚠️</div>${esc(e.message)}</div>`;
      return;
    }
  }
  return App.dados;
}

function atribuirCores() {
  let idx = 0;
  App.corMap = {};
  (App.dados.alocacoes || []).forEach(a => {
    if (App.corMap[a.id] === undefined) {
      App.corMap[a.id] = idx % CORES.length;
      idx++;
    }
  });
}

// ---- TAB AGENDA ----

async function mudarTab(tab) {
  App.tab = tab;
  App.diasSel = new Set();
  App.diaSel  = null;
  atualizarFabBadge();
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
  document.getElementById('tab-' + tab).classList.add('ativo');
  document.getElementById('fab').className = tab === 'agenda' ? '' : 'oculto';

  if (tab === 'agenda') {
    const d = await carregarMes();
    if (d) renderAgenda();
  }
  if (tab === 'registros') {
    const d = await carregarMes();
    if (d) renderRegistros();
  }
  if (tab === 'perfil') renderPerfil();
}

function renderAgenda() {
  const main = document.getElementById('main');
  main.innerHTML = '';

  // Cards de projetos
  const alocacoes = App.dados.alocacoes || [];
  if (alocacoes.length) {
    const labelEl = document.createElement('div');
    labelEl.className = 'section-label';
    labelEl.textContent = 'Projetos do mês';
    main.appendChild(labelEl);

    const scrollEl = document.createElement('div');
    scrollEl.className = 'cards-scroll';
    alocacoes.forEach(a => {
      const cor = CORES[App.corMap[a.id] || 0];
      const horasReg = (App.dados.registros || [])
        .filter(r => r.idAlocacao == a.id)
        .reduce((s, r) => s + r.horas, 0);
      const diasReg = (horasReg / 8).toFixed(1).replace('.0', '');

      const card = document.createElement('div');
      card.className = 'proj-card';
      card.style.borderTop = `3px solid ${cor.cor}`;
      card.innerHTML = `
        <div class="nome">${esc(a.nomeProjeto)}</div>
        <div class="empresa">${esc(a.nomeEmpresa || '')}</div>
        <div class="stats">
          <span class="pill azul">${a.diasAlocados}d aloc</span>
          <span class="pill verde">${diasReg}d reg</span>
        </div>`;
      scrollEl.appendChild(card);
    });
    main.appendChild(scrollEl);
  }

  // Calendário
  const calWrap = document.createElement('div');
  calWrap.id = 'cal-wrap';
  calWrap.innerHTML = `
    <div class="cal-head">
      <span class="fds">D</span><span>S</span><span>T</span><span>Q</span>
      <span>Q</span><span>S</span><span class="fds">S</span>
    </div>
    <div class="cal-grid" id="cal-grid"></div>`;
  main.appendChild(calWrap);

  renderCalendario();

  const sep = document.createElement('div');
  sep.className = 'sep';
  main.appendChild(sep);

  const evWrap = document.createElement('div');
  evWrap.id = 'ev-wrap';
  main.appendChild(evWrap);

  // Não pré-seleciona nenhum dia — usuário escolhe explicitamente
  selecionarDia(null);
}

function renderCalendario() {
  const grid    = document.getElementById('cal-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const hoje    = new Date();
  const mes     = App.mes;
  const ano     = App.ano;
  const feriados = getFeriadosBR(ano);

  // Mapas rápidos
  const regMap  = {};
  (App.dados.registros || []).forEach(r => {
    if (!regMap[r.data]) regMap[r.data] = [];
    regMap[r.data].push(r);
  });
  const feriasSet = new Set((App.dados.diasFerias || []).map(f => f.data));
  const encMap  = {};
  (App.dados.encontros || []).forEach(e => {
    if (!encMap[e.data]) encMap[e.data] = [];
    encMap[e.data].push(e);
  });

  const primeiroDia = new Date(ano, mes - 1, 1);
  const ultimoDia   = new Date(ano, mes, 0).getDate();
  let diaAtual = 1 - primeiroDia.getDay();

  for (let sem = 0; sem < 6; sem++) {
    if (diaAtual > ultimoDia) break;
    for (let dow = 0; dow < 7; dow++) {
      const cel = document.createElement('div');
      cel.className = 'cel';

      const dtObj  = new Date(ano, mes - 1, diaAtual);
      const dStr   = dataStr(dtObj);
      const mmdd   = dStr.substring(5);
      const outro  = diaAtual < 1 || diaAtual > ultimoDia;
      const fds    = dow === 0 || dow === 6;
      const ferias = !outro && feriasSet.has(dStr);
      const feriado = !outro && !ferias && !!feriados[mmdd];
      const foraPrazo = !outro && !fds && !feriado && !ferias && !mesAindaEditavel(dStr);
      const bloqueado = outro || fds || feriado || ferias || foraPrazo;
      const ehHoje = !outro && diaAtual === hoje.getDate() &&
                    mes === hoje.getMonth() + 1 && ano === hoje.getFullYear();
      const sel    = App.diaSel === dStr && !outro;

      if (outro) cel.classList.add('outro');
      if (fds)   cel.classList.add('fds');
      if (ferias) cel.classList.add('ferias');
      if (feriado) cel.classList.add('feriado');
      if (foraPrazo) cel.classList.add('fora-prazo');
      if (ehHoje) cel.classList.add('hoje');
      if (sel)   cel.classList.add('sel');

      const numEl = document.createElement('div');
      numEl.className = 'num';
      numEl.textContent = outro ? '' : diaAtual;
      cel.appendChild(numEl);

      if (ferias) {
        const lb = document.createElement('div');
        lb.className = 'ferias-cel-label';
        lb.textContent = '🏝️';
        cel.appendChild(lb);
      }
      if (feriado) {
        const lb = document.createElement('div');
        lb.className = 'ferias-cel-label';
        lb.textContent = '🎉';
        cel.title = feriados[mmdd];
        cel.appendChild(lb);
      }

      // Pontos de registros
      if (!outro && !ferias) {
        const regs = regMap[dStr] || [];
        const encs = encMap[dStr] || [];
        if (regs.length || encs.length) {
          const ptWrap = document.createElement('div');
          ptWrap.className = 'pontos';
          regs.slice(0, 3).forEach(r => {
            const pt = document.createElement('div');
            pt.className = 'pt';
            pt.style.background = CORES[App.corMap[r.idAlocacao] || 0].cor;
            ptWrap.appendChild(pt);
          });
          encs.forEach(e => {
            const pt = document.createElement('div');
            pt.className = 'pt';
            pt.style.background = e.tipo === 'presencial' ? '#174e7a' : '#43dd85';
            ptWrap.appendChild(pt);
          });
          cel.appendChild(ptWrap);
        }
      }

      // Clique — só dias úteis não bloqueados permitem seleção/registro
      if (!outro && !bloqueado) {
        cel.addEventListener('click', () => selecionarDia(dStr));
      } else if (!outro && ferias) {
        // Férias: permite ver o evento mas não registrar
        cel.addEventListener('click', () => selecionarDia(dStr));
      } else if (!outro && (fds || feriado)) {
        // FDS/Feriado: toque mostra toast explicativo
        cel.addEventListener('click', () => {
          const motivo = feriado ? `Feriado: ${feriados[dStr.substring(5)]}` : 'Fins de semana não permitem registro';
          toast(motivo, 'erro');
        });
      }

      grid.appendChild(cel);
      diaAtual++;
    }
  }
}

function atualizarFabBadge() {
  const fab = document.getElementById('fab');
  if (!fab) return;
  let badge = document.getElementById('fab-badge');
  const n = App.diasSel.size;
  if (n > 1) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'fab-badge';
      fab.appendChild(badge);
    }
    badge.textContent = n;
  } else {
    if (badge) badge.remove();
  }
}

function selecionarDia(dStr) {
  if (dStr === null) {
    App.diaSel = null;
    App.diasSel = new Set();
    atualizarFabBadge();
    atualizarCelsSel();
    renderEventosDia(null);
    return;
  }

  // Verifica se o dia é elegível para seleção/registro
  const dt   = parseDateLocal(dStr);
  const dow  = dt.getDay();
  const mmdd = dStr.substring(5);
  const feriados = getFeriadosBR(dt.getFullYear());
  const feriasSet = new Set((App.dados?.diasFerias || []).map(f => f.data));
  const ehFds      = dow === 0 || dow === 6;
  const ehFeriado  = !!feriados[mmdd];
  const ehFerias   = feriasSet.has(dStr);
  const foraPrazo  = !mesAindaEditavel(dStr);

  if (ehFds || ehFeriado || foraPrazo) {
    // Dia inválido para registro — apenas mostra eventos, não seleciona para lote
    App.diaSel = dStr;
    renderEventosDia(dStr);
    return;
  }

  // Toggle: se já está selecionado, deseleciona; senão adiciona
  if (App.diasSel.has(dStr)) {
    App.diasSel.delete(dStr);
    App.diaSel = App.diasSel.size > 0 ? [...App.diasSel].at(-1) : null;
  } else {
    App.diasSel.add(dStr);
    App.diaSel = dStr;
  }

  atualizarFabBadge();
  atualizarCelsSel();
  renderEventosDia(App.diaSel);
}

function atualizarCelsSel() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  const mes = App.mes; const ano = App.ano;
  grid.querySelectorAll('.cel').forEach(cel => {
    cel.classList.remove('sel', 'sel-multi');
    const num = parseInt(cel.querySelector('.num')?.textContent);
    if (!isNaN(num) && num > 0) {
      const dStr = dataStr(new Date(ano, mes - 1, num));
      if (App.diasSel.has(dStr)) {
        cel.classList.add(App.diasSel.size > 1 ? 'sel-multi' : 'sel');
      }
    }
  });
}

function renderEventosDia(dStr) {
  const wrap = document.getElementById('ev-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const feriasSet = new Set((App.dados.diasFerias || []).map(f => f.data));
  const feriasInfo = (App.dados.diasFerias || []).find(f => f.data === dStr);
  const regs  = (App.dados.registros  || []).filter(r => r.data === dStr);
  const encs  = (App.dados.encontros  || []).filter(e => e.data === dStr);

  if (!dStr) {
    wrap.innerHTML = '<div class="ev-vazio"><div class="icon">📅</div>Toque em um dia para ver os registros</div>';
    return;
  }

  const dt = parseDateLocal(dStr);
  const titulo = document.createElement('div');
  titulo.className = 'ev-dia-titulo';
  titulo.textContent = fmtDataBr(dStr);
  wrap.appendChild(titulo);

  // Férias
  if (feriasSet.has(dStr)) {
    const item = document.createElement('div');
    item.className = 'ev-item ev-ferias';
    item.innerHTML = `
      <div class="ev-cor" style="background:#c7c7cc"></div>
      <div class="ev-info">
        <div class="ev-nome">🏝️ Férias</div>
        <div class="ev-sub">${esc(feriasInfo?.observacao || 'Cadastrado pelo Admin')}</div>
      </div>`;
    wrap.appendChild(item);
    return;
  }

  // Encontros
  encs.forEach(enc => {
    const item = document.createElement('div');
    item.className = 'ev-item' + (enc.tipo === 'online' ? ' ev-enc-online' : '');
    const icone = enc.tipo === 'presencial' ? '✈️' : '💻';
    const nome  = enc.tipo === 'presencial' ? 'Encontro Presencial' : 'Encontro Online';
    const badge = enc.tipo === 'presencial'
      ? `<span class="ev-badge" style="background:rgba(23,78,122,.1);color:#174e7a">${enc.horas}h</span>` : '';
    item.innerHTML = `
      <div class="ev-cor" style="background:${enc.tipo === 'presencial' ? '#174e7a' : '#43dd85'}"></div>
      <div class="ev-info">
        <div class="ev-nome">${icone} ${nome}</div>
        <div class="ev-sub">Cadastrado pelo Admin</div>
      </div>${badge}`;
    wrap.appendChild(item);
  });

  // Registros
  const foraPrazo = !mesAindaEditavel(dStr);
  regs.forEach(reg => {
    const c = CORES[App.corMap[reg.idAlocacao] || 0];
    const icone = reg.modo === 'Remoto' ? '🏠' : '✈️';
    const item = document.createElement('div');
    item.className = 'ev-item';
    item.innerHTML = `
      <div class="ev-cor" style="background:${c.cor}"></div>
      <div class="ev-info">
        <div class="ev-nome">${esc(reg.nomeProjeto)}</div>
        <div class="ev-sub">${icone} ${reg.modo || 'Presencial'}</div>
      </div>
      <span class="ev-badge" style="background:${c.bg};color:${c.cor}">${reg.horas}h</span>`;

    if (!foraPrazo) {
      item.addEventListener('click', () => abrirModalEditar(reg));
    } else {
      item.style.opacity = '.6';
      item.title = 'Prazo de edição expirado';
    }
    wrap.appendChild(item);
  });

  // Vazio
  if (!regs.length && !encs.length && !feriasSet.has(dStr)) {
    const vazio = document.createElement('div');
    vazio.className = 'ev-vazio';
    const foraPrazo2 = !mesAindaEditavel(dStr);
    vazio.innerHTML = foraPrazo2
      ? '<div class="icon">🔒</div>Prazo de edição expirado'
      : '<div class="icon">📝</div>Nenhum registro neste dia.<br><small>Toque + para registrar</small>';
    wrap.appendChild(vazio);
  }
}

// ---- FAB / MODAL REGISTRO ----

function abrirModalRegistro() {
  const dias = App.diasSel.size > 0 ? [...App.diasSel].sort() : [dataStr(new Date())];
  const alocacoes = App.dados?.alocacoes || [];
  const feriasSet = new Set((App.dados.diasFerias || []).map(f => f.data));

  if (!alocacoes.length) { toast('Sem projetos alocados neste mês.', 'erro'); return; }

  const feriados = getFeriadosBR(new Date().getFullYear());
  const diasElegiveis = dias.filter(d => {
    const dt = parseDateLocal(d);
    const dow = dt.getDay();
    const mmdd = d.substring(5);
    return mesAindaEditavel(d) && !feriasSet.has(d) && dow !== 0 && dow !== 6 && !feriados[mmdd];
  });
  if (!diasElegiveis.length) { toast('Nenhum dia selecionado permite registro.', 'erro'); return; }

  // Horas: usa o máximo disponível entre os dias elegíveis
  const isDiretor = App.user.papel === 'Diretor(a)' || App.user.nivel === 'Diretora Técnica';
  const maxDisponivel = Math.max(...diasElegiveis.map(d => {
    const horasEnc = (App.dados.encontros || [])
      .filter(e => e.data === d && e.tipo === 'presencial')
      .reduce((s, e) => s + e.horas, 0);
    const horasJaReg = (App.dados.registros || [])
      .filter(r => r.data === d)
      .reduce((s, r) => s + r.horas, 0);
    return Math.max(0, 8 - horasEnc - horasJaReg);
  }));

  if (maxDisponivel <= 0) { toast('Sem horas disponíveis nos dias selecionados.', 'erro'); return; }

  const horasOpts = [8, 4, 2, 1]
    .filter(h => h <= maxDisponivel && (isDiretor || h >= 4))
    .map(h => `<option value="${h}">${h} hora${h > 1 ? 's' : ''}</option>`)
    .join('');

  if (!horasOpts) { toast('Sem horas disponíveis nos dias selecionados.', 'erro'); return; }

  const opts = alocacoes.map(a =>
    `<option value="${esc(a.id)}">${esc(a.nomeProjeto)}</option>`).join('');

  const titulo = dias.length === 1
    ? 'Registrar — ' + fmtDataBr(dias[0])
    : `Registrar — ${diasElegiveis.length} dia${diasElegiveis.length > 1 ? 's' : ''}`;

  document.getElementById('modal-titulo').textContent = titulo;
  document.getElementById('modal-corpo').innerHTML = `
    <div class="campo">
      <label>Projeto</label>
      <select id="m-projeto">${opts}</select>
    </div>
    <div class="campo">
      <label>Horas</label>
      <select id="m-horas">${horasOpts}</select>
    </div>
    <div class="campo">
      <label>Modo</label>
      <div class="toggle-modo">
        <button class="btn-modo ativo" id="btn-presencial" onclick="setModo('Presencial')">✈️ Presencial</button>
        <button class="btn-modo" id="btn-remoto" onclick="setModo('Remoto')">🏠 Remoto</button>
      </div>
      <input type="hidden" id="m-modo" value="Presencial">
    </div>
    <div class="modal-erro" id="m-erro"></div>
    <button class="btn-confirmar" onclick="confirmarRegistro()">Registrar</button>`;
  document.getElementById('modal-overlay').classList.remove('oculto');
}

function setModo(modo) {
  document.getElementById('m-modo').value = modo;
  document.getElementById('btn-presencial').className = 'btn-modo' + (modo === 'Presencial' ? ' ativo' : '');
  document.getElementById('btn-remoto').className     = 'btn-modo' + (modo === 'Remoto'     ? ' ativo' : '');
}

async function confirmarRegistro() {
  const idAloc  = document.getElementById('m-projeto').value;
  const horasSol = parseInt(document.getElementById('m-horas').value);
  const modo    = document.getElementById('m-modo').value;
  const erroEl  = document.getElementById('m-erro');
  const btn     = document.querySelector('#modal-corpo .btn-confirmar');
  const feriasSet = new Set((App.dados.diasFerias || []).map(f => f.data));

  erroEl.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-btn"></span> Salvando…';

  const dias = App.diasSel.size > 0 ? [...App.diasSel].sort() : [App.diaSel || dataStr(new Date())];

  // Monta payload ajustando horas disponíveis por dia
  const payload = [];
  const resumo  = { ok: [], parcial: [], pulado: [] };

  const feriados = getFeriadosBR(new Date().getFullYear());

  for (const d of dias) {
    const dt  = parseDateLocal(d);
    const dow = dt.getDay();
    const mmdd = d.substring(5);
    if (dow === 0 || dow === 6) {
      resumo.pulado.push({ d, motivo: 'fim de semana' });
      continue;
    }
    if (feriados[mmdd]) {
      resumo.pulado.push({ d, motivo: `feriado: ${feriados[mmdd]}` });
      continue;
    }
    if (!mesAindaEditavel(d) || feriasSet.has(d)) {
      resumo.pulado.push({ d, motivo: feriasSet.has(d) ? 'dia de férias' : 'prazo expirado' });
      continue;
    }
    const horasEnc = (App.dados.encontros || [])
      .filter(e => e.data === d && e.tipo === 'presencial')
      .reduce((s, e) => s + e.horas, 0);
    const horasJaReg = (App.dados.registros || [])
      .filter(r => r.data === d)
      .reduce((s, r) => s + r.horas, 0);
    const disponivel = 8 - horasEnc - horasJaReg;

    if (disponivel <= 0) {
      resumo.pulado.push({ d, motivo: 'já tem 8h cadastradas' });
      continue;
    }
    const horasReal = Math.min(horasSol, disponivel);
    payload.push({ idAlocacao: idAloc, data: d, horas: horasReal, modo });
    if (horasReal < horasSol) {
      resumo.parcial.push({ d, horasReal, disponivel });
    } else {
      resumo.ok.push(d);
    }
  }

  if (!payload.length) {
    erroEl.textContent = 'Nenhum dia disponível para registrar.';
    btn.disabled = false;
    btn.innerHTML = 'Registrar';
    return;
  }

  try {
    await api('registros/salvar', { body: { payload: JSON.stringify(payload) } });
    fecharModal();
    App.dados = null;
    App.diasSel = new Set();
    App.diaSel  = null;
    atualizarFabBadge();
    const d = await carregarMes();
    if (d) renderAgenda();

    // Exibe resumo se houver dias pulados ou parciais
    const totalDias = dias.length;
    if (totalDias === 1) {
      toast('Registro salvo!', 'ok');
      setTimeout(() => selecionarDia(payload[0].data), 100);
    } else {
      exibirResumoLote(resumo, payload);
    }
  } catch (e) {
    erroEl.textContent = e.message;
    btn.disabled = false;
    btn.innerHTML = 'Registrar';
  }
}

function exibirResumoLote(resumo, payload) {
  // Monta modal de resumo
  document.getElementById('modal-titulo').textContent = 'Resumo do registro';
  let html = '<div class="lote-resumo">';

  if (resumo.ok.length) {
    html += `<div class="lote-resumo-item">
      <span class="lote-icone">✅</span>
      <div class="lote-texto">${resumo.ok.length} dia${resumo.ok.length > 1 ? 's' : ''} registrado${resumo.ok.length > 1 ? 's' : ''} com sucesso</div>
    </div>`;
  }
  resumo.parcial.forEach(({ d, horasReal, disponivel }) => {
    html += `<div class="lote-resumo-item">
      <span class="lote-icone">⚠️</span>
      <div class="lote-texto">
        <strong>${fmtDiaMes(d)}</strong> — registrado ${horasReal}h
        <div class="lote-motivo">só havia ${disponivel}h disponível${disponivel > 1 ? 'is' : ''} neste dia</div>
      </div>
    </div>`;
  });
  resumo.pulado.forEach(({ d, motivo }) => {
    html += `<div class="lote-resumo-item">
      <span class="lote-icone">❌</span>
      <div class="lote-texto">
        <strong>${fmtDiaMes(d)}</strong> — não registrado
        <div class="lote-motivo">${motivo}</div>
      </div>
    </div>`;
  });

  html += '</div><button class="btn-confirmar" style="margin-top:16px" onclick="fecharModal()">OK</button>';
  document.getElementById('modal-corpo').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('oculto');
}

// ---- MODAL EDITAR ----

function abrirModalEditar(reg) {
  App.regEdit = reg;
  const isDiretor = App.user.papel === 'Diretor(a)' || App.user.nivel === 'Diretora Técnica';
  const horasOpts = [8, 4, 2, 1]
    .filter(h => isDiretor || h >= 4)
    .map(h => `<option value="${h}" ${reg.horas == h ? 'selected' : ''}>${h} hora${h > 1 ? 's' : ''}</option>`)
    .join('');

  document.getElementById('modal-titulo').textContent = esc(reg.nomeProjeto) + ' — ' + fmtDataBr(reg.data);
  document.getElementById('modal-corpo').innerHTML = `
    <div class="campo">
      <label>Horas</label>
      <select id="m-horas">${horasOpts}</select>
    </div>
    <div class="campo">
      <label>Modo</label>
      <div class="toggle-modo">
        <button class="btn-modo${reg.modo !== 'Remoto' ? ' ativo' : ''}" id="btn-presencial" onclick="setModo('Presencial')">✈️ Presencial</button>
        <button class="btn-modo${reg.modo === 'Remoto' ? ' ativo' : ''}" id="btn-remoto" onclick="setModo('Remoto')">🏠 Remoto</button>
      </div>
      <input type="hidden" id="m-modo" value="${reg.modo || 'Presencial'}">
    </div>
    <div class="modal-erro" id="m-erro"></div>
    <button class="btn-confirmar" onclick="salvarEdicao()">Salvar alteração</button>
    <button class="btn-perigo" onclick="confirmarExcluir()">Excluir registro</button>`;
  document.getElementById('modal-overlay').classList.remove('oculto');
}

async function salvarEdicao() {
  const reg    = App.regEdit;
  const horas  = parseInt(document.getElementById('m-horas').value);
  const modo   = document.getElementById('m-modo').value;
  const erroEl = document.getElementById('m-erro');
  const btn    = document.querySelector('#modal-corpo .btn-confirmar');
  erroEl.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-btn"></span> Salvando…';

  try {
    await api('registros/editar', { body: { idRegistro: reg.id, horas, modo } });
    fecharModal();
    App.dados = null;
    const d = await carregarMes();
    if (d) renderAgenda();
    toast('Registro atualizado!', 'ok');
    setTimeout(() => selecionarDia(reg.data), 100);
  } catch (e) {
    erroEl.textContent = e.message;
    btn.disabled = false;
    btn.innerHTML = 'Salvar alteração';
  }
}

async function confirmarExcluir() {
  if (!confirm('Excluir este registro?')) return;
  const reg  = App.regEdit;
  const btn  = document.querySelector('#modal-corpo .btn-perigo');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-btn"></span> Excluindo…';

  try {
    await api('registros/excluir', { body: { idRegistro: reg.id } });
    fecharModal();
    App.dados = null;
    const d = await carregarMes();
    if (d) renderAgenda();
    toast('Registro excluído.', '');
    setTimeout(() => selecionarDia(reg.data), 100);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = 'Excluir registro';
    toast(e.message, 'erro');
  }
}

function fecharModal() {
  document.getElementById('modal-overlay').classList.add('oculto');
  App.regEdit = null;
}

// ---- ABA REGISTROS ----

function renderRegistros() {
  const main = document.getElementById('main');
  main.innerHTML = '';

  const todos = [
    ...(App.dados.registros  || []).map(r => ({ tipo: 'reg', ...r })),
    ...(App.dados.encontros  || []).map(e => ({ ...e, tipo: 'encontro', tipoEnc: e.tipo })),
    ...(App.dados.diasFerias || []).map(f => ({ tipo: 'ferias', data: f.data, obs: f.observacao }))
  ].sort((a, b) => a.data.localeCompare(b.data));

  if (!todos.length) {
    main.innerHTML = '<div class="ev-vazio" style="padding-top:80px"><div class="icon">📋</div>Nenhum registro este mês</div>';
    return;
  }

  todos.forEach(item => {
    const el = document.createElement('div');
    const dt = parseDateLocal(item.data);
    const diaNum  = dt.getDate();
    const diaAbr  = MESES_ABR[dt.getMonth()];

    if (item.tipo === 'ferias') {
      el.className = 'reg-item reg-ferias';
      el.innerHTML = `
        <div class="reg-data"><span class="dia-num">${diaNum}</span>${diaAbr}</div>
        <div class="reg-info">
          <div class="reg-nome">🏝️ Férias</div>
          <div class="reg-sub">${esc(item.obs || 'Cadastrado pelo Admin')}</div>
        </div>`;
    } else if (item.tipo === 'encontro') {
      const ePresencial = item.tipoEnc === 'presencial';
      const icone     = ePresencial ? '✈️' : '💻';
      const tipoLabel = ePresencial ? 'Encontro Presencial' : 'Encontro Online';
      const corFundo  = ePresencial ? 'rgba(23,78,122,.1)' : 'rgba(67,221,133,.18)';
      const corTexto  = ePresencial ? '#174e7a' : '#0d5c36';
      el.className = 'reg-item';
      el.innerHTML = `
        <div class="reg-data"><span class="dia-num">${diaNum}</span>${diaAbr}</div>
        <div class="reg-info">
          <div class="reg-nome">${tipoLabel}</div>
          <div class="reg-sub">${icone} Cadastrado pelo Admin</div>
        </div>
        ${item.horas ? `<span class="reg-badge" style="background:${corFundo};color:${corTexto}">${item.horas}h</span>` : ''}`;
    } else {
      const c = CORES[App.corMap[item.idAlocacao] || 0];
      const icone = item.modo === 'Remoto' ? '🏠' : '✈️';
      const foraPrazo = !mesAindaEditavel(item.data);
      el.className = 'reg-item';
      el.innerHTML = `
        <div class="reg-data"><span class="dia-num">${diaNum}</span>${diaAbr}</div>
        <div class="reg-info">
          <div class="reg-nome">${esc(item.nomeProjeto)}</div>
          <div class="reg-sub">${icone} ${item.modo || 'Presencial'}</div>
        </div>
        <span class="reg-badge" style="background:${c.bg};color:${c.cor}">${item.horas}h</span>`;
      if (!foraPrazo) el.addEventListener('click', () => abrirModalEditar(item));
      else el.style.opacity = '.6';
    }
    main.appendChild(el);
  });
}

// ---- ABA PERFIL ----

function renderPerfil() {
  const u = App.user;
  const main = document.getElementById('main');
  const ini  = u.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  main.innerHTML = `
    <div class="perfil-card">
      <div class="perfil-avatar">${ini}</div>
      <div class="perfil-nome">${esc(u.nome)}</div>
      <div class="perfil-nivel">${esc(u.nivel)}</div>
      <div class="perfil-papel"><span>${esc(u.papel || 'Consultor')}</span></div>
    </div>
    <div style="padding:0 16px;font-size:12px;color:#8e8e93;margin-bottom:12px">
      ${esc(u.email)}
    </div>`;

  const btnSair = document.createElement('button');
  btnSair.className = 'btn-sair';
  btnSair.textContent = 'Sair';
  btnSair.onclick = sair;
  main.appendChild(btnSair);
}

async function sair() {
  const btnSair = document.querySelector('.btn-sair');
  if (btnSair) {
    btnSair.disabled = true;
    btnSair.innerHTML = '<span class="spinner-btn"></span> Saindo…';
  }
  try { await api('logout', { body: {} }); } catch(_) {}
  limparSessao();
  App.dados = null; App.diaSel = null;
  renderLogin();
  preencherCamposLogin();
}

// ---- FERIADOS NACIONAIS (cálculo client-side) ----

function getFeriadosBR(ano) {
  // Algoritmo de Butcher para Páscoa
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  const pascoa = new Date(ano, mes - 1, dia);

  function add(dt, days) {
    const r = new Date(dt); r.setDate(r.getDate() + days); return r;
  }
  function mmdd(dt) {
    return String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  }

  const feriados = {};
  [
    ['01-01','Ano Novo'],['04-21','Tiradentes'],['05-01','Trabalho'],
    ['09-07','Independência'],['10-12','N.Sra.Aparecida'],['11-02','Finados'],
    ['11-15','República'],['12-25','Natal']
  ].forEach(([d, n]) => feriados[d] = n);

  feriados[mmdd(add(pascoa, -48))] = 'Carnaval';
  feriados[mmdd(add(pascoa, -47))] = 'Carnaval';
  feriados[mmdd(add(pascoa, -2))]  = 'Sexta-feira Santa';
  feriados[mmdd(pascoa)]           = 'Páscoa';
  feriados[mmdd(add(pascoa, 60))]  = 'Corpus Christi';

  return feriados;
}

// ---- INICIALIZAÇÃO ----

window.addEventListener('DOMContentLoaded', () => {
  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Carrega logo de login via API (sem autenticação)
  carregarLogoLogin();

  // Verifica sessão salva
  carregarSessao();

  if (App.token && App.user) {
    api('me').then(() => iniciarApp()).catch(() => { limparSessao(); renderLogin(); preencherCamposLogin(); });
  } else {
    renderLogin();
    preencherCamposLogin();
  }

  document.getElementById('senha').addEventListener('keydown', e => {
    if (e.key === 'Enter') fazerLogin();
  });
});

function carregarLogoLogin() {
  api('logo').then(function(res) {
    if (res && res.src) {
      const img = document.getElementById('logo-login-img');
      const svg = document.getElementById('logo-login-svg');
      if (img && svg) {
        img.src = res.src;
        img.style.display = 'block';
        svg.style.display = 'none';
      }
    }
  }).catch(function() {
    // Silencioso — o SVG fallback já está visível
  });
}


