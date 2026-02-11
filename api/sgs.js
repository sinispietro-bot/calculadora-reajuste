export default async function handler(req, res) {
  try {
    const serie = String(req.query.serie || '').trim();
    const start = String(req.query.start || '').trim(); // YYYY-MM-DD
    const end = String(req.query.end || '').trim();     // YYYY-MM-DD

    if (!serie || !start || !end) {
      res.status(400).json({ error: "Parâmetros obrigatórios: serie, start, end (YYYY-MM-DD)" });
      return;
    }

    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${encodeURIComponent(serie)}/dados?formato=json&dataInicial=${encodeURIComponent(start)}&dataFinal=${encodeURIComponent(end)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const r = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/json" } });
    clearTimeout(timeout);

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      res.status(502).json({ error: "Falha ao consultar SGS/BCB", status: r.status, details: text.slice(0, 200) });
      return;
    }

    const data = await r.json();

    // cache leve (melhora velocidade em consultas repetidas)
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json({ url, data });
  } catch (e) {
    res.status(500).json({ error: "Erro interno /api/sgs", details: String(e?.message || e) });
  }
}
