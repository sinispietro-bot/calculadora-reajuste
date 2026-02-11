/* =========================================================
   Calculadora de Reajuste - assets/reajuste.js
   - Busca dados via proxy: /api/sgs (Vercel)
   - Cache local + cache edge (no endpoint)
   - Acumula variação mensal no período:
     mês inicial (do contrato) -> mês anterior ao reajuste
   - "Travar deflação" impede fator < 1
   - IPC-FIPE: se vier em nível (ex: ~180), converte p/ variação mensal (%)
   ========================================================= */

// ======= AJUSTE AQUI se seus IDs forem diferentes no HTML =======
const IDS = {
  aluguel: "aluguel",
  dataInicio: "dataInicio",
  indice: "indice",
  periodicidade: "periodicidade",
  travar: "travarDeflacao",
  btnCalcular: "btnCalcular",

  outDataReajuste: "outDataReajuste",
  outVariacao: "outVariacao",
  outFator: "outFator",
  outNovoAluguel: "outNovoAluguel",

  detalhesContainer: "detalhesContainer", // uma <div> onde mostra a lista
  detalhesLista: "detalhesLista",         // um <div> ou <ul> que recebe os itens

  msgErro: "msgErro",
  msgOk: "msgOk",

  diagWrap: "diagWrap",
  diagUrl: "diagUrl",
  diagTipo: "diagTipo",
  diagPrimeiro: "diagPrimeiro",
  diagUltimo: "diagUltimo",
  diagFator: "diagFator",
};

// ======= SÉRIES SGS (mantenha como você já estava usando) =======
// Obs: IGP-M e IGP-DI normalmente funcionam como "variação mensal (%)".
// IPC-FIPE (11773) frequentemente vem como NÍVEL; por isso tratamos especial.
const SERIES = {
  IGP_M:   { label: "IGP-M (FGV)",  sgs: 189,  kind: "auto" }, // auto detecta
  IGP_DI:  { label: "IGP-DI (FGV)", sgs: 190,  kind: "auto" },
  IPCA:    { label: "IPCA (IBGE)",  sgs: 433,  kind: "auto" },
  IPC_FIPE:{ label: "IPC-FIPE",     sgs: 11773, kind: "ipc-fipe" }, // tratamento especial
};

// =========================================================
// Utilitários (moeda / datas / parsing)
// =========================================================
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function $(id) {
  const el = document.getElementById(id);
  return el || null;
}

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function parseBRL(input) {
  // aceita: "10000", "10.000,00", "R$ 10.000,00"
  if (typeof input !== "string") input = String(input ?? "");
  const cleaned = input
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function formatBRL(n) {
  return brl.format(n);
}

function parseBRDate(ddmmyyyy) {
  // dd/mm/aaaa
  if (!ddmmyyyy || typeof ddmmyyyy !== "string") return null;
  const m = ddmmyyyy.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  const d = new Date(yy, mm - 1, dd);
  // valida (ex: 31/02 inválido)
  if (d.getFullYear() !== yy || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null;
  return d;
}

function formatBRDate(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = date.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function firstDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);

  // ajuste de overflow (ex: 31 em mês sem 31)
  if (d.getDate() !== day) {
    d.setDate(0); // volta pro último dia do mês anterior
  }
  return d;
}

function addYears(date, years) {
  return addMonths(date, years * 12);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toSGSDate(date) {
  // SGS gosta de dd/mm/aaaa
  return formatBRDate(date);
}

// =========================================================
// Busca SGS via proxy /api/sgs + cache local
// =========================================================
async function fetchSerieSGS(serie, dataInicial, dataFinal) {
  const cacheKey = `sgs:${serie}:${dataInicial}:${dataFinal}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = `/api/sgs?serie=${encodeURIComponent(serie)}&dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`;

  // timeout pra não travar se o BCB estiver lento
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);

  const r = await fetch(url, { signal: ctrl.signal });
  clearTimeout(t);

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Erro SGS (${r.status}): ${text || "falha na consulta"}`);
  }

  const json = await r.json();
  localStorage.setItem(cacheKey, JSON.stringify(json));
  return json;
}

