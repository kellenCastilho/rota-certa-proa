export async function POST(request) {
  try {
    const { image } = await request.json();

    if (!image) {
      return Response.json(
        { error: "Nenhuma imagem recebida." },
        { status: 400 }
      );
    }

    const match = image.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
    );

    if (!match) {
      return Response.json(
        { error: "Formato de imagem inválido." },
        { status: 400 }
      );
    }

    const mimeType = match[1];
    const base64 = match[2];

    const resposta = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
Analise esta etiqueta de entrega brasileira e extraia APENAS o endereço físico do destinatário.

REGRAS IMPORTANTES:
- Retorne SOMENTE dados de endereço.
- NÃO inclua nome do destinatário.
- NÃO inclua nome da empresa.
- NÃO inclua nome da transportadora.
- NÃO inclua número de pedido, Pack ID, códigos, QR Code, código de barras, peso, valor, datas ou textos administrativos.
- Se houver texto estranho ou duvidoso, IGNORE.
- Priorize apenas o bloco do endereço postal.

Preencha os campos:
- rua
- numero
- complemento
- bairro
- cidade
- estado
- cep

Instruções extras:
- "rua" deve conter apenas o nome da via/logradouro.
- "numero" deve conter apenas o número do imóvel.
- "complemento" deve conter itens como apto, bloco, casa, sala etc.
- "bairro" deve conter apenas o bairro.
- "cidade" deve conter apenas a cidade.
- "estado" deve conter apenas a sigla do estado.
- "cep" deve conter apenas o CEP.
- Se um campo não estiver visível com clareza, retorne string vazia.
- Não invente nada.
- Retorne somente JSON válido.
                  `,
                },
                {
                  inlineData: {
                    mimeType,
                    data: base64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                rua: { type: "STRING" },
                numero: { type: "STRING" },
                complemento: { type: "STRING" },
                bairro: { type: "STRING" },
                cidade: { type: "STRING" },
                estado: { type: "STRING" },
                cep: { type: "STRING" },
              },
              required: [
                "rua",
                "numero",
                "complemento",
                "bairro",
                "cidade",
                "estado",
                "cep",
              ],
            },
          },
        }),
      }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro Gemini:", dados);

      return Response.json(
        {
          error:
            dados?.error?.message || "Erro ao analisar a etiqueta.",
        },
        { status: resposta.status }
      );
    }

    const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!texto) {
      return Response.json(
        { error: "O Gemini não encontrou um endereço." },
        { status: 422 }
      );
    }

    let endereco;

    try {
      endereco = JSON.parse(texto);
    } catch {
      console.error("JSON inválido do Gemini:", texto);

      return Response.json(
        { error: "Resposta inválida do Gemini." },
        { status: 422 }
      );
    }

    function limpar(valor) {
      if (!valor || typeof valor !== "string") return "";

      return valor
        .replace(/\s+/g, " ")
        .replace(/^[,.\-–—:; ]+|[,.\-–—:; ]+$/g, "")
        .trim();
    }

    const rua = limpar(endereco.rua).toUpperCase();
    const numero = limpar(endereco.numero).toUpperCase();
    const complemento = limpar(endereco.complemento).toUpperCase();
    const bairro = limpar(endereco.bairro).toUpperCase();
    const cidade = limpar(endereco.cidade).toUpperCase();
    const estado = limpar(endereco.estado).toUpperCase();
    const cep = limpar(endereco.cep).toUpperCase();

    const linha1 = [rua, numero].filter(Boolean).join(", ");
    const linha2 = complemento;
    const linha3 = bairro;

    let linha4 = "";

    if (cep) {
      linha4 += cep;
    }

    if (cidade) {
      linha4 += `${linha4 ? " - " : ""}${cidade}`;
    }

    if (estado) {
      linha4 += `${cidade ? "/" : linha4 ? " - " : ""}${estado}`;
    }

    const enderecoFormatado = [linha1, linha2, linha3, linha4]
      .filter(Boolean)
      .join("\n");

    return Response.json({
      rua,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      cep,
      enderecoFormatado,
    });
  } catch (error) {
    console.error("Erro ler-etiqueta:", error);

    return Response.json(
      { error: "Erro interno ao ler a etiqueta." },
      { status: 500 }
    );
  }
}