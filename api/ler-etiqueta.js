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
Analise esta etiqueta de entrega brasileira.

Extraia SOMENTE o endereço do destinatário.

Ignore:
- nome do destinatário
- telefone
- CPF ou CNPJ
- QR Code
- código de barras
- número do pedido
- Pack ID
- transportadora
- peso
- valor
- datas
- textos internos da transportadora

Não invente dados que não estejam visíveis.

Separe o endereço nos campos:
rua, numero, complemento, bairro, cidade, estado e cep.

Se algum campo não estiver visível, retorne uma string vazia.
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
            dados?.error?.message ||
            "Erro ao analisar a etiqueta.",
        },
        { status: resposta.status }
      );
    }

    const texto =
      dados?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!texto) {
      return Response.json(
        { error: "O Gemini não encontrou um endereço." },
        { status: 422 }
      );
    }

    const endereco = JSON.parse(texto);

    return Response.json(endereco);
  } catch (error) {
    console.error("Erro ler-etiqueta:", error);

    return Response.json(
      { error: "Erro interno ao ler a etiqueta." },
      { status: 500 }
    );
  }
}