// /api/sgs.js
export default async function handler(req, res) {
  try {
    const serie = String(req.query.serie || "").trim();
    const dataInicial = String(req.query.dataInicial || "").trim(); // dd/mm/aaaa
    const dataFinal = String(req.query.dataFinal || "").trim();     // dd/mm/aaaa

    if (!serie) return res.status(400).json({ error: "Parâmetro obrigatório: serie" });
    if (!/^\d+$/.test(serie)) return res.status(400).json({ error: "Parâmetro serie inválido" });

    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dataInicial) || !/^\d{2}\/\d{2}\/\d{4}$/.test(dataFinal)) {
      return res.status(400).json({ error: "datas devem estar em dd/mm/aaaa (dataInicial e dataFinal)" });
    }

    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${encodeURIComponent(serie)}/dados` +
      `?formato=json&dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`;

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");

    const resp = await fetch(url);
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return res.status(502).json({ error: "Falha ao consultar SGS/BCB", status: resp.status, detail: txt, url });
    }

    const data = await resp.json();
    const normalized = Array.isArray(data)
      ? data
          .map((r) => ({
            data: r.data,
            valor: typeof r.valor === "string" ? Number(String(r.valor).replace(",", ".")) : Number(r.valor),
          }))
          .filter((r) => r.data && Number.isFinite(r.valor))
      : [];

    return res.status(200).json({ serie: Number(serie), dataInicial, dataFinal, dados: normalized, url });
  } catch (err) {
    return res.status(500).json({ error: "Erro interno", detail: String(err?.message || err) });
  }
}
