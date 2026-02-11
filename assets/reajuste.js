(function () {
  // roda só na página da calculadora
  const rentEl = document.getElementById('rentInput');
  if (!rentEl) return;

  const indexEl = document.getElementById('indexSelect');
  const startEl = document.getElementById('startDate');
  const periodicityEl = document.getElementById('periodicity');
  const lockEl = document.getElementById('lockDeflation');
  const btn = document.getElementById('calcBtn');
  const msgEl = document.getElementById('msg');

  const outReajuste = document.getElementById('outReajuste');
  const outVar = document.getElementById('outVar');
  const outFactor = document.getElementById('outFactor');
  const outNewRent = document.getElementById('outNewRent');
  const outInfo = document.getElementById('outInfo');
  const outDetails = document.getElementById('outDetails');
  const diagUrl = document.getElementById('diagUrl');
  const diagText = document.getElementById('diagText');

  const brMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Séries SGS (ajuste se quiser adicionar mais depois)
  // Observação: várias dessas séries vêm como NÍVEL (índice) no SGS.
  const SERIES = [
    { id: '189', label: 'IGP-M (FGV) — SGS 189' },
    { id: '190', label: 'IGP-DI (FGV) — SGS 190' },
    { id: '433', label: 'IPCA (IBGE) — SGS 433' },
    { id: '11773', label: 'IPC-FIPE — SGS 11773' },
  ];

  // popula select se estiver vazio
  if (indexEl && indexEl.options.length <= 1) {
    SERIES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      indexEl.appendChild(opt);
    });
    indexEl.value = '190';
  }

  // ---------- Máscara de moeda ----------
  // O usuário digita: 10000 -> vira R$ 10.000,00 ao sair do campo
  function onlyDigits(s){ return (s || '').replace(/\D+/g, ''); }

  function setMoneyFromDigits(el, digits){
    if (!digits) { el.value = ''; el.dataset.raw = ''; return; }
    const cents = parseInt(digits, 10);
    const value = cents / 100;
    el.dataset.raw = String(value);
    el.value = brMoney.format(value);
  }

  function parseMoney(el){
    // usa raw se existir; senão tenta extrair
    if (el.dataset.raw) return Number(el.dataset.raw);
    const d = onlyDigits(el.value);
    if (!d) return NaN;
    return parseInt(d, 10) / 100;
  }

  rentEl.addEventListener('focus', () => {
    // ao focar, mostra só número sem R$ pra facilitar digitar
    const val = parseMoney(rentEl);
    if (Number.isFinite(val)) rentEl.value = String(Math.round(val * 100) / 100).replace('.', ',');
  });
  rentEl.addEventListener('blur', () => {
    const d = onlyDigits(rentEl.value);
    setMoneyFromDigits(rentEl, d);
  });
  rentEl.addEventListener('input', () => {
    // permite digitar livre, mas mantém só números e vírgula visual
    // (não formata a cada tecla para não travar)
  });

  // ---------- Máscara de data dd/mm/aaaa ----------
  function formatDateInput(value){
    const d = onlyDigits(value).slice(0, 8);
    const p1 = d.slice(0,2);
    const p2 = d.slice(2,4);
    const p3 = d.slice(4,8);
    let out = p1;
    if (p2) out += '/' + p2;
    if (p3) out += '/' + p3;
    return out;
  }

  startEl.addEventListener('input', () => {
    const pos = startEl.selectionStart;
    startEl.value = formatDateInput(startEl.value);
    startEl.setSelectionRange(pos, pos);
  });

  function parseDateBR(s){
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s || '').trim());
    if (!m) return null;
    const dd = parseInt(m[1],10);
    const mm = parseInt(m[2],10);
    const yyyy = parseInt(m[3],10);
    const dt = new Date(Date.UTC(yyyy, mm-1, dd));
    // valida
    if (dt.getUTCFullYear() !== yyyy || (dt.getUTCMonth()+1) !== mm || dt.getUTCDate() !== dd) return null;
    return dt;
  }

  function toISODateUTC(d){
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const da = String(d.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }

  function firstDayOfMonthUTC(d){
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  function addMonthsUTC(d, months){
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+months, d.getUTCDate()));
  }
  function addYearsUTC(d, years){
    return new Date(Date.UTC(d.getUTCFullYear()+years, d.getUTCMonth(), d.getUTCDate()));
  }

  function monthNamePt(mIndex){
    const names = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return names[mIndex] || '';
  }

  function setMsg(type, text){
    msgEl.className = 'msg ' + (type || '');
    msgEl.textContent = text;
  }

  function resetOutputs(){
    outReajuste.textContent = '—';
    outVar.textContent = '—';
    outFactor.textContent = '—';
    outNewRent.textContent = '—';
    outInfo.textContent = 'Preencha os campos e clique em Calcular.';
    outDetails.textContent = '';
    diagUrl.textContent = '';
    diagText.textContent = '';
  }

  resetOutputs();

  async function fetchSGS(serie, startISO, endISO){
    const url = `/api/sgs?serie=${encodeURIComponent(serie)}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
    const r = await fetch(url, { headers: { 'Accept':'application/json' }});
    if (!r.ok) throw new Error(`Falha na API (/api/sgs): ${r.status}`);
    const j = await r.json();
    return j; // {url, data}
  }

  function parseValorToNumber(v){
    // SGS geralmente vem como string "1171.2100" ou "0,34"
    const s = String(v ?? '').trim().replace(/\./g,'').replace(',', '.'); // remove milhar e troca vírgula por ponto
    // mas se vier "1171.2100" (ponto decimal), o replace acima removeu ponto. Então:
    // tratamos um caso: se original tem ponto e não tem vírgula, não remove.
    const orig = String(v ?? '').trim();
    if (orig.includes('.') && !orig.includes(',')) {
      return Number(orig);
    }
    return Number(s);
  }

  function guessSeriesType(values){
    // Heurística:
    // - se a maioria está entre -50 e +50 => provável "variação %"
    // - senão => provável "nível/índice"
    const nums = values.filter(n => Number.isFinite(n));
    if (nums.length < 2) return 'unknown';

    let pctLike = 0;
    for (const n of nums){
      if (Math.abs(n) <= 50) pctLike++;
    }
    return (pctLike / nums.length) >= 0.7 ? 'pct' : 'level';
  }

  function calcFactorFromPct(monthlyPct){
    // fator = produto(1 + v/100)
    return monthlyPct.reduce((acc, v) => acc * (1 + (v/100)), 1);
  }

  btn.addEventListener('click', async () => {
    try{
      setMsg('', 'Calculando...');
      btn.disabled = true;

      const aluguel = parseMoney(rentEl);
      if (!Number.isFinite(aluguel) || aluguel <= 0){
        setMsg('err','Informe um valor de aluguel válido.');
        btn.disabled = false;
        return;
      }

      const startDt = parseDateBR(startEl.value);
      if (!startDt){
        setMsg('err','Informe a data no formato dd/mm/aaaa.');
        btn.disabled = false;
        return;
      }

      const periodicity = periodicityEl.value; // mensal | anual
      const serie = indexEl.value;

      // data do reajuste = +1 mês ou +1 ano (mesmo dia)
      const reajusteDt = periodicity === 'mensal' ? addMonthsUTC(startDt, 1) : addYearsUTC(startDt, 1);

      // período considerado: mês da data inicial até mês anterior ao reajuste
      const startMonth = firstDayOfMonthUTC(startDt);
      const endMonth = firstDayOfMonthUTC(addMonthsUTC(reajusteDt, -1));

      const startISO = toISODateUTC(startMonth);
      const endISO = toISODateUTC(endMonth);

      const api = await fetchSGS(serie, startISO, endISO);
      const rows = Array.isArray(api.data) ? api.data : [];
      diagUrl.textContent = api.url || '';

      if (rows.length < 2){
        throw new Error('Série retornou poucos pontos no período. Tente outra data ou índice.');
      }

      // ordena por data (dd/mm/aaaa)
      const parsed = rows.map(r => {
        const d = parseDateBR(String(r.data || '').replaceAll('-', '/')) || parseDateBR(String(r.data || ''));
        return { dateStr: r.data, date: d, raw: r.valor, value: parseValorToNumber(r.valor) };
      }).filter(x => x.date);

      parsed.sort((a,b)=> a.date - b.date);

      const values = parsed.map(x => x.value);
      const type = guessSeriesType(values);

      let factor;
      let detailsHeader = '';
      if (type === 'pct'){
        factor = calcFactorFromPct(values);
        detailsHeader = `Série usada: ${serie} (variação % mensal)\nRegra: fator = Π(1 + v/100)\n`;
      } else {
        const first = values[0];
        const last = values[values.length-1];
        factor = last / first;
        detailsHeader = `Série usada: ${serie} (nível/índice)\nRegra: fator = último / primeiro\n`;
      }

      const trava = !!lockEl.checked;
      if (trava && factor < 1) factor = 1;

      const variacao = (factor - 1) * 100;
      const novoAluguel = aluguel * factor;

      // outputs
      const dd = String(reajusteDt.getUTCDate()).padStart(2,'0');
      const mm = String(reajusteDt.getUTCMonth()+1).padStart(2,'0');
      const yyyy = reajusteDt.getUTCFullYear();
      outReajuste.textContent = `${dd}/${mm}/${yyyy}`;

      outVar.textContent = `${brPct.format(variacao)}%`;
      outFactor.textContent = brPct.format(factor);
      outNewRent.textContent = brMoney.format(novoAluguel);

      const startLabel = `${monthNamePt(startMonth.getUTCMonth())} de ${startMonth.getUTCFullYear()}`;
      const endLabel = `${monthNamePt(endMonth.getUTCMonth())} de ${endMonth.getUTCFullYear()}`;
      outInfo.textContent = `Período considerado: ${startLabel} até ${endLabel} • Pontos: ${parsed.length} • Deflação: ${trava ? 'travada (não reduz)' : 'permitida'}`;

      // detalhes (lista)
      const lines = parsed.map(x => {
        // imprime como % se pct, senão imprime nível
        const v = x.value;
        const txt = (type === 'pct')
          ? `${String(x.dateStr).padEnd(12,' ')}  ${brPct.format(v)}%`
          : `${String(x.dateStr).padEnd(12,' ')}  ${brPct.format(v)} (nível)`;
        return txt;
      });

      outDetails.textContent = detailsHeader + lines.join('\n');

      diagText.textContent =
        `Tipo detectado: ${type === 'pct' ? 'VARIAÇÃO %' : 'NÍVEL (índice)'}\n` +
        `Start ISO: ${startISO}\nEnd ISO: ${endISO}\n` +
        `Fator final: ${factor}\n` +
        `Trava deflação: ${trava ? 'sim' : 'não'}\n`;

      setMsg('ok','Cálculo concluído com sucesso.');
    } catch(e){
      console.error(e);
      setMsg('err', `Erro: ${e.message || e}`);
      resetOutputs();
    } finally{
      btn.disabled = false;
    }
  });
})();
