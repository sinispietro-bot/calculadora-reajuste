// ========= Helpers (formatação / parsing) =========
const nfBRL = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const nfPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });

function parseBRL(str){
  if(!str) return NaN;
  const s = String(str)
    .replace(/[R$\s]/g,'')
    .replace(/\./g,'')
    .replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function formatBRL(n){ return nfBRL.format(n); }

function maskDateInput(el){
  el.addEventListener('input', () => {
    let v = el.value.replace(/\D/g,'').slice(0,8);
    if(v.length >= 5) el.value = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
    else if(v.length >= 3) el.value = v.slice(0,2) + '/' + v.slice(2);
    else el.value = v;
  });
}

function parseDateBR(str){
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str || '');
  if(!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  const d = new Date(yyyy, mm-1, dd);
  if(d.getFullYear() !== yyyy || d.getMonth() !== (mm-1) || d.getDate() !== dd) return null;
  return d;
}
function formatDateBR(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function firstOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, months){ return new Date(d.getFullYear(), d.getMonth()+months, d.getDate()); }
function addYears(d, years){ return new Date(d.getFullYear()+years, d.getMonth(), d.getDate()); }

function toISODate(d){
  // YYYY-MM-DD
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function monthSpanInclusive(a, b){
  return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()) + 1;
}

// ========= Séries =========
const SERIES = {
  189: { name: 'IGP-M (FGV)', kind: 'pct' },
  190: { name: 'IGP-DI (FGV)', kind: 'pct' },
  433: { name: 'IPCA (IBGE)', kind: 'pct' },
  193: { name: 'IPC-FIPE', kind: 'pct' },
};

// ========= API (via /api/sgs) =========
async function fetchSGSviaApi(seriesCode, startDate, endDate){
  const url = new URL('/api/sgs', window.location.origin);
  url.searchParams.set('serie', String(seriesCode));
  url.searchParams.set('start', toISODate(startDate));
  url.searchParams.set('end', toISODate(endDate));

  const res = await fetch(url.toString(), { headers: { 'Accept':'application/json' }});
  if(!res.ok){
    const j = await res.json().catch(()=> ({}));
    throw new Error(j?.error || `Falha ao consultar API (HTTP ${res.status})`);
  }
  const j = await res.json();
  if(!j || !Array.isArray(j.data)) throw new Error('Resposta inesperada da API.');
  return { url: j.url || url.toString(), data: j.data };
}

function computeAccumFromPct(list){
  // list: [{data:"01/12/2024", valor:"0,34"}, ...]
  let factor = 1;
  const lines = [];
  for(const row of list){
    const v = Number(String(row.valor).replace(',','.'));
    if(!Number.isFinite(v)) continue;
    factor *= (1 + (v/100));
    lines.push(`${row.data}: ${nfPct.format(v)}%`);
  }
  return { factor, lines };
}

function lastDataDate(list){
  // lista vem em ordem crescente normalmente, mas garantimos:
  const last = list && list.length ? list[list.length-1] : null;
  if(!last?.data) return null;
  // dd/mm/yyyy
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(last.data);
  if(!m) return null;
  return new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));
}

// ========= UI =========
const rentEl = document.getElementById('rent');
const idxEl  = document.getElementById('idx');
const startEl= document.getElementById('start');
const freqEl = document.getElementById('freq');
const lockEl = document.getElementById('lock');
const btnEl  = document.getElementById('btn');
const statusEl = document.getElementById('status');
const diagEl = document.getElementById('diag');

const outRef = document.getElementById('outRef');
const outVar = document.getElementById('outVar');
const outFactor = document.getElementById('outFactor');
const outRent = document.getElementById('outRent');

const outList = document.getElementById('outList');      // meses do último cálculo
const yyBody  = document.getElementById('yyBody');       // ano a ano container

maskDateInput(startEl);

// Máscara de moeda (estável):
// - No foco: deixa “cru” para digitar
// - No blur: formata BRL
let rentRaw = '';
rentEl.addEventListener('focus', () => {
  // remove R$ e separadores, deixa apenas números e vírgula/ponto
  rentRaw = rentEl.value;
  const n = parseBRL(rentEl.value);
  rentEl.value = Number.isFinite(n) ? String(n).replace('.', ',') : rentEl.value.replace(/[R$\s]/g,'');
  rentEl.select?.();
});
rentEl.addEventListener('blur', () => {
  const n = parseBRL(rentEl.value);
  if(Number.isFinite(n)) rentEl.value = formatBRL(n);
  else rentEl.value = rentRaw || rentEl.value;
});

