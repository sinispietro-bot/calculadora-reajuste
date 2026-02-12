export default async function handler(req, res) {
  try {
    const { serie, dataInicial, dataFinal } = req.query;

    if (!serie || !dataInicial || !dataFinal) {
      return res.status(400).json({
        error: "Parâmetros obrigatórios: serie, dataInicial, dataFinal (dd/mm/aaaa)",
      });
    }

    const url = new URL(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados`);
    url.searchParams.set("formato", "json");
    url.searchParams.set("dataInicial", dataInicial);
    url.searchParams.set("dataFinal", dataFinal);

    const r = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(r.status).json({
        error: `BCB retornou HTTP ${r.status}`,
        detail: txt?.slice(0, 200) || "",
        url: url.toString(),
      });
    }

    const data = await r.json();

    // cache (ajuda a ficar mais rápido)
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ url: url.toString(), data });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detail: String(e?.message || e) });
  }
}
