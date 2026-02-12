/* ====== Formatadores ====== */
const nfBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const nfPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseBRL(str) {
  if (!str) return NaN;
  // aceita "10000", "10.000,00", "R$ 10.000,00"
  const s = String(str)
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function formatBRL(n) {
  return nfBRL.format(n);
}

function maskDateInput(el) {
  el.addEventListener("input", () => {
    let v = el.value.replace(/\D/g, "").slice(0, 8);
    if (v.length >= 5) el.value = v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4);
    else if (v.length >= 3) el.value = v.slice(0, 2) + "/" + v.slice(2);
    else el.value = v;
  });
}

function parseDateBR(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str || "");
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
}
function formatDateBR(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function firstOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d, months) {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}
function addYears(d, years) {
  return new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
}
function ddmmyyyy(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthsBetweenInclusive(a, b) {
  // a e b são primeiros dias do mês
  const out = [];
  let cur = new Date(a.getFullYear(), a.getMonth(), 1);
  const end = new Date(b.getFullYear(), b.getMonth(), 1);
  while (cur <= end) {
    out.push(new Date(cur.getFullYear(), cur.getMonth(), 1));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}

/* ====== Séries (percentuais mensais) ====== */
const SERIES = {
  189: { name: "IGP-M (FGV)", kind: "pct" },
  190: { name: "IGP-DI (FGV)", kind: "pct" },
  433: { name: "IPCA (IBGE)", kind: "pct" },
  193: { name: "IPC-FIPE", kind: "pct" },
};

/* ====== Fetch via API (opção 2) ====== */
async function fetchSGSViaAPI(seriesCode, startDate, endDate) {
  const url = new URL("/api/sgs", window.location.origin);
  url.searchParams.set("serie", String(seriesCode));
  url.searchParams.set("dataInicial", ddmmyyyy(startDate));
  url.searchParams.set("dataFinal", ddmmyyyy(endDate));

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = payload?.error ? `${payload.error}${payload.detail ? " — " + payload.detail : ""}` : `HTTP ${res.status}`;
    throw new Error(`Falha ao consultar API. ${msg}`);
  }
  if (!payload || !Array.isArray(payload.data)) throw new Error("Resposta inesperada da API.");
  return payload; // {url, data}
}

/* ====== Cálculo: produto de (1+v/100) ====== */
function factorFromPctRows(rows) {
  let factor = 1;
  const lines = [];
  for (const row of rows) {
    const v = Number(String(row.valor).replace(",", "."));
    if (!Number.isFinite(v)) continue;
    factor *= 1 + v / 100;
    lines.push(`${row.data}: ${nfPct.format(v)}%`);
  }
  return { factor, lines };
}

/* ====== UI: pega elementos ====== */
const rentEl = document.getElementById("rent");
const idxEl = document.getElementById("idx");
const startEl = document.getElementById("start");
const freqEl = document.getElementById("freq");
const lockEl = document.getElementById("lock");
const btnEl = document.getElementById("btn");
const statusEl = document.getElementById("status");
const diagEl = document.getElementById("diag");

const outDate = document.getElementById("outDate");
const outVar = document.getElementById("outVar");
const outFactor = document.getElementById("outFactor");
const outRent = document.getElementById("outRent");
const outList = document.getElementById("outList");

// Ano a ano (anual)
const yearWrap = document.getElementById("yearWrap");
const yearBody = document.getElementById("yearBody");

/* ====== Máscaras (IGUAL ao seu código bom) ====== */
maskDateInput(startEl);

// moeda: formata apenas ao sair do campo (blur)
rentEl.addEventListener("blur", () => {
  const n = parseBRL(rentEl.value);
  if (Number.isFinite(n)) rentEl.value = formatBRL(n);
});

function setStatus(msg, kind) {
  statusEl.classList.remove("ok", "err");
  if (kind) statusEl.classList.add(kind);
  statusEl.innerHTML = msg;
}

/* ====== Ano a ano ====== */
function renderYearRows(rows) {
  // rows: [{ano, ref, periodo, variacao, novoAluguel, status}]
  yearBody.innerHTML = "";

  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "yyRow";

    row.innerHTML = `
      <div class="yyCell yyAno">
        <div class="yyLabel">Ano</div>
        <div class="yyVal">${r.ano ?? "—"}</div>
      </div>

      <div class="yyCell yyRef">
        <div class="yyLabel">Data do reajuste</div>
        <div class="yyVal">${r.ref ?? "—"}</div>
        ${r.periodo ? `<div class="yySub">${r.periodo}</div>` : ``}
      </div>

      <div class="yyCell yyVar">
        <div class="yyLabel">Variação</div>
        <div class="yyVal">${r.variacao ?? "—"}</div>
      </div>

      <div class="yyCell yyRent">
        <div class="yyLabel">Novo aluguel</div>
        <div class="yyVal">${r.novoAluguel ?? "—"}</div>
      </div>

      <div class="yyCell yyStatus">
        <div class="yyLabel">Status</div>
        <div class="yyBadge ${r.statusClass || ""}">${r.status ?? "—"}</div>
      </div>
    `;

    yearBody.appendChild(row);
  }
}