function setStatus(msg, kind){
  statusEl.classList.remove('ok','err');
  if(kind) statusEl.classList.add(kind);
  statusEl.innerHTML = msg;
}

function clearOutputs(){
  outRef.textContent = '—';
  outVar.textContent = '—';
  outFactor.textContent = '—';
  outRent.textContent = '—';
  outList.textContent = '—';
  diagEl.textContent = '—';
  yyBody.innerHTML = '';
}

function fmtFactor(f){
  return f.toLocaleString('pt-BR', { minimumFractionDigits:6, maximumFractionDigits:6 });
}

function renderYearRow({ year, refDate, periodText, variationText, rentText, statusKind, statusText }){
  const row = document.createElement('div');
  row.className = 'yyRow';

  row.innerHTML = `
    <div class="col-year"><b>${year}</b></div>
    <div class="col-date">
      <b>${refDate}</b>
      ${periodText ? `<div class="muted">${periodText}</div>` : ``}
    </div>
    <div class="col-period">
      ${periodText ? `<div class="muted"><b>Período:</b> ${periodText}</div>` : `<div class="muted">—</div>`}
    </div>
    <div class="col-var"><b>${variationText || '—'}</b></div>
    <div class="col-rent"><b>${rentText || '—'}</b></div>
    <div class="col-status">
      <span class="yyStatus ${statusKind}">${statusText}</span>
    </div>
  `;

  yyBody.appendChild(row);
}

async function computeOnePeriod({ rent, code, startMonth, endMonth, lockDeflation }){
  const span = monthSpanInclusive(startMonth, endMonth);
  if(span <= 0) throw new Error('Período inválido (span <= 0).');
  if(span > 120) throw new Error('Limite de segurança: até 10 anos (120 meses).');

  const { url, data } = await fetchSGSviaApi(code, startMonth, endMonth);

  // Se não veio dado nenhum: “Sem dados”
  if(!data.length){
    return { ok:false, reason:'SEM_DADOS', url, span, startMonth, endMonth };
  }

  // Checa se o último ponto cobre o mês final (quando é futuro, geralmente fica faltando)
  const last = lastDataDate(data);
  const endCheck = new Date(endMonth.getFullYear(), endMonth.getMonth(), 1);
  if(!last || (last.getFullYear() < endCheck.getFullYear()) || (last.getMonth() < endCheck.getMonth())){
    return { ok:false, reason:'SEM_DADOS', url, span, startMonth, endMonth };
  }

  const { factor: rawFactor, lines } = computeAccumFromPct(data);

  let factor = rawFactor;
  if(lockDeflation && factor < 1) factor = 1;

  const variation = (factor - 1) * 100;
  const newRent = rent * factor;

  return {
    ok:true,
    url,
    span,
    startMonth,
    endMonth,
    rawFactor,
    factor,
    variation,
    newRent,
    lines
  };
}

