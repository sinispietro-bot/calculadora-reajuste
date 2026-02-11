export default async function handler(req, res) {
  try {
    const { serie, dataInicial, dataFinal } = req.query;

    if (!serie || !dataInicial || !dataFinal) {
      res.status(400).json({ error: "Parâmetros obrigatórios: serie, dataInicial, dataFinal" });
      return;
    }

    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${encodeURIComponent(serie)}/dados` +
      `?formato=json&dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`;

    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "reajuste-site/1.0",
      },
    });

    if (!r.ok) {
      const txt = await r.text();
      res.status(r.status).send(txt);
      return;
    }

    const data = await r.json();

    // Cache no Vercel (CDN) para acelerar (10 min)
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
