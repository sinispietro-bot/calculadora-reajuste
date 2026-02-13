// /assets/reajuste.js
(() => {
  const nfBRL = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
  const nfPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });

  function parseBRL(str){
    if(!str) return NaN;
    // aceita "10000", "10.000,00", "R$ 10.000,00"
    const s = String(str)
      .replace(/[R$\s]/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatBRL(n){
    return nfBRL.format(n);
  }

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

  function firstOfMonth(d){
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function addMonths(d, months){
    return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
  }

  function addYears(d, years){
    return new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
  }

  function ddmmyyyy(d){
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  // séries que você já tinha (e funcionava)
  const SERIES = {
    189: { name: 'IGP-M (FGV)', kind: 'pct' },
    190: { name: 'IGP-DI (FGV)', kind: 'pct' },
    433: { name: 'IPCA (IBGE)', kind: 'pct' },
    193: { name: 'IPC-FIPE', kind: 'pct' },
  };

  async function fetchSGSviaAPI(seriesCode, startDate, endDate){
    const start = ddmmyyyy(startDate);
    const end = ddmmyyyy(endDate);

    const url = `/api/sgs?serie=${encodeURIComponent(seriesCode)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const res = await fetch(url, { headers: { 'Accept':'application/json' } });
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      throw new Error(`Falha ao consultar API (HTTP ${res.status}). ${txt ? txt.slice(0,140) : ''}`);
    }
    const data = await res.json();
    if(!data || !Array.isArray(data.data)) throw new Error('Resposta inesperada da API.');
    return data; // { urlBCB, data: [...] }
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

  // pega elementos (só roda se estiver na página da calculadora)
  const rentEl = document.getElementById('rent');
  if(!rentEl) return;

  const idxEl  = document.getElementById('idx');
  const startEl= document.getElementById('start');
  const freqEl = document.getElementById('freq');
  const lockEl = document.getElementById('lock');
  const btnEl  = document.getElementById('btn');
  const statusEl = document.getElementById('status');
  const diagEl = document.getElementById('diag');

  const outDate = document.getElementById('outDate');
  const outVar = document.getElementById('outVar');
  const outFactor = document.getElementById('outFactor');
  const outRent = document.getElementById('outRent');
  const outList = document.getElementById('outList');

  // máscara de data
  maskDateInput(startEl);

  // máscara de moeda (igual ao seu código que funcionava)
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
      const cfg = SERIES[code];
      if(!cfg) throw new Error('Índice inválido.');

      const freq = freqEl.value; // monthly | annual
      const reajusteDate = (freq === 'monthly') ? addMonths(start, 1) : addYears(start, 1);

      // período: mês inicial até mês anterior ao reajuste
      const startMonth = firstOfMonth(start);
      const endMonth = firstOfMonth(addMonths(reajusteDate, -1));

      const monthsSpan =
        (endMonth.getFullYear()-startMonth.getFullYear())*12 +
        (endMonth.getMonth()-startMonth.getMonth()) + 1;

      if(monthsSpan <= 0) throw new Error('O período calculado ficou inválido. Verifique a data de início.');
      if(monthsSpan > 120) throw new Error('Por segurança, limite de 10 anos (120 meses).');

      const api = await fetchSGSviaAPI(code, startMonth, endMonth);
      const data = api.data;

      if(!data.length) throw new Error('O BCB não retornou dados para este período/índice.');

      const { factor: rawFactor, lines } = computeAccumFromPct(data);

      let factor = rawFactor;
      const locked = lockEl.checked;
      if(locked && factor < 1) factor = 1;

      const variation = (factor - 1) * 100;
      const newRent = rent * factor;

      outDate.textContent = formatDateBR(reajusteDate);
      outVar.textContent = `${nfPct.format(variation)}%`;
      outFactor.textContent = factor.toLocaleString('pt-BR', { minimumFractionDigits:6, maximumFractionDigits:6 });
      outRent.textContent = formatBRL(newRent);
      outList.textContent = lines.join('\n') || '—';

      diagEl.textContent =
        `URL consultada (API):\n${location.origin}/api/sgs?serie=${code}&start=${ddmmyyyy(startMonth)}&end=${ddmmyyyy(endMonth)}\n\n` +
        `URL BCB (por trás):\n${api.urlBCB || '—'}\n\n` +
        `Índice: ${cfg.name} (SGS ${code})\n` +
        `Periodicidade: ${freq === 'annual' ? 'Anual' : 'Mensal'}\n` +
        `Período: ${ddmmyyyy(startMonth)} até ${ddmmyyyy(endMonth)}\n` +
        `Meses: ${monthsSpan}\n` +
        `Travar deflação: ${locked ? 'SIM' : 'NÃO'}\n` +
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
