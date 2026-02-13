export default async function handler(req, res) {
  try {
    const { serie, start, end } = req.query;

    if (!serie || !start || !end) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios: serie, start, end (dd/mm/aaaa)' });
    }

    // Cache no Vercel (ajuda muito na lentidão)
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

    const url = new URL(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados`);
    url.searchParams.set('formato', 'json');
    url.searchParams.set('dataInicial', start);
    url.searchParams.set('dataFinal', end);

    const r = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' }
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Erro ao consultar BCB', detail: txt.slice(0, 300) });
    }

    const data = await r.json();
    if (!Array.isArray(data)) {
      return res.status(500).json({ error: 'Resposta inesperada do BCB (não veio array)' });
    }

    return res.status(200).json({
      urlBCB: url.toString(),
      data
    });
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno na API', message: String(e?.message || e) });
  }
}