function mostRecentWithData(rows) {
  // pega o último que tem status OK
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].status === "OK") return rows[i];
  }
  return null;
}

/* ====== Botão Calcular ====== */
btnEl.addEventListener("click", async () => {
  try {
    btnEl.disabled = true;
    setStatus("Calculando... consultando dados oficiais.", null);

    // validações
    const rent0 = parseBRL(rentEl.value);
    if (!Number.isFinite(rent0) || rent0 <= 0) throw new Error("Informe um valor de aluguel válido.");

    const start = parseDateBR(startEl.value);
    if (!start) throw new Error("Informe a data de início no formato dd/mm/aaaa.");

    const code = Number(idxEl.value);
    const cfg = SERIES[code];
    if (!cfg) throw new Error("Índice inválido.");

    const freq = freqEl.value; // monthly | annual
    const locked = lockEl.checked;

    // datas base
    const startMonth = firstOfMonth(start);
    const today = new Date();
    const todayMonth = firstOfMonth(today);

    // --------- CASO MENSAL (1 cálculo) ---------
    if (freq === "monthly") {
      yearWrap.style.display = "none";

      const reajusteDate = addMonths(start, 1);
      const endMonth = firstOfMonth(addMonths(reajusteDate, -1)); // normalmente o mês do início

      // se o período for futuro sem dados
      if (endMonth > todayMonth) {
        outDate.textContent = formatDateBR(reajusteDate);
        outVar.textContent = "—";
        outFactor.textContent = "—";
        outRent.textContent = "—";
        outList.textContent = "—";
        diagEl.textContent =
          `Sem dados ainda.\n\n` +
          `Índice: ${cfg.name} (SGS ${code})\n` +
          `Período: ${ddmmyyyy(startMonth)} até ${ddmmyyyy(endMonth)}\n`;
        setStatus("Ainda não existem dados oficiais para esse período (reajuste futuro).", "err");
        return;
      }

      const payload = await fetchSGSViaAPI(code, startMonth, endMonth);
      const data = payload.data;
      if (!data.length) throw new Error("Não há dados retornados para este período.");

      const { factor: rawFactor, lines } = factorFromPctRows(data);
      let factor = rawFactor;
      if (locked && factor < 1) factor = 1;

      const variation = (factor - 1) * 100;
      const newRent = rent0 * factor;

      outDate.textContent = formatDateBR(reajusteDate);
      outVar.textContent = `${nfPct.format(variation)}%`;
      outFactor.textContent = factor.toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
      outRent.textContent = formatBRL(newRent);
      outList.textContent = lines.join("\n") || "—";

      diagEl.textContent =
        `URL consultada:\n${payload.url}\n\n` +
        `Índice: ${cfg.name} (SGS ${code})\n` +
        `Periodicidade: Mensal\n` +
        `Período considerado: ${ddmmyyyy(startMonth)} até ${ddmmyyyy(endMonth)}\n` +
        `Travar deflação: ${locked ? "SIM" : "NÃO"}\n` +
        `Fator bruto: ${rawFactor}\n` +
        `Fator aplicado: ${factor}\n`;

      setStatus("Cálculo concluído com sucesso.", "ok");
      return;
    }

    // --------- CASO ANUAL (ano a ano) ---------
    yearWrap.style.display = "block";

    // monta aniversários: start+1, start+2, ... até o ano atual + 1 (para mostrar um futuro)
    const annivs = [];
    let k = 1;
    while (true) {
      const a = addYears(start, k);
      annivs.push(a);
      // Para não lotar: até (ano atual + 1) no máximo
      if (a.getFullYear() > today.getFullYear() + 1) break;
      k++;
      if (k > 60) break; // segurança
    }

    // vamos calcular até o último aniversário cujo "mês anterior" já chegou (<= hoje)
    // mas também queremos exibir 1 futuro como "Sem dados"
    const lastToShow = annivs[annivs.length - 1];
    const endNeeded = firstOfMonth(addMonths(lastToShow, -1));

    // busca dados apenas até o mês atual (o que existir)
    const fetchEnd = endNeeded > todayMonth ? todayMonth : endNeeded;

    let payload = { url: "—", data: [] };
    if (fetchEnd >= startMonth) {
      payload = await fetchSGSViaAPI(code, startMonth, fetchEnd);
    }

    // monta mapa mês -> valor
    const monthMap = new Map();
    for (const row of payload.data) {
      // row.data = "01/11/2025"
      const d = parseDateBR(row.data);
      if (!d) continue;
      monthMap.set(monthKey(firstOfMonth(d)), Number(String(row.valor).replace(",", ".")));
    }

    const availableMonths = Array.from(monthMap.keys()).sort();
    const lastAvailableKey = availableMonths.length ? availableMonths[availableMonths.length - 1] : null;

    function hasAllMonths(aMonth, bMonth) {
      const ms = monthsBetweenInclusive(aMonth, bMonth);
      for (const m of ms) {
        if (!monthMap.has(monthKey(m))) return false;
      }
      return true;
    }

    function factorBetweenMonths(aMonth, bMonth) {
      // aMonth..bMonth inclusive
      const ms = monthsBetweenInclusive(aMonth, bMonth);
      let factor = 1;
      const lines = [];
      for (const m of ms) {
        const key = monthKey(m);
        const v = monthMap.get(key);
        if (!Number.isFinite(v)) return null;
        factor *= 1 + v / 100;
        lines.push(`${formatDateBR(m)}: ${nfPct.format(v)}%`);
      }
      return { factor, lines };
    }

    const rows = [];
    let runningRent = rent0;
    let lastCalcLines = [];
    let lastCalcDiag = "";

    for (const a of annivs) {
      const ref = a; // data do reajuste (aniversário)
      const endMonth = firstOfMonth(addMonths(ref, -1));

      // futuro (sem dados)
      if (endMonth > todayMonth) {
        rows.push({
          ano: ref.getFullYear(),
          ref: formatDateBR(ref),
          periodo: "—",
          variacao: "—",
          novoAluguel: "—",
          status: "Sem dados",
          statusClass: "warn",
        });
        continue;
      }

      // se não temos base suficiente
      if (!lastAvailableKey) {
        rows.push({
          ano: ref.getFullYear(),
          ref: formatDateBR(ref),
          periodo: "—",
          variacao: "—",
          novoAluguel: "—",
          status: "Sem dados",
          statusClass: "warn",
        });
        continue;
      }

      // período anual: do mês do início até o mês anterior ao aniversário
      const periodStart = startMonth;
      const periodEnd = endMonth;

      // checa se todos os meses existem
      if (!hasAllMonths(periodStart, periodEnd)) {
        rows.push({
          ano: ref.getFullYear(),
          ref: formatDateBR(ref),
          periodo: `${ddmmyyyy(periodStart)} até ${ddmmyyyy(periodEnd)}`,
          variacao: "—",
          novoAluguel: "—",
          status: "Sem dados",
          statusClass: "warn",
        });
        continue;
      }

      const calc = factorBetweenMonths(periodStart, periodEnd);
      if (!calc) {
        rows.push({
          ano: ref.getFullYear(),
          ref: formatDateBR(ref),
          periodo: `${ddmmyyyy(periodStart)} até ${ddmmyyyy(periodEnd)}`,
          variacao: "—",
          novoAluguel: "—",
          status: "Sem dados",
          statusClass: "warn",
        });
        continue;
      }

      const rawFactor = calc.factor;
      let factor = rawFactor;
      if (locked && factor < 1) factor = 1;

      const variation = (factor - 1) * 100;
      const newRent = runningRent * factor;

      rows.push({
        ano: ref.getFullYear(),
        ref: formatDateBR(ref),
        periodo: `${ddmmyyyy(periodStart)} até ${ddmmyyyy(periodEnd)}`,
        variacao: `${nfPct.format(variation)}%`,
        novoAluguel: formatBRL(newRent),
        status: "OK",
        statusClass: "ok",
        _factor: factor,
        _rawFactor: rawFactor,
        _lines: calc.lines,
      });

      runningRent = newRent;
      lastCalcLines = calc.lines;

      lastCalcDiag =
        `URL consultada:\n${payload.url}\n\n` +
        `Índice: ${cfg.name} (SGS ${code})\n` +
        `Periodicidade: Anual (ano a ano)\n` +
        `Período do último cálculo: ${ddmmyyyy(periodStart)} até ${ddmmyyyy(periodEnd)}\n` +
        `Travar deflação: ${locked ? "SIM" : "NÃO"}\n` +
        `Fator bruto (sem trava): ${rawFactor}\n` +
        `Fator aplicado: ${factor}\n`;
    }

    renderYearRows(rows);

    // KPI superior = último OK
    const lastOK = mostRecentWithData(rows);
    if (!lastOK) {
      outDate.textContent = "—";
      outVar.textContent = "—";
      outFactor.textContent = "—";
      outRent.textContent = "—";
      outList.textContent = "—";
      diagEl.textContent =
        `Sem dados ainda.\n\n` +
        `Índice: ${cfg.name} (SGS ${code})\n` +
        `Obs.: o período pode estar no futuro ou a série não retornou todos os meses.\n`;
      setStatus("Não foi possível calcular: não há dados suficientes para o período.", "err");
      return;
    }

    outDate.textContent = lastOK.ref;
    outVar.textContent = lastOK.variacao;
    outFactor.textContent = Number(lastOK._factor).toLocaleString("pt-BR", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    });
    outRent.textContent = lastOK.novoAluguel;

    outList.textContent = (lastOK._lines || []).join("\n") || "—";
    diagEl.textContent = lastCalcDiag || "—";

    setStatus("Cálculo concluído. Reajustes futuros aparecem como “Sem dados”.", "ok");
  } catch (err) {
    console.error(err);
    setStatus(`Erro: ${err.message}`, "err");
    outDate.textContent = "—";
    outVar.textContent = "—";
    outFactor.textContent = "—";
    outRent.textContent = "—";
    outList.textContent = "—";
    diagEl.textContent = "—";
    if (yearBody) yearBody.innerHTML = "";
    if (yearWrap) yearWrap.style.display = "none";
  } finally {
    btnEl.disabled = false;
  }
});