btnEl.addEventListener('click', async () => {
  try{
    btnEl.disabled = true;
    setStatus('Calculando... consultando dados oficiais.', null);

    clearOutputs();

    const rent = parseBRL(rentEl.value);
    if(!Number.isFinite(rent) || rent <= 0) throw new Error('Informe um valor de aluguel válido.');

    const start = parseDateBR(startEl.value);
    if(!start) throw new Error('Informe a data de início no formato dd/mm/aaaa.');

    const code = Number(idxEl.value);
    const cfg = SERIES[code];
    if(!cfg) throw new Error('Índice inválido.');

    const freq = freqEl.value; // annual | monthly
    const lockDeflation = lockEl.checked;

    const now = new Date();

    // ========= ANUAL (ano a ano) =========
    if(freq === 'annual'){
      // Vamos calcular todos os aniversários até o último já “passado”
      // e incluir 1 próximo futuro (para aparecer "Sem dados" quando não houver índice).
      const anniversaries = [];
      for(let i=1; i<=20; i++){
        const ann = addYears(start, i);
        anniversaries.push(ann);

        // para em “passado + 1 futuro”
        if(ann > now){
          break;
        }
      }

      // Se todos os ann ainda são futuros (ex: contrato começou no futuro), ainda assim mostramos o primeiro
      if(!anniversaries.length) anniversaries.push(addYears(start, 1));

      let lastOk = null;

      yyBody.innerHTML = `
        <div class="yyHeader">
          <div>Ano</div>
          <div>Data do reajuste</div>
          <div>Período considerado</div>
          <div>Variação</div>
          <div>Novo aluguel</div>
          <div>Status</div>
        </div>
      `;

      for(let i=1; i<=anniversaries.length; i++){
        const ann = anniversaries[i-1]; // data do reajuste (referência)
        const startMonth = firstOfMonth(addYears(start, i-1));
        const endMonth   = firstOfMonth(addMonths(ann, -1));

        const periodText = `${formatDateBR(startMonth)} até ${formatDateBR(endMonth)}`;

        const r = await computeOnePeriod({ rent, code, startMonth, endMonth, lockDeflation });

        if(!r.ok){
          renderYearRow({
            year: ann.getFullYear(),
            refDate: formatDateBR(ann),
            periodText,
            variationText: '—',
            rentText: '—',
            statusKind: 'nodata',
            statusText: 'Sem dados'
          });
          continue;
        }

        lastOk = { ann, ...r };

        renderYearRow({
          year: ann.getFullYear(),
          refDate: formatDateBR(ann),
          periodText,
          variationText: `${nfPct.format(r.variation)}%`,
          rentText: formatBRL(r.newRent),
          statusKind: 'ok',
          statusText: 'OK'
        });
      }

      if(!lastOk){
        setStatus('Sem dados disponíveis para o período escolhido (reajustes futuros ou índice ainda não publicado).', 'err');
        return;
      }

      // “Último reajuste calculado” = último que deu OK
      outRef.textContent = formatDateBR(lastOk.ann);
      outVar.textContent = `${nfPct.format(lastOk.variation)}%`;
      outFactor.textContent = fmtFactor(lastOk.factor);
      outRent.textContent = formatBRL(lastOk.newRent);

      outList.textContent = lastOk.lines.join('\n') || '—';

      diagEl.textContent =
        `URL consultada:\n${lastOk.url}\n\n` +
        `Índice: ${cfg.name} (SGS ${code})\n` +
        `Periodicidade: Anual (ano a ano)\n` +
        `Período do último cálculo: ${formatDateBR(lastOk.startMonth)} até ${formatDateBR(lastOk.endMonth)}\n` +
        `Meses: ${lastOk.span}\n` +
        `Travar deflação: ${lockDeflation ? 'SIM' : 'NÃO'}\n` +
        `Fator bruto: ${lastOk.rawFactor}\n` +
        `Fator aplicado: ${lastOk.factor}\n`;

      setStatus('Cálculo concluído. Reajustes futuros aparecem como “Sem dados”.', 'ok');
      return;
    }

    // ========= MENSAL (1 período) =========
    const reajusteDate = addMonths(start, 1);
    const startMonth = firstOfMonth(start);
    const endMonth = firstOfMonth(addMonths(reajusteDate, -1));

    const r = await computeOnePeriod({ rent, code, startMonth, endMonth, lockDeflation });

    if(!r.ok){
      setStatus('Sem dados disponíveis para o período escolhido (o índice pode não ter sido publicado ainda).', 'err');
      return;
    }

    outRef.textContent = formatDateBR(reajusteDate);
    outVar.textContent = `${nfPct.format(r.variation)}%`;
    outFactor.textContent = fmtFactor(r.factor);
    outRent.textContent = formatBRL(r.newRent);
    outList.textContent = r.lines.join('\n') || '—';

    // “ano a ano” não é exibido em mensal, então limpamos
    yyBody.innerHTML = '';

    diagEl.textContent =
      `URL consultada:\n${r.url}\n\n` +
      `Índice: ${cfg.name} (SGS ${code})\n` +
      `Periodicidade: Mensal\n` +
      `Período: ${formatDateBR(startMonth)} até ${formatDateBR(endMonth)}\n` +
      `Meses: ${r.span}\n` +
      `Travar deflação: ${lockDeflation ? 'SIM' : 'NÃO'}\n` +
      `Fator bruto: ${r.rawFactor}\n` +
      `Fator aplicado: ${r.factor}\n`;

    setStatus('Cálculo concluído com sucesso.', 'ok');

  }catch(err){
    console.error(err);
    setStatus(`Erro: ${err.message}`, 'err');
    clearOutputs();
  }finally{
    btnEl.disabled = false;
  }
});
