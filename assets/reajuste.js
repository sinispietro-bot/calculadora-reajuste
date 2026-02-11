// /assets/reajuste.js
(() => {
  // =========================
  // CONFIG / SÉRIES
  // =========================

  // Séries (SGS/BCB)
  // IGP-M (FGV): 189  | IGP-DI (FGV): 190 | IPCA: 433 | IPC-FIPE (nível): 11773
  // IPC-FIPE (variação mensal) nem sempre está claro no SGS. Aqui tentamos um "fallback" inteligente.
  const SERIES = {
    "IGP-M (FGV) — SGS 189": { id: 189, type: "level" },
    "IGP-DI (FGV) — SGS 190": { id: 190, type: "level" },
    "IPCA (IBGE) — SGS 433": { id: 433, type: "level" },

    // IPC-FIPE: o SGS 11773 costuma vir como "nível" (pontos).
    // Muitos sites concorrentes usam a "variação mensal (%)" e acumulam as taxas.
    // Aqui: tentamos buscar uma série de variação (se existir) e, se não der, cai para nível.
    "IPC-FIPE — SGS 11773": {
      id: 11773,
      type: "auto_ipc_fipe", // tenta variação (%), senão usa nível
      // chute comum de série de variação (se não existir, vamos detectar e cair pro nível)
      maybeVariationId: 11774,
    },
  };

  // =========================
  // HELPERS: DOM
  // =========================
  const $ = (sel) => document.querySelector(sel);

  // IDs esperados no HTML (se o seu HTML tiver IDs diferentes, me manda um print do trecho do HTML)
  const el = {
    aluguel: $("#aluguel"),
    inicio: $("#inicio"),
    indice: $("#indice"),
    periodicidade: $("#periodicidade"),
    travarDeflacao: $("#travarDeflacao"),
    btnCalcular: $("#btnCalcular"),

    // Saídas
    outDataReajuste: $("#outDataReajuste"),
    outVariacao: $("#outVariacao"),
    outFator: $("#outFator"),
    outNovoAluguel: $("#outNovoAluguel"),
    outDetalhes: $("#outDetalhes"),
    outMsg: $("#msg"),
    outDiagnostico: $("#diagnostico"),
    diagUrl: $("#diagUrl"),
    diagInfo: $("#diagInfo"),
    diagLista: $("#diagLista"),
    detalhesWrap: $("#detalhesWrap"),
  };

  // Se não achar elementos, não quebra a página inteira
  const required = ["aluguel", "inicio", "indice", "periodicidade", "btnCalcular"];
  const missing = required.filter((k) => !el[k]);
  if (missing.length) {
    console.warn("reajuste.js: faltando IDs no HTML:", missing);
    return;
  }

  // =========================
  // FORMATAÇÃO (MOEDA / DATA)
  // =========================
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  function onlyDigits(s) {
    return String(s || "").replace(/\D+/g, "");
  }

  function parseBRL(input) {
    // aceita "10000", "10.000,00", "R$ 10.000,00"
    const s = String(input || "").trim();
    if (!s) return NaN;

    // se veio só número (ex: 10000)
    if (/^\d+([.,]\d+)?$/.test(s) && !s.includes("R$")) {
      // 10000 => 10000
      return Number(s.replace(",", "."));
    }

    // padrão BR
    const cleaned = s
      .replace(/[R$\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatBRL(n) {
    if (!Number.isFinite(n)) return "";
    return brl.format(n);
  }

  function maskCurrencyInput(inputEl) {
    inputEl.addEventListener("focus", () => {
      // no foco: deixa "cru" se estiver formatado, mas sem atrapalhar
      // (não vamos mexer demais aqui)
    });

    inputEl.addEventListener("blur", () => {
      const n = parseBRL(inputEl.value);
      if (Number.isFinite(n)) inputEl.value = formatBRL(n);
    });

    inputEl.addEventListener("input", () => {
      // permite digitar normalmente; se usuário digitar só números, tudo bem
      // não força máscara durante digitação pra não ficar travando o cursor
    });
  }

  function maskDateInput(inputEl) {
    inputEl.setAttribute("placeholder", "dd/mm/aaaa");
    inputEl.addEventListener("input", () => {
      let v = onlyDigits(inputEl.value).slice(0, 8);
      if (v.length >= 5) v = v.replace(/^(\d{2})(\d{2})(\d{1,4}).*/, "$1/$2/$3");
      else if (v.length >= 3) v = v.replace(/^(\d{2})(\d{1,2}).*/, "$1/$2");
      inputEl.value = v;
    });
  }

  function parseBRDate(ddmmyyyy) {
    const s = String(ddmmyyyy || "").trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
    const [dd, mm, yyyy] = s.split("/").map((x) => Number(x));
    const d = new Date(yyyy, mm - 1, dd);
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
    return d;
  }

  function formatBRDate(d) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function addMonths(date, n) {
    const d = new Date(date);
    const day = d.getDate();
    d.setMonth(d.getMonth() + n);

    // corrige overflow (ex: 31 -> mês com 30)
    if (d.getDate() !== day) {
      d.setDate(0); // último dia do mês anterior
    }
    return d;
  }

  function addYears(date, n) {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + n);
    return d;
  }

  // =========================
  // UI: preencher select de índices
  // =========================
  function populateIndices() {
    el.indice.innerHTML = "";
    Object.keys(SERIES).forEach((label) => {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      el.indice.appendChild(opt);
    });
  }

  // =========================
  // CHAMADA À API (OPÇÃO 2)
  // =========================
  async function fetchSGS(serieId, dataInicial, dataFinal) {
    const url = `/api/sgs?serie=${encodeURIComponent(serieId)}&dataInicial=${encodeURIComponent(
      dataInicial
    )}&dataFinal=${encodeURIComponent(dataFinal)}`;

    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error || `Falha na API (${resp.status})`);
    }
    return await resp.json();
  }

  // =========================
  // CÁLCULO
  // =========================
  function detectSeriesNature(values) {
    // heurística:
    // - variação mensal (%) geralmente fica entre -50 e +50 (normal é -5 a +5)
    // - nível (índice) normalmente é bem maior (ex: 1000, 180, 6000 etc)
    // - mas IPCA nível (433) pode ser algo como 7000 (nível), IPC-FIPE nível ~ 180
    // então: se a maioria está em módulo < 50 => "percent"
    const finite = values.filter((v) => Number.isFinite(v));
    if (!finite.length) return "unknown";
    const small = finite.filter((v) => Math.abs(v) < 50).length;
    return small / finite.length >= 0.8 ? "percent" : "level";
  }

  function factorFromMonthlyPercents(monthlyPercents) {
    // acumulado por multiplicação: Π(1 + p/100)
    return monthlyPercents.reduce((acc, p) => acc * (1 + p / 100), 1);
  }

  function factorFromLevels(levels) {
    // fator = último / primeiro
    if (levels.length < 2) return NaN;
    const first = levels[0];
    const last = levels[levels.length - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return NaN;
    return last / first;
  }

  function setTextSafe(node, text) {
    if (!node) return;
    node.textContent = text;
  }

  function showMsg(type, text) {
    if (!el.outMsg) return;
    el.outMsg.classList.remove("ok", "err");
    if (type === "ok") el.outMsg.classList.add("ok");
    if (type === "err") el.outMsg.classList.add("err");
    el.outMsg.textContent = text;
  }

  function clearOutputs() {
    setTextSafe(el.outDataReajuste, "—");
    setTextSafe(el.outVariacao, "—");
    setTextSafe(el.outFator, "—");
    setTextSafe(el.outNovoAluguel, "—");
    if (el.diagUrl) el.diagUrl.textContent = "—";
    if (el.diagInfo) el.diagInfo.textContent = "";
    if (el.diagLista) el.diagLista.innerHTML = "";
    if (el.outDetalhes) el.outDetalhes.innerHTML = "";
    showMsg("", "");
  }

  function percentBR(x) {
    if (!Number.isFinite(x)) return "—";
    return `${x.toFixed(2).replace(".", ",")}%`;
  }

  function numberBR(x, decimals = 6) {
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  function monthNamePT(m) {
    const names = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
    return names[m] || "";
  }

  function periodLabel(startDate, endDate) {
    // start/end são datas do tipo 01/mm/aaaa
    const s = parseBRDate(startDate);
    const e = parseBRDate(endDate);
    if (!s || !e) return "";
    return `${monthNamePT(s.getMonth())} de ${s.getFullYear()} até ${monthNamePT(e.getMonth())} de ${e.getFullYear()}`;
  }

  async function calcular() {
    clearOutputs();

    // 1) Inputs
    const aluguelBase = parseBRL(el.aluguel.value);
    if (!Number.isFinite(aluguelBase) || aluguelBase <= 0) {
      showMsg("err", "Informe um valor de aluguel válido.");
      return;
    }

    const dtInicio = parseBRDate(el.inicio.value);
    if (!dtInicio) {
      showMsg("err", "Informe a data de início no formato dd/mm/aaaa.");
      return;
    }

    const periodicidade = String(el.periodicidade.value || "anual").toLowerCase(); // "mensal" | "anual"
    const idxLabel = el.indice.value;
    const idxCfg = SERIES[idxLabel];
    if (!idxCfg) {
      showMsg("err", "Selecione um índice.");
      return;
    }

    const travar = !!el.travarDeflacao?.checked;

    // 2) Data do reajuste
    const dtReajuste = periodicidade === "mensal" ? addMonths(dtInicio, 1) : addYears(dtInicio, 1);

    // 3) Período considerado:
    // regra: do mês inicial até o mês ANTERIOR ao reajuste
    // então usamos datas 01/mm/aaaa
    const inicioMes = new Date(dtInicio.getFullYear(), dtInicio.getMonth(), 1);
    const fimMes = new Date(dtReajuste.getFullYear(), dtReajuste.getMonth(), 1);
    const fimConsiderado = addMonths(fimMes, -1);

    const dataInicial = `01/${String(inicioMes.getMonth() + 1).padStart(2, "0")}/${inicioMes.getFullYear()}`;
    const dataFinal = `01/${String(fimConsiderado.getMonth() + 1).padStart(2, "0")}/${fimConsiderado.getFullYear()}`;

    setTextSafe(el.outDataReajuste, formatBRDate(dtReajuste));

    // 4) Buscar dados (API interna)
    const btn = el.btnCalcular;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Calculando...";

    try {
      let serieId = idxCfg.id;

      // IPC-FIPE: tenta variação mensal primeiro
      let payload;
      let effectiveType = idxCfg.type;

      if (idxCfg.type === "auto_ipc_fipe" && idxCfg.maybeVariationId) {
        // tenta puxar a suposta série de variação
        try {
          const pVar = await fetchSGS(idxCfg.maybeVariationId, dataInicial, dataFinal);
          const vals = (pVar?.dados || []).map((x) => x.valor);
          const nature = detectSeriesNature(vals);

          if (pVar?.dados?.length >= 2 && nature === "percent") {
            payload = pVar;
            serieId = idxCfg.maybeVariationId;
            effectiveType = "percent";
          } else {
            // cai pro nível
            payload = await fetchSGS(idxCfg.id, dataInicial, dataFinal);
            effectiveType = "level";
          }
        } catch (_) {
          payload = await fetchSGS(idxCfg.id, dataInicial, dataFinal);
          effectiveType = "level";
        }
      } else {
        payload = await fetchSGS(serieId, dataInicial, dataFinal);
        if (idxCfg.type === "level" || idxCfg.type === "percent") {
          effectiveType = idxCfg.type;
        } else {
          const vals = (payload?.dados || []).map((x) => x.valor);
          effectiveType = detectSeriesNature(vals);
        }
      }

      if (el.diagUrl) el.diagUrl.textContent = payload?.url || "—";

      const dados = payload?.dados || [];
      if (dados.length < 2) {
        showMsg("err", "Não encontrei dados suficientes no período. Tente outra data/índice.");
        return;
      }

      // 5) Calcular fator
      const valores = dados.map((d) => d.valor);

      let fator;
      if (effectiveType === "percent") {
        fator = factorFromMonthlyPercents(valores);
      } else {
        fator = factorFromLevels(valores);
      }

      if (!Number.isFinite(fator)) {
        showMsg("err", "Não foi possível calcular o fator (dados inválidos).");
        return;
      }

      // travar deflação
      if (travar && fator < 1) fator = 1;

      const variacao = (fator - 1) * 100;
      const novoAluguel = aluguelBase * fator;

      // 6) Render
      setTextSafe(el.outVariacao, percentBR(variacao));
      setTextSafe(el.outFator, numberBR(fator, 6));
      setTextSafe(el.outNovoAluguel, formatBRL(novoAluguel));

      // Detalhes
      if (el.outDetalhes) {
        const periodoTxt = periodLabel(dataInicial, dataFinal);
        const meses = dados.length;

        el.outDetalhes.innerHTML = `
          <div style="margin-top:10px; font-size:13px; color: rgba(255,255,255,.75);">
            <b>${idxLabel}</b><br/>
            Período considerado: <b>${periodoTxt}</b><br/>
            Meses considerados: <b>${meses}</b><br/>
            Deflação: <b>${travar ? "travada (não reduz)" : "permitida"}</b><br/>
            Série usada: <b>SGS ${serieId}</b> (${effectiveType === "percent" ? "variação mensal (%)" : "nível (índice)"})
          </div>
        `;
      }

      // Lista meses/valores
      if (el.diagLista) {
        el.diagLista.innerHTML = "";
        dados.forEach((d) => {
          const li = document.createElement("div");
          const v = d.valor;
          const txt =
            effectiveType === "percent"
              ? `${d.data}: ${percentBR(v)}`
              : `${d.data}: ${numberBR(v, 4)} (nível)`;
          li.textContent = txt;
          el.diagLista.appendChild(li);
        });
      }

      showMsg("ok", "Cálculo concluído com sucesso.");
    } catch (err) {
      showMsg("err", `Erro: ${String(err?.message || err)}`);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  // =========================
  // INIT
  // =========================
  populateIndices();

  // máscaras
  maskCurrencyInput(el.aluguel);
  maskDateInput(el.inicio);

  // valor inicial “bonito” se vier puro
  if (el.aluguel.value && !el.aluguel.value.includes("R$")) {
    const n = parseBRL(el.aluguel.value);
    if (Number.isFinite(n)) el.aluguel.value = formatBRL(n);
  }

  // clique calcular
  el.btnCalcular.addEventListener("click", (e) => {
    e.preventDefault();
    calcular();
  });
})();
