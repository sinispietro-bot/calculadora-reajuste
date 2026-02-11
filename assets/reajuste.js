(() => {
  // ====== CONFIG: séries SGS ======
  // IMPORTANTE: IPC-FIPE correto (variação mensal %) = 193
  // (o código 11773 costuma retornar NÍVEL, não % mensal)
  const SERIES = [
    { key: "IGPM",  label: "IGP-M (FGV) — SGS 189",  sgs: 189, type: "pct" },
    { key: "IGPDI", label: "IGP-DI (FGV) — SGS 190", sgs: 190, type: "pct" },
    { key: "IPCA",  label: "IPCA (IBGE) — SGS 433",  sgs: 433, type: "pct" },
    { key: "IPCFIPE", label: "IPC-FIPE — SGS 193",    sgs: 193, type: "pct" },
  ];

  // ====== Helpers DOM ======
  const $ = (id) => document.getElementById(id);

  // Se seus IDs forem diferentes, ajuste aqui:
  const el = {
    aluguel: $("aluguel"),
    indice: $("indice"),
    inicio: $("inicio"),
    periodicidade: $("periodicidade"),
    travaDeflacao: $("travaDeflacao"),
    btn: $("btnCalcular"),

    outData: $("outData"),
    outVar: $("outVariacao"),
    outFator: $("outFator"),
    outNovo: $("outNovo"),

    detalhes: $("outDetalhes"),
    msg: $("msg"),
    diag: $("diag"),
  };

  // ====== Formatação ======
  const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fmtPct = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });

  function setMsg(text, type = "info") {
    if (!el.msg) return;
    el.msg.textContent = text || "";
    el.msg.className = `msg ${type}`;
  }

  // ====== Máscara moeda (digita 10000 -> R$ 10.000,00) ======
  function parseBRL(input) {
    if (!input) return NaN;
    // permite "10000", "10.000,00", "R$ 10.000,00"
    const cleaned = String(input)
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatBRLFromNumber(n) {
    if (!Number.isFinite(n)) return "";
    return fmtBRL.format(n);
  }

  function installMoneyMask(input) {
    if (!input) return;
    input.addEventListener("blur", () => {
      const n = parseBRL(input.value);
      if (Number.isFinite(n)) input.value = formatBRLFromNumber(n);
    });
  }

  // ====== Máscara data dd/mm/aaaa ======
  function parseBRDate(ddmmyyyy) {
    if (!ddmmyyyy) return null;
    const m = String(ddmmyyyy).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== (mo - 1) || dt.getDate() !== d) return null;
    return dt;
  }

  function formatBRDate(dt) {
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const y = dt.getFullYear();
    return `${d}/${m}/${y}`;
  }

  function installDateMask(input) {
    if (!input) return;
    input.addEventListener("input", () => {
      let v = input.value.replace(/[^\d]/g, "").slice(0, 8);
      if (v.length >= 5) input.value = `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`;
      else if (v.length >= 3) input.value = `${v.slice(0,2)}/${v.slice(2)}`;
      else input.value = v;
    });
  }

  // ====== Datas do período ======
  // Regra: "do mês inicial até o mês anterior ao reajuste".
  // - Mensal: reajuste = +1 mês do início; período = mês do início (inclusive) até mês anterior ao reajuste.
  // - Anual: reajuste = +1 ano do início; período idem.
  function addMonths(dt, n) {
    const d = new Date(dt);
    d.setMonth(d.getMonth() + n);
    return d;
  }
  function addYears(dt, n) {
    const d = new Date(dt);
    d.setFullYear(d.getFullYear() + n);
    return d;
  }

  function toBCBDate(dt) {
    // BCB usa dd/mm/aaaa
    return formatBRDate(dt);
  }

  // Para buscar mês completo, pedimos do primeiro dia do mês inicial
  // até o último dia do mês anterior ao reajuste
  function monthStart(dt) {
    return new Date(dt.getFullYear(), dt.getMonth(), 1);
  }
  function monthEnd(dt) {
    return new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
  }

  // ====== Fetch com cache ======
  async function fetchSerie(serie, dataInicial, dataFinal) {
    const cacheKey = `sgs:${serie}:${dataInicial}:${dataFinal}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    const url = `/api/sgs?serie=${encodeURIComponent(serie)}&dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Erro ao consultar BCB (HTTP ${r.status})`);
    const data = await r.json();

    try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
    return data;
  }

  // ====== Cálculo: acumula variações mensais (%) ======
  // fator = Π(1 + v/100)
  function calcFromPctSeries(rows, travaDeflacao) {
    const items = [];
    let fator = 1;

    for (const row of rows) {
      // row: { data: "01/12/2024", valor: "0.34" }
      const v = Number(String(row.valor).replace(",", "."));
      if (!Number.isFinite(v)) continue;

      const mult = 1 + (v / 100);
      fator *= mult;

      items.push({
        data: row.data,
        vPct: v,
      });
    }

    if (travaDeflacao && fator < 1) fator = 1;

    const variacao = fator - 1;
    return { fator, variacao, items };
  }

  // ====== UI: preencher select do índice ======
  function ensureIndiceOptions() {
    if (!el.indice) return;

    // se já tem opções, não duplica
    if (el.indice.options && el.indice.options.length >= 2) return;

    el.indice.innerHTML = "";
    for (const s of SERIES) {
      const opt = document.createElement("option");
      opt.value = s.key;
      opt.textContent = s.label;
      el.indice.appendChild(opt);
    }
  }

  // ====== Render resultado ======
  function renderResult({ dataReajuste, fator, variacao, items }, serieLabel) {
    if (el.outData) el.outData.textContent = dataReajuste;
    if (el.outVar)  el.outVar.textContent = fmtPct.format(variacao);
    if (el.outFator) el.outFator.textContent = fmtNum.format(fator);

    const aluguelBase = parseBRL(el.aluguel?.value);
    const novo = Number.isFinite(aluguelBase) ? (aluguelBase * fator) : NaN;
    if (el.outNovo) el.outNovo.textContent = Number.isFinite(novo) ? fmtBRL.format(novo) : "—";

    if (el.detalhes) {
      const linhas = items.map(i => `${i.data}: ${i.vPct.toFixed(2).replace(".", ",")}%`).join("\n");
      el.detalhes.textContent =
        `${serieLabel}\n` +
        `Meses considerados: ${items.length}\n\n` +
        linhas;
    }
  }

  // ====== Clique calcular ======
  async function onCalcular() {
    try {
      setMsg("", "info");

      const aluguel = parseBRL(el.aluguel?.value);
      if (!Number.isFinite(aluguel) || aluguel <= 0) {
        setMsg("Informe um valor de aluguel válido.", "error");
        return;
      }

      const dtInicio = parseBRDate(el.inicio?.value);
      if (!dtInicio) {
        setMsg("Informe uma data válida (dd/mm/aaaa).", "error");
        return;
      }

      const periodicidade = (el.periodicidade?.value || "Anual").toLowerCase();
      const dtReajuste = periodicidade.includes("mens") ? addMonths(dtInicio, 1) : addYears(dtInicio, 1);

      const dtIniBusca = monthStart(dtInicio);
      const dtFimBusca = monthEnd(addMonths(dtReajuste, -1)); // mês anterior ao reajuste

      const dataInicial = toBCBDate(dtIniBusca);
      const dataFinal = toBCBDate(dtFimBusca);

      const key = el.indice?.value || "IGPM";
      const serie = SERIES.find(s => s.key === key) || SERIES[0];

      if (el.btn) {
        el.btn.disabled = true;
        el.btn.textContent = "Calculando...";
      }

      const rows = await fetchSerie(serie.sgs, dataInicial, dataFinal);

      // rows é array com data/valor
      const trava = !!el.travaDeflacao?.checked;
      const { fator, variacao, items } = calcFromPctSeries(rows, trava);

      // Data do reajuste é a data do contrato + período
      const dataReajuste = formatBRDate(dtReajuste);

      renderResult(
        { dataReajuste, fator, variacao, items },
        serie.label
      );

      // Diagnóstico opcional
      if (el.diag) {
        el.diag.textContent =
          `URL consultada: /api/sgs?serie=${serie.sgs}&dataInicial=${dataInicial}&dataFinal=${dataFinal}\n` +
          `Período: ${dataInicial} até ${dataFinal}\n` +
          `Itens: ${items.length}\n` +
          `Fator: ${fator}`;
      }

      setMsg("Cálculo concluído com sucesso.", "ok");
    } catch (e) {
      setMsg(`Erro: ${e?.message || e}`, "error");
    } finally {
      if (el.btn) {
        el.btn.disabled = false;
        el.btn.textContent = "Calcular";
      }
    }
  }

  // ====== Init ======
  function init() {
    ensureIndiceOptions();
    installMoneyMask(el.aluguel);
    installDateMask(el.inicio);

    if (el.btn) el.btn.addEventListener("click", onCalcular);

    // Ajuste: ao focar, deixar digitar “limpo” se quiser
    if (el.aluguel) {
      el.aluguel.addEventListener("focus", () => {
        // transforma "R$ 10.000,00" -> "10000"
        const n = parseBRL(el.aluguel.value);
        if (Number.isFinite(n)) el.aluguel.value = String(Math.round(n * 100) / 100).replace(".", ",");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
