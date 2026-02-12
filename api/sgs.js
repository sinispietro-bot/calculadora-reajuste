export default async function handler(req, res) {
  try {
    const { serie, start, end } = req.query;

    if (!serie || !start || !end) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios: serie, start, end (formato YYYY-MM-DD).',
      });
    }

    // Converte YYYY-MM-DD -> dd/mm/aaaa
    function toBR(d) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
      if (!m) return null;
      return `${m[3]}/${m[2]}/${m[1]}`;
    }

    const di = toBR(start);
    const df = toBR(end);
    if (!di || !df) {
      return res.status(400).json({
        error: 'Datas inválidas. Use start/end no formato YYYY-MM-DD.',
      });
    }

    const url = new URL(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${encodeURIComponent(serie)}/dados`);
    url.searchParams.set('formato', 'json');
    url.searchParams.set('dataInicial', di);
    url.searchParams.set('dataFinal', df);

    const r = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({
        error: `BCB retornou HTTP ${r.status}`,
        detail: txt?.slice(0, 300) || '',
        url: url.toString(),
      });
    }

    const data = await r.json();

    // Cache leve (ajuda performance/lentidão)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ url: url.toString(), data });

  } catch (e) {
    return res.status(500).json({ error: 'Falha interna na API', detail: String(e?.message || e) });
  }
}