function parseSGSValue(v) {
  // BCB costuma vir como "1,23" (string)
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// =========================================================
// Cálculo da variação acumulada
// =========================================================
function accumulateFromMonthlyPercent(points) {
  // points: [{date: Date, value: percentNumber}] onde value = ex 0.34 (percent) OU 0.34? vamos padronizar p/ "pontos percentuais"
  // Aqui consideramos value como "percentual", ex: 0.34 significa 0,34%
  let factor = 1;
  const used = [];

  for (const p of points) {
    const pctMonth = p.value / 100; // 0,34% -> 0.0034
    factor *= (1 + pctMonth);
    used.push({ date: p.date, value: p.value });
  }

  return { factor, used };
}

function monthlyPercentFromLevel(points) {
  // Converte série em nível (ex: 184.15, 186.97) para variação mensal (%)
  // var% = (nivel_t / nivel_{t-1} - 1) * 100
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (!Number.isFinite(prev.value) || !Number.isFinite(cur.value) || prev.value === 0) continue;

    const v = ((cur.value / prev.value) - 1) * 100;
    out.push({ date: cur.date, value: v }); // value em %
  }
  return out;
}

// =========================================================
// Regra do período
// - Entrada: data início + periodicidade (Mensal/Anual)
// - Reajuste: +1 mês ou +1 ano na mesma data
// - Período do índice: mês do início -> mês anterior ao reajuste
// =========================================================
function buildPeriod(startDate, periodicidade) {
  const reajusteDate = periodicidade === "mensal"
    ? addMonths(startDate, 1)
    : addYears(startDate, 1);

  // Período dos índices: do 1º dia do mês inicial
  // até o 1º dia do mês anterior ao reajuste
  const startMonth = firstDayOfMonth(startDate);
  const endMonth = firstDayOfMonth(addMonths(reajusteDate, -1));

  return {
    reajusteDate,
    startMonth,
    endMonth,
    sgsStart: toSGSDate(startMonth),
    sgsEnd: toSGSDate(endMonth),
  };
}

// =========================================================
// UI helpers
// =========================================================
function clearOutputs() {
  setText($(IDS.outDataReajuste), "—");
  setText($(IDS.outVariacao), "—");
  setText($(IDS.outFator), "—");
  setText($(IDS.outNovoAluguel), "—");
  if ($(IDS.detalhesLista)) $(IDS.detalhesLista).innerHTML = "";
}

function setError(msg) {
  const el = $(IDS.msgErro);
  if (el) {
    el.textContent = msg;
    show(el, true);
  }
  show($(IDS.msgOk), false);
}

function setOk(msg) {
  const el = $(IDS.msgOk);
  if (el) {
    el.textContent = msg;
    show(el, true);
  }
  show($(IDS.msgErro), false);
}

function renderDetails(items, labelValue = "%") {
  const wrap = $(IDS.detalhesContainer);
  const list = $(IDS.detalhesLista);
  if (!wrap || !list) return;

  list.innerHTML = "";

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "detailRow";

    const left = document.createElement("span");
    left.className = "detailDate";
    left.textContent = formatBRDate(it.date);

    const right = document.createElement("span");
    right.className = "detailValue";

    if (labelValue === "%") {
      right.textContent = `${it.value.toFixed(2).replace(".", ",")}%`;
    } else {
      right.textContent = String(it.value);
    }

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }
}

