import { getBoardColumns } from "../lib/monday.js";

const TYPEFORM_COLUMNS = new Set([
  "dropdown_mm0xvt81",    // Bekræfter dokument
  "text_mm0ne0b0",        // Navn
  "color_mm0xw8e6",       // Metode
  "color_mm0x5j9a",       // Pakke
  "dropdown_mm2zgbbf",    // Tillægspriser
  "dropdown_mm0xyf9m",    // Kroniske sygdomme
  "short_texttybbc18j",   // Yderligere helbredsinfo
  "dropdown_mm0xb2s9",    // Forhøjet blodtryk
  "dropdown_mm0xnpvt",    // Ankomstlufthavn
  "datewtur8fqa",          // Ankomstdato og -tid
  "short_textgodfvnkl",   // Flynummer (ankomst)
  "date4oq7pl6n",          // Operationsdato
  "dropdown_mm0wscyn",    // Hjemrejselufthavn
  "datet2v5h8xu",          // Hjemrejsedato og -tid
  "short_textlqh0zj0g",   // Flynummer (hjemrejse)
  "single_selectdohyims", // Antal rejsende
  "long_textgirve6aq",    // Ekstra passagerer
  "single_selectvzc53dm", // Single seng
  "color_mm0x58vp",       // Medietilladelse
  "color_mm0x1y1w",       // Form submitted (auto-set)
  "color_mkzbweje",       // Email status (auto-set)
]);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const all = await getBoardColumns();
    const columns = all.filter(c => TYPEFORM_COLUMNS.has(c.id));
    res.json({ ok: true, columns });
  } catch (err) {
    res.json({ ok: false, code: err.code, error: err.message });
  }
}
