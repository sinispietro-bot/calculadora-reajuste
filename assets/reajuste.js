const nfBRL = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const nfPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });

function parseBRL(str){
  if(!str) return NaN;
  const s = String(str).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',', '.');
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
function addMonths(d, m){ return new Date(d.getFullYear(), d.getMonth()+m, d.getDate()); }
function addYears(d, y){ return new Date(d.getFullYear()+y, d.getMonth(), d.getDate()); }
function ddmmyyyy(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function fetchSGS(seriesCode, startDate, endDate){
  const url = new URL(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados`);
  url.searchParams.set('formato','json');
  url.searchParams.set('dataInicial', ddmmyyyy(startDate));
  url.searchParams.set('dataFinal', ddmmyyyy(endDate));

  const res = await fetch(url.toString(), { headers: { 'Accept':'application/json' } });
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error(`Falha ao consultar BCB (HTTP ${res.status}). ${txt ? txt.slice(0,160) : ''}`);
  }
  const data = await res.json();
  if(!Array.isArray(data)) throw new Error('Resposta inesperada do BCB.');
  return { url: url.toString(), data };
}

function computeAccumFromPct(list){
  let factor = 1;
  const lines = [];
  for(const row of list){
    const v = Number(String(row.valor).replace(',','.'));
    if(!Number.isFinite(v)) continue;
    factor *= (1 + v/100);
    lines.push(`${row.data}: ${nfPct.format(v)}%`);
  }
  return { factor, lines };
}

(function init(){
  const rentEl  = document.getElementById('rent');
  const idxEl   = document.getElementById('idx');
  const startEl = document.getElementById('start');
  const freqEl  = document.getElementById('freq');
  const lockEl  = document.getElementById('lock');
  const btnEl   = document.getElementById('btn');

  const statusEl  = document.getElementById('status');
  const diagEl    = document.getElementById('diag');
  const outDate   = document.getElementById('outDate');
  const outVar    = document.getElementById('outVar');
  const outFactor = document.getElementById('outFactor');
  const outRent   = document.getElementById('outRent');
  const outList   = document.getElementById('outList');

  if(!rentEl) return; // só roda na página da calculadora

  maskDateInput(startEl);

  rentEl.addEventListener('blur', () => {
    const n = parseBRL(rentEl.value);
    if(Number.isFinite(n)) rentEl.value = formatBRL(n);
  });

  function setStatus(msg, kind){
    statusEl.classList.remove('ok','err');
    if(kind) statusEl.classList.add(kind);
    statusEl.innerHTML = msg;
  }

  btnEl.addEventListener('click', async () => {
    try{
      btnEl.disabled = true;
      setStatus('Calculando... consultando o BCB.', null);

      const rent = parseBRL(rentEl.value);
      if(!Number.isFinite(rent) || rent <= 0) throw new Error('Informe um valor de aluguel válido.');

      const start = parseDateBR(startEl.value);
      if(!start) throw new Error('Informe a data de início no formato dd/mm/aaaa.');

      const code = Number(idxEl.value);
      const freq = freqEl.value; // monthly | annual
      const reajusteDate = (freq === 'monthly') ? addMonths(start, 1) : addYears(start, 1);

      const startMonth = firstOfMonth(start);
      const endMonth = firstOfMonth(addMonths(reajusteDate, -1)); // mês anterior ao reajuste

      const monthsSpan = (endMonth.getFullYear()-startMonth.getFullYear())*12 + (endMonth.getMonth()-startMonth.getMonth()) + 1;
      if(monthsSpan <= 0) throw new Error('Período inválido. Verifique a data de início.');
      if(monthsSpan > 120) throw new Error('Este site limita o período a 10 anos (120 meses).');

      const { url, data } = await fetchSGS(code, startMonth, endMonth);
      if(!data.length) throw new Error('O BCB não retornou dados para este período/índice.');

      const { factor: rawFactor, lines } = computeAccumFromPct(data);

      let factor = rawFactor;
      if(lockEl.checked && factor < 1) factor = 1;

      const variation = (factor - 1) * 100;
      const newRent = rent * factor;

      outDate.textContent = formatDateBR(reajusteDate);
      outVar.textContent = `${nfPct.format(variation)}%`;
      outFactor.textContent = factor.toLocaleString('pt-BR', { minimumFractionDigits:6, maximumFractionDigits:6 });
      outRent.textContent = formatBRL(newRent);
      outList.textContent = lines.join('\n') || '—';

      diagEl.textContent =
        `URL consultada:\n${url}\n\n` +
        `Periodicidade: ${freq === 'annual' ? 'Anual' : 'Mensal'}\n` +
        `Período considerado: ${ddmmyyyy(startMonth)} até ${ddmmyyyy(endMonth)}\n` +
        `Meses: ${monthsSpan}\n` +
        `Travar deflação: ${lockEl.checked ? 'SIM' : 'NÃO'}\n` +
        `Fator bruto: ${rawFactor}\n` +
        `Fator aplicado: ${factor}\n`;

      setStatus('Cálculo concluído com sucesso.', 'ok');

    }catch(err){
      console.error(err);
      setStatus(`Erro: ${err.message}`, 'err');
      outDate.textContent = '—';
      outVar.textContent = '—';
      outFactor.textContent = '—';
      outRent.textContent = '—';
      outList.textContent = '—';
      diagEl.textContent = '—';
    }finally{
      btnEl.disabled = false;
    }
  });
})();