// =========================================================
// MAIN
// =========================================================
async function calcular() {
  clearOutputs();
  setError("");

  const aluguelStr = $(IDS.aluguel)?.value ?? "";
  const aluguel = parseBRL(aluguelStr);
  if (!Number.isFinite(aluguel) || aluguel <= 0) {
    setError("Informe um valor de aluguel válido (ex: 10000 ou 10.000,00).");
    return;
  }

  const dataInicioStr = $(IDS.dataInicio)?.value ?? "";
  const startDate = parseBRDate(dataInicioStr);
  if (!startDate) {
    setError("Informe a data de início no formato dd/mm/aaaa.");
    return;
  }

  const indiceKey = $(IDS.indice)?.value ?? "";
  if (!SERIES[indiceKey]) {
    setError("Selecione um índice válido.");
    return;
  }

  const periodicidadeRaw = ($(IDS.periodicidade)?.value ?? "anual").toLowerCase();
  const periodicidade = periodicidadeRaw.includes("mens") ? "mensal" : "anual";

  const travar = !!$(IDS.travar)?.checked;

  // período
  const p = buildPeriod(startDate, periodicidade);

  // diagnóstico (se tiver)
  show($(IDS.diagWrap), false);
  setText($(IDS.diagUrl), "");
  setText($(IDS.diagTipo), "");
  setText($(IDS.diagPrimeiro), "");
  setText($(IDS.diagUltimo), "");
  setText($(IDS.diagFator), "");

  // busca SGS
  const serieCfg = SERIES[indiceKey];
  let raw;

  try {
    // deixa UX melhor: mensagem "calculando..."
    setOk("Calculando...");

    raw = await fetchSerieSGS(serieCfg.sgs, p.sgsStart, p.sgsEnd);

    if (!Array.isArray(raw) || raw.length === 0) {
      setError("Não vieram dados do Banco Central para esse período.");
      return;
    }
  } catch (e) {
    setError(`Erro ao consultar o BCB: ${e.message || e}`);
    return;
  }

  // normaliza pontos (Date + number)
  const points = raw
    .map((r) => {
      const d = parseBRDate(r.data);
      const v = parseSGSValue(r.valor);
      return (d && Number.isFinite(v)) ? ({ date: d, value: v }) : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  if (points.length === 0) {
    setError("Dados inválidos recebidos do Banco Central.");
    return;
  }

  // === Regra do cálculo por tipo
  // - default: assumimos variação mensal (%) se os valores forem pequenos
  // - IPC-FIPE: se vier nível (muito alto), converte para variação mensal (%)
  let monthlyPercentSeries = null;
  let tipoUsado = "Variação mensal (%)";

  if (serieCfg.kind === "ipc-fipe") {
    // Se for IPC-FIPE e vier com valores altos (tipo 180), trata como NÍVEL
    const median = points[Math.floor(points.length / 2)]?.value ?? 0;

    if (Math.abs(median) > 20) {
      // Converte NÍVEL -> variação mensal (%)
      monthlyPercentSeries = monthlyPercentFromLevel(points);
      tipoUsado = "Nível convertido para variação mensal (%)";
    } else {
      // já veio como %
      monthlyPercentSeries = points;
      tipoUsado = "Variação mensal (%)";
    }
  } else {
    // auto: se os valores parecerem "nível" (muito grandes), converte
    const median = points[Math.floor(points.length / 2)]?.value ?? 0;

    if (Math.abs(median) > 50) {
      monthlyPercentSeries = monthlyPercentFromLevel(points);
      tipoUsado = "Nível convertido para variação mensal (%)";
    } else {
      monthlyPercentSeries = points;
      tipoUsado = "Variação mensal (%)";
    }
  }

  if (!monthlyPercentSeries || monthlyPercentSeries.length === 0) {
    setError("Não foi possível montar a série de variações mensais para o cálculo.");
    return;
  }

  // Acumula
  const acc = accumulateFromMonthlyPercent(monthlyPercentSeries);

  let factor = acc.factor;
  if (travar && factor < 1) factor = 1;

  const variacao = (factor - 1); // em decimal
  const novoAluguel = aluguel * factor;

  // outputs
  setText($(IDS.outDataReajuste), formatBRDate(p.reajusteDate));
  setText($(IDS.outVariacao), pct.format(variacao));
  setText($(IDS.outFator), factor.toFixed(6).replace(".", ","));
  setText($(IDS.outNovoAluguel), formatBRL(novoAluguel));

  renderDetails(acc.used, "%");

  // diagnóstico (se existir no HTML)
  if ($(IDS.diagWrap)) {
    show($(IDS.diagWrap), true);
    setText($(IDS.diagTipo), tipoUsado);

    // mostra o 1º e o último ponto usado
    const first = acc.used[0];
    const last = acc.used[acc.used.length - 1];
    if (first) setText($(IDS.diagPrimeiro), `${formatBRDate(first.date)} => ${first.value.toFixed(4).replace(".", ",")}%`);
    if (last) setText($(IDS.diagUltimo), `${formatBRDate(last.date)} => ${last.value.toFixed(4).replace(".", ",")}%`);
    setText($(IDS.diagFator), factor.toFixed(10).replace(".", ","));

    // URL (proxy)
    setText($(IDS.diagUrl), `/api/sgs?serie=${serieCfg.sgs}&dataInicial=${p.sgsStart}&dataFinal=${p.sgsEnd}`);
  }

  setOk("Cálculo concluído com sucesso.");
}

// =========================================================
// Eventos
// =========================================================
function bind() {
  const btn = $(IDS.btnCalcular);
  if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); calcular(); });

  // Enter no campo aluguel ou data
  const aluguelEl = $(IDS.aluguel);
  const dataEl = $(IDS.dataInicio);
  [aluguelEl, dataEl].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        calcular();
      }
    });
  });

  // formata moeda quando sai do campo
  if (aluguelEl) {
    aluguelEl.addEventListener("blur", () => {
      const n = parseBRL(aluguelEl.value);
      if (Number.isFinite(n)) aluguelEl.value = formatBRL(n);
    });
  }
}

document.addEventListener("DOMContentLoaded", bind);
