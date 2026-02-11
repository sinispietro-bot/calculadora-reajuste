// /assets/reajuste.js
(() => {
  const SERIES = {
    "IGP-M (FGV) — SGS 189": { id: 189, mode: "level" },
    "IGP-DI (FGV) — SGS 190": { id: 190, mode: "level" },
    "IPCA (IBGE) — SGS 433": { id: 433, mode: "level" },

    // IPC-FIPE continua como nível (11773). Se você quiser igual ao concorrente (variação mensal),
    // precisamos confirmar qual série SGS é a % mensal.
    "IPC-FIPE — SGS 11773": { id: 11773, mode: "level" },
  };

  const $ = (s) => document.querySelector(s);

  const el = {
    aluguel: $("#aluguel"),
    inicio: $("#inicio"),
    indice: $("#indice"),
    periodicidade: $("#periodicidade"),
    travar: $("#travarDeflacao"),
    btn: $("#btnCalcular"),
    msg: $("#msg"),

    outData: $("#outDataReajuste"),
    outVar: $("#outVariacao"),
    outFator: $("#outFator"),
    outNovo: $("#outNovoAluguel"),
    outDetalhes: $("#outDetalhes"),

    diagUrl: $("#diagUrl"),
    diagInfo: $("#diagInfo"),
    diagLista: $("#diagLista"),
  };

  // Se a página não tiver os IDs, não faz nada (evita quebrar outras páginas)
  if (!el.aluguel || !el.inicio || !el.indice || !el.periodicidade || !el.btn) {
    console.warn("reajuste.js: IDs não encontrados no HTML da calculadora.");
    return;
  }

  // ---------- máscaras ----------
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  function parseBRL(v) {
    const s = String(v || "").trim();
    if (!s) return NaN;
    const cleaned = s.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  function formatBRL(n) { return Number.isFinite(n) ? brl.format(n) : ""; }

  function onlyDigits(s) { return String(s || "").replace(/\D+/g, ""); }

  function maskDateInput(input) {
    input.addEventListener("input", () => {
      let v = onlyDigits(input.value).slice(0, 8);
      if (v.length >= 5) v = v.replace(/^(\d{2})(\d{2})(\d{1,4}).*/, "$1/$2/$3");
      else if (v.length >= 3) v = v.replace(/^(\d{2})(\d{1,2}).*/, "$1/$2");
      input.value = v;
    });
  }

  function maskMoneyOnBlur(input) {
    input.addEventListener("blur", () => {
      const n = parseBRL(input.value);
      if (Number.isFinite(n)) input.value = formatBRL(n);
    });
  }

  // ---------- datas ----------
  function parseBRDate(s) {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
    const [dd, mm, yyyy] = s.split("/").map(Number);
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
    if (d.getDate() !== day) d.setDate(0);
    return d;
  }
  function addYears(date, n) {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + n);
    return d;
  }

  function setMsg(type, text) {
    if (!el.msg) return;
    el.msg.classList.remove("ok", "err");
    if (type) el.msg.classList.add(type);
    el.msg.textContent = text || "";
  }

  function clearOutputs() {
    el.outData.textContent = "—";
    el.outVar.textContent = "—";
    el.outFator.textContent = "—";
    el.outNovo.textContent = "—";
    if (el.outDetalhes) el.outDetalhes.innerHTML = "";
    if (el.diagUrl) el.diagUrl.textContent = "—";
    if (el.diagInfo) el.diagInfo.textContent = "";
    if (el.diagLista) el.diagLista.innerHTML = "";
    setMsg("", "");
  }

  function percentBR(x) {
    if (!Number.isFinite(x)) return "—";
    return `${x.toFixed(2).replace(".", ",")}%`;
  }

  // ---------- API ----------
  async function fetchSGS(serieId, dataInicial, dataFinal) {
    const url = `/api/sgs?serie=${encodeURIComponent(serieId)}&dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j?.error || `Falha na API (${resp.status})`);
    }
    return await resp.json();
  }

  // ---------- cálculo ----------
  function factorFromLevels(levels) {
    const first = levels[0];
    const last = levels[levels.length - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return NaN;
    return last / first;
  }

  function populateIndices() {
    el.indice.innerHTML = "";
    Object.keys(SERIES).forEach((label) => {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      el.indice.appendChild(opt);
    });
  }

  async function calcular() {
    clearOutputs();

    const aluguel = parseBRL(el.aluguel.value);
    if (!Number.isFinite(aluguel) || aluguel <= 0) {
      setMsg("err", "Informe um valor de aluguel válido.");
      return;
    }

    const dtInicio = parseBRDate(el.inicio.value);
    if (!dtInicio) {
      setMsg("err", "Informe a data de início no formato dd/mm/aaaa.");
      return;
    }

    const label = el.indice.value;
    const cfg = SERIES[label];
    if (!cfg) {
      setMsg("err", "Selecione um índice.");
      return;
    }

    const periodicidade = String(el.periodicidade.value || "anual").toLowerCase();
    const dtReajuste = periodicidade === "mensal" ? addMonths(dtInicio, 1) : addYears(dtInicio, 1);

    // período do cálculo: mês inicial até mês anterior ao reajuste
    const inicioMes = new Date(dtInicio.getFullYear(), dtInicio.getMonth(), 1);
    const fimMes = new Date(dtReajuste.getFullYear(), dtReajuste.getMonth(), 1);
    const fimConsiderado = addMonths(fimMes, -1);

    const dataInicial = `01/${String(inicioMes.getMonth() + 1).padStart(2, "0")}/${inicioMes.getFullYear()}`;
    const dataFinal = `01/${String(fimConsiderado.getMonth() + 1).padStart(2, "0")}/${fimConsiderado.getFullYear()}`;

    el.outData.textContent = formatBRDate(dtReajuste);

    const oldText = el.btn.textContent;
    el.btn.disabled = true;
    el.btn.textContent = "Calculando...";

    try {
      const payload = await fetchSGS(cfg.id, dataInicial, dataFinal);

      if (el.diagUrl) el.diagUrl.textContent = payload?.url || "—";

      const dados = payload?.dados || [];
      if (dados.length < 2) {
        setMsg("err", "Não encontrei dados suficientes no período. Tente outra data/índice.");
        return;
      }

      const levels = dados.map((x) => x.valor);
      let fator = factorFromLevels(levels);
      if (!Number.isFinite(fator)) {
        setMsg("err", "Não foi possível calcular o fator (dados inválidos).");
        return;
      }

      if (el.travar?.checked && fator < 1) fator = 1;

      const variacao = (fator - 1) * 100;
      const novo = aluguel * fator;

      el.outVar.textContent = percentBR(variacao);
      el.outFator.textContent = fator.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
      el.outNovo.textContent = formatBRL(novo);

      if (el.outDetalhes) {
        el.outDetalhes.innerHTML = `
          <div style="margin-top:8px">
            <b>${label}</b><br/>
            Série usada: <b>SGS ${cfg.id}</b> (nível)<br/>
            Pontos: <b>${dados.length}</b><br/>
            Período: <b>${dataInicial}</b> até <b>${dataFinal}</b><br/>
            Deflação: <b>${el.travar?.checked ? "travada (não reduz)" : "permitida"}</b>
          </div>
        `;
      }

      if (el.diagLista) {
        el.diagLista.innerHTML = "";
        dados.forEach((d) => {
          const div = document.createElement("div");
          div.textContent = `${d.data}: ${d.valor.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} (nível)`;
          el.diagLista.appendChild(div);
        });
      }

      setMsg("ok", "Cálculo concluído com sucesso.");
    } catch (e) {
      setMsg("err", `Erro: ${String(e?.message || e)}`);
    } finally {
      el.btn.disabled = false;
      el.btn.textContent = oldText;
    }
  }

  // INIT
  populateIndices();
  maskMoneyOnBlur(el.aluguel);
  maskDateInput(el.inicio);

  el.btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    calcular();
  });
})();
