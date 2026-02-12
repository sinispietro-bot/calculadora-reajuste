// /assets/reajuste.js
(() => {
  const nfBRL = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
  const nfPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });

  function parseBRL(str){
    if(!str) return NaN;
    // "10000" => 10000 (reais)
    // "10.000,00" => 10000
    // "R$ 10.000,00" => 10000
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

  function ddmmyyyy(d){
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function firstOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addMonths(d, months){ return new Date(d.getFullYear(), d.getMonth() + months, d.getDate()); }
  function addYears(d, years){ return new Date(d.getFullYear() + years, d.getMonth(), d.getDate()); }

  function monthKey(d){
    // YYYY-MM
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  // Séries percentuais mensais (como no seu código que funcionava)
  const SERIES = {
    189: { name: 'IGP-M (FGV)', kind: 'pct' },
    190: { name: 'IGP-DI (FGV)', kind: 'pct' },
    433: { name: 'IPCA (IBGE)', kind: 'pct' },
    193: { name: 'IPC-FIPE', kind: 'pct' },
  };

  // via API (opção 2) - proxy no Vercel
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
    return data; // { urlBCB, data:[{data:"01/11/2024", valor:"0.34"}, ...] }
  }

  function buildMonthMapPct(list){
    // Converte retorno do BCB em mapa por mês (YYYY-MM) -> var %
    const map = new Map();
    for(const row of list){
      const v = Number(String(row.valor).replace(',','.'));
      if(!Number.isFinite(v)) continue;

      // row.data vem como "01/12/2024"
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.data || '');
      if(!m) continue;
      const mm = Number(m[2]);
      const yyyy = Number(m[3]);
      const key = `${yyyy}-${String(mm).padStart(2,'0')}`;
      map.set(key, v);
    }
    return map;
  }

  function monthsBetweenInclusive(aFirstMonth, bFirstMonth){
    // retorna lista de datas (primeiro dia do mês) de a..b inclusive
    const out = [];
    let cur = new Date(aFirstMonth.getFullYear(), aFirstMonth.getMonth(), 1);
    const end = new Date(bFirstMonth.getFullYear(), bFirstMonth.getMonth(), 1);
    while(cur <= end){
      out.push(new Date(cur.getFullYear(), cur.getMonth(), 1));
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    }
    return out;
  }

  function computeFactorForMonths(monthMapPct, monthsList){
    // fator = Π(1 + v/100)
    let factor = 1;
    const lines = [];
    for(const m of monthsList){
      const key = monthKey(m);
      if(!monthMapPct.has(key)){
        return { ok:false, factor:NaN, lines, missing:key };
      }
      const v = monthMapPct.get(key);
      factor *= (1 + v/100);

      // mostra como "01/mm/aaaa"
      const dLabel = `01/${String(m.getMonth()+1).padStart(2,'0')}/${m.getFullYear()}`;
      lines.push(`${dLabel}: ${nfPct.format(v)}%`);
    }
    return { ok:true, factor, lines, missing:null };
  }

  // ===== UI bindings =====
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
  const yearRows = document.getElementById('yearRows');

  maskDateInput(startEl);

  // máscara de moeda correta: formata AO SAIR do campo
  rentEl.addEventListener('blur', () => {
    const n = parseBRL(rentEl.value);
    if(Number.isFinite(n)) rentEl.value = formatBRL(n);
  });

  function setStatus(msg, kind){
    statusEl.classList.remove('ok','err','warn');
    if(kind) statusEl.classList.add(kind);
    statusEl.innerHTML = msg;
  }

  function resetOutputs(){
    outDate.textContent = '—';
    outVar.textContent = '—';
    outFactor.textContent = '—';
    outRent.textContent = '—';
    outList.textContent = '—';
    diagEl.textContent = '—';
    if(yearRows){
      yearRows.innerHTML = `<tr><td colspan="6" class="muted">—</td></tr>`;
    }
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  btnEl.addEventListener('click', async () => {
    try{
      btnEl.disabled = true;
      setStatus('Calculando... consultando o BCB.', null);
      resetOutputs();

      const rent0 = parseBRL(rentEl.value);
      if(!Number.isFinite(rent0) || rent0 <= 0) throw new Error('Informe um valor de aluguel válido.');

      const start = parseDateBR(startEl.value);
      if(!start) throw new Error('Informe a data de início no formato dd/mm/aaaa.');

      const code = Number(idxEl.value);
      const cfg = SERIES[code];
      if(!cfg) throw new Error('Índice inválido.');

      const freq = freqEl.value; // monthly | annual
      const locked = lockEl.checked;

      const today = new Date(); // usa data atual do navegador

      // ===== MENSAL: mantém 1 reajuste =====
      if(freq === 'monthly'){
        const reajusteDate = addMonths(start, 1);
        const startMonth = firstOfMonth(start);
        const endMonth = firstOfMonth(addMonths(reajusteDate, -1)); // mês anterior ao reajuste

        const monthsSpan =
          (endMonth.getFullYear()-startMonth.getFullYear())*12 +
          (endMonth.getMonth()-startMonth.getMonth()) + 1;

        if(monthsSpan <= 0) throw new Error('O período calculado ficou inválido. Verifique a data de início.');
        if(monthsSpan > 120) throw new Error('Por segurança, limite de 10 anos (120 meses).');

        // se reajuste for no futuro, pode não ter dado
        const api = await fetchSGSviaAPI(code, startMonth, endMonth);
        const map = buildMonthMapPct(api.data);
        const monthsList = monthsBetweenInclusive(startMonth, endMonth);
        const { ok, factor: rawFactor, lines, missing } = computeFactorForMonths(map, monthsList);

        if(!ok){
          setStatus(`Sem dados do BCB para este período ainda (mês faltando: ${missing}).`, 'warn');
          diagEl.textContent =
            `Período: ${ddmmyyyy(startMonth)} até ${ddmmyyyy(endMonth)}\n` +
            `Observação: o BCB ainda não disponibilizou todos os meses.\n` +
            `URL BCB (por trás):\n${api.urlBCB || '—'}`;
          return;
        }

        let factor = rawFactor;
        if(locked && factor < 1) factor = 1;

        const variation = (factor - 1) * 100;
        const newRent = rent0 * factor;

        outDate.textContent = formatDateBR(reajusteDate);
        outVar.textContent = `${nfPct.format(variation)}%`;
        outFactor.textContent = factor.toLocaleString('pt-BR', { minimumFractionDigits:6, maximumFractionDigits:6 });
        outRent.textContent = formatBRL(newRent);
        outList.textContent = lines.join('\n') || '—';

        diagEl.textContent =
          `Índice: ${cfg.name} (SGS ${code})\n` +
          `Periodicidade: Mensal\n` +
          `Período: ${ddmmyyyy(startMonth)} até ${ddmmyyyy(endMonth)}\n` +
          `Travar deflação: ${locked ? 'SIM' : 'NÃO'}\n` +
          `Fator aplicado: ${factor}\n` +
          `URL BCB (por trás):\n${api.urlBCB || '—'}`;

        setStatus('Cálculo concluído com sucesso.', 'ok');
        return;
      }

      // ===== ANUAL: ano a ano =====
      // Reajustes: aniversários 1,2,3... até hoje (e também mostra o próximo futuro como "Sem dados")
      const maxYears = 10; // segurança
      const anniversaries = [];
      for(let y=1; y<=maxYears; y++){
        const ann = addYears(start, y);
        anniversaries.push({ y, date: ann, isFuture: ann > today });
      }

      // separa: aniversários já ocorridos (<= hoje)
      const occurred = anniversaries.filter(a => !a.isFuture);

      // se nenhum ocorreu ainda (contrato começou no futuro ou muito recente), mostra o primeiro futuro como aviso
      // mas você pediu explicitamente: se for futuro e não tiver índice, mostrar mensagem.
      const showFutureOne = anniversaries.find(a => a.isFuture) || null;

      // vamos montar "linhas" a exibir:
      // - todas as ocorridas
      // - + 1 futura (a próxima) pra avisar "sem dados"
      const rowsPlan = [...occurred];
      if(showFutureOne) rowsPlan.push(showFutureOne);

      // se nem ocorreu e nem existe futura (impossível), erro
      if(!rowsPlan.length) throw new Error('Não foi possível montar os reajustes para a data informada.');

      // Para calcular rápido: buscar do mês inicial até o mês anterior ao ÚLTIMO reajuste ocorrido.
      // Assim calculamos ano a ano sem várias chamadas.
      let api = null;
      let monthMap = new Map();
      let fetchedStart = null;
      let fetchedEnd = null;

      if(occurred.length){
        const lastOcc = occurred[occurred.length-1].date;
        fetchedStart = firstOfMonth(start);
        fetchedEnd = firstOfMonth(addMonths(lastOcc, -1)); // mês anterior ao último reajuste ocorrido

        const monthsSpan =
          (fetchedEnd.getFullYear()-fetchedStart.getFullYear())*12 +
          (fetchedEnd.getMonth()-fetchedStart.getMonth()) + 1;

        if(monthsSpan <= 0) throw new Error('O período calculado ficou inválido. Verifique a data de início.');
        if(monthsSpan > 120) throw new Error('Por segurança, limite de 10 anos (120 meses).');

        api = await fetchSGSviaAPI(code, fetchedStart, fetchedEnd);
        monthMap = buildMonthMapPct(api.data);
      }

      // agora calculamos ano a ano:
      // Período do ano 1: mês do start até mês anterior ao ann1
      // Período do ano 2: mês do ann1 até mês anterior ao ann2
      // ...
      let currentRent = rent0;
      let lastAnn = start; // para o primeiro período, começa no start
      let lastLines = [];
      let lastComputed = null;

      // render tabela
      if(yearRows) yearRows.innerHTML = '';

      for(const r of rowsPlan){
        const annDate = r.date;
        const yearLabel = String(annDate.getFullYear());

        const periodStartMonth = firstOfMonth(lastAnn);
        const periodEndMonth = firstOfMonth(addMonths(annDate, -1)); // mês anterior ao reajuste

        // se for futuro -> não calcula, só sinaliza
        if(r.isFuture){
          if(yearRows){
            yearRows.insertAdjacentHTML('beforeend', `
              <tr>
                <td>${escapeHtml(yearLabel)}</td>
                <td>${escapeHtml(formatDateBR(annDate))}</td>
                <td class="muted">—</td>
                <td class="muted">—</td>
                <td class="muted">—</td>
                <td><span class="pillSmall">Sem dados ainda</span></td>
              </tr>
            `);
          }
          continue;
        }

        // precisa ter API carregada (ocorreu >=1)
        if(!api){
          throw new Error('Não foi possível consultar o BCB para os reajustes anuais.');
        }

        // meses do período
        const monthsList = monthsBetweenInclusive(periodStartMonth, periodEndMonth);

        const { ok, factor: rawFactor, lines, missing } = computeFactorForMonths(monthMap, monthsList);

        if(!ok){
          // isso pode acontecer se o BCB tiver buraco ou se por algum motivo faltou mês
          if(yearRows){
            yearRows.insertAdjacentHTML('beforeend', `
              <tr>
                <td>${escapeHtml(yearLabel)}</td>
                <td>${escapeHtml(formatDateBR(annDate))}</td>
                <td>${escapeHtml(ddmmyyyy(periodStartMonth))} até ${escapeHtml(ddmmyyyy(periodEndMonth))}</td>
                <td class="muted">—</td>
                <td class="muted">—</td>
                <td><span class="pillSmall">Dados incompletos (${escapeHtml(missing)})</span></td>
              </tr>
            `);
          }
          // não atualiza lastAnn nem rent (pois não foi calculado)
          continue;
        }

        let factor = rawFactor;
        if(locked && factor < 1) factor = 1;

        const variation = (factor - 1) * 100;
        const newRent = currentRent * factor;

        // tabela
        if(yearRows){
          yearRows.insertAdjacentHTML('beforeend', `
            <tr>
              <td>${escapeHtml(yearLabel)}</td>
              <td>${escapeHtml(formatDateBR(annDate))}</td>
              <td>${escapeHtml(ddmmyyyy(periodStartMonth))} até ${escapeHtml(ddmmyyyy(periodEndMonth))}</td>
              <td>${escapeHtml(nfPct.format(variation))}%</td>
              <td><b>${escapeHtml(formatBRL(newRent))}</b></td>
              <td><span class="pillSmall">OK</span></td>
            </tr>
          `);
        }

        // guarda “último calculado” para os KPIs principais
        lastComputed = { annDate, variation, factor, newRent };
        lastLines = lines;

        // prepara próximo ano
        currentRent = newRent;
        lastAnn = annDate;
      }

      // se não teve nenhum cálculo “OK”
      if(!lastComputed){
        setStatus('Não há dados suficientes para calcular os reajustes anuais até o momento.', 'warn');
        diagEl.textContent =
          `Índice: ${cfg.name} (SGS ${code})\n` +
          `Periodicidade: Anual\n` +
          `Observação: sem meses suficientes/dados incompletos no BCB.\n` +
          (api?.urlBCB ? `URL BCB (por trás):\n${api.urlBCB}\n` : '');
        return;
      }

      // KPIs principais (mostram o último reajuste efetivamente calculado)
      outDate.textContent = formatDateBR(lastComputed.annDate);
      outVar.textContent = `${nfPct.format(lastComputed.variation)}%`;
      outFactor.textContent = lastComputed.factor.toLocaleString('pt-BR', { minimumFractionDigits:6, maximumFractionDigits:6 });
      outRent.textContent = formatBRL(lastComputed.newRent);
      outList.textContent = (lastLines || []).join('\n') || '—';

      // status: se existe uma linha futura planejada, avisa
      if(showFutureOne){
        setStatus('Cálculo concluído. Reajustes futuros aparecem como “Sem dados ainda”.', 'ok');
      }else{
        setStatus('Cálculo concluído com sucesso.', 'ok');
      }

      // diagnóstico
      if(api){
        diagEl.textContent =
          `Índice: ${cfg.name} (SGS ${code})\n` +
          `Periodicidade: Anual (ano a ano)\n` +
          `Período consultado no BCB: ${ddmmyyyy(fetchedStart)} até ${ddmmyyyy(fetchedEnd)}\n` +
          `Travar deflação: ${locked ? 'SIM' : 'NÃO'}\n` +
          `URL BCB (por trás):\n${api.urlBCB || '—'}`;
      } else {
        diagEl.textContent =
          `Índice: ${cfg.name} (SGS ${code})\n` +
          `Periodicidade: Anual (ano a ano)\n` +
          `Observação: nenhum reajuste ocorrido ainda. Próximo reajuste será exibido como “Sem dados ainda”.`;
      }

    }catch(err){
      console.error(err);
      setStatus(`Erro: ${err.message}`, 'err');
      resetOutputs();
    }finally{
      btnEl.disabled = false;
    }
  });
})();
