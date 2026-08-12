export async function geocodeAddress(address) {
  const original = String(address || "").trim();

  const cepMatch = original.match(/\b\d{2}\.?\d{3}-?\d{3}\b/);

  const numberMatch = original.match(
    /(?:RUA|AVENIDA|AV\.?|R\.?)\s+.+?,?\s+(\d{1,6})\b/i
  );

  const numero = numberMatch?.[1] || "";
  const attempts = [];

  if (cepMatch) {
    const cep = cepMatch[0].replace(/\D/g, "");

    try {
      const response = await fetch(
        `https://viacep.com.br/ws/${cep}/json/`
      );

      if (response.ok) {
        const dadosCep = await response.json();

        if (!dadosCep.erro && dadosCep.logradouro) {
          const enderecoCepComNumero = [
            dadosCep.logradouro,
            numero,
            dadosCep.bairro,
            dadosCep.localidade,
            dadosCep.uf,
            "Brasil",
          ]
            .filter(Boolean)
            .join(", ");

          const enderecoCepSemNumero = [
            dadosCep.logradouro,
            dadosCep.bairro,
            dadosCep.localidade,
            dadosCep.uf,
            "Brasil",
          ]
            .filter(Boolean)
            .join(", ");

          attempts.push(enderecoCepComNumero);
          attempts.push(enderecoCepSemNumero);
        }
      }
    } catch (error) {
      console.warn("Falha ao consultar CEP:", error);
    }
  }

  const cleaned = original
    .replace(
      /\b(AP|APT|APTO|APARTAMENTO|SALA|BL|BLOCO)\s*[A-Z0-9-]+/gi,
      ""
    )
    .replace(/\b\d{2}\.?\d{3}-?\d{3}\b/g, "")
    .replace(/\s+-\s+/g, ", ")
    .replace(/\//g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  attempts.push(cleaned);
  attempts.push(`${cleaned}, Uberlândia, MG, Brasil`);

  const uniqueAttempts = [...new Set(attempts.filter(Boolean))];

  for (const query of uniqueAttempts) {
    try {
      console.log("🔎 Tentando localizar:", query);

      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?format=json` +
        `&limit=1` +
        `&countrycodes=br` +
        `&accept-language=pt-BR` +
        `&q=${encodeURIComponent(query)}`;

      const response = await fetch(url, {
        headers: {
          "Accept-Language": "pt-BR",
        },
      });

      if (!response.ok) continue;

      const data = await response.json();

      if (data?.length) {
        console.log("✅ Localizado:", query);

        return {
          lat: Number(data[0].lat),
          lng: Number(data[0].lon),
        };
      }
    } catch (error) {
      console.warn("Falha na tentativa:", query, error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Endereço não encontrado: ${original}`);
}