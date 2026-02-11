export default async function handler(req, res) {
  try {
    const { serie, dataInicial, dataFinal } = req.query;

    if (!serie || !dataInicial || !dataFinal) {
      return res.status(400).json({
        error: "Parâmetros obrigatórios: serie, dataInicial, dataFinal",
      });
    }

    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${encodeURIComponent(serie)}` +
      `/dados?formato=json&dataInicial=${encodeURIComponent(dataInicial)}` +
      `&dataFinal=${encodeURIComponent(dataFinal)}`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": "shopping-center-tools",
        "Accept": "application/json",
      },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).send(text);
    }

    const data = await r.json();

    // Cache no edge da Vercel (ajuda MUITO a ficar rápido)
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "Falha ao consultar BCB", details: String(e) });
  }
}
