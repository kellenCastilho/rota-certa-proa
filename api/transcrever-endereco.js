const GEMINI_MODEL =
  "gemini-3.5-flash-lite";

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function POST(request) {
  const inicio = Date.now();

  try {
    // ==========================================
    // 1. RECEBE ÁUDIO + CONTEXTO DA LOCALIZAÇÃO
    // ==========================================

    let body;

    try {
      body =
        await request.json();
    } catch {
      return Response.json(
        {
          error:
            "Não foi possível ler os dados enviados.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      audio,
      mimeType: mimeTypeRecebido,
      cidade = "",
      estado = "",
    } = body || {};

    if (!audio) {
      return Response.json(
        {
          error:
            "Nenhum áudio recebido.",
        },
        {
          status: 400,
        }
      );
    }

    // ==========================================
    // 2. PEGA MIME TYPE E BASE64
    // ==========================================

    let mimeType =
      mimeTypeRecebido ||
      "audio/webm";

    let base64 =
      audio;

    /*
     * Se vier assim:
     *
     * data:audio/mp4;base64,AAAA...
     *
     * separa automaticamente.
     */
    if (
      typeof audio ===
        "string" &&
      audio.startsWith(
        "data:"
      )
    ) {
      const commaIndex =
        audio.indexOf(",");

      if (
        commaIndex === -1
      ) {
        return Response.json(
          {
            error:
              "Formato de áudio inválido.",
          },
          {
            status: 400,
          }
        );
      }

      const header =
        audio.slice(
          0,
          commaIndex
        );

      base64 =
        audio.slice(
          commaIndex + 1
        );

      const mimeMatch =
        header.match(
          /^data:([^;]+)/
        );

      if (
        mimeMatch?.[1]
      ) {
        mimeType =
          mimeMatch[1];
      }
    }

    if (
      !base64 ||
      typeof base64 !==
        "string"
    ) {
      return Response.json(
        {
          error:
            "Áudio inválido.",
        },
        {
          status: 400,
        }
      );
    }

    // ==========================================
    // 3. CHAVE GEMINI
    // ==========================================

    const apiKey =
      process.env
        .GEMINI_API_KEY;

    if (!apiKey) {
      console.error(
        "GEMINI_API_KEY não configurada."
      );

      return Response.json(
        {
          error:
            "GEMINI_API_KEY não configurada.",
        },
        {
          status: 500,
        }
      );
    }

    // ==========================================
    // 4. CONTEXTO GPS
    // ==========================================

    const cidadeLimpa =
      typeof cidade ===
      "string"
        ? cidade.trim()
        : "";

    const estadoLimpo =
      typeof estado ===
      "string"
        ? estado
            .trim()
            .toUpperCase()
        : "";

    const contextoLocal =
      cidadeLimpa
        ? `${cidadeLimpa}${
            estadoLimpo
              ? `/${estadoLimpo}`
              : ""
          }`
        : "não informado";

    // ==========================================
    // 5. TIMEOUT
    // ==========================================

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        15000
      );

    // ==========================================
    // 6. ENVIA ÁUDIO AO GEMINI
    // ==========================================

    let resposta;

    try {
      resposta =
        await fetch(
          GEMINI_URL,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              "x-goog-api-key":
                apiKey,
            },

            signal:
              controller.signal,

            body:
              JSON.stringify({
                contents: [
                  {
                    role:
                      "user",

                    parts: [
                      {
                        text: `
Você está recebendo um áudio curto de um entregador brasileiro falando um ENDEREÇO.

A pessoa pode falar apenas:
"Rua Ovídio Bradamante de Toledo, 100"

ou:
"Avenida João Naves, 2500"

Ela NÃO precisa falar cidade nem estado.

A localização atual obtida pelo GPS do aparelho é:

${contextoLocal}

Sua tarefa:

1. Transcreva somente o endereço falado.
2. Identifique rua, número, complemento e bairro quando forem falados.
3. Se a pessoa NÃO falar cidade, use a cidade informada pelo GPS.
4. Se a pessoa NÃO falar estado, use a UF informada pelo GPS.
5. Se a pessoa falar explicitamente uma cidade ou estado, respeite o que foi falado.
6. NÃO invente bairro ou complemento.
7. Corrija apenas erros óbvios de transcrição de nomes de ruas.
8. Não transforme números de endereço em CEP.
9. Ignore qualquer conversa que não faça parte do endereço.
10. Retorne um endereço pronto para ser usado em geocodificação.

Exemplo:

Áudio:
"Rondon Pacheco dois mil e trezentos"

GPS:
Uberlândia/MG

Resultado:
Avenida Rondon Pacheco, 2300 - Uberlândia/MG
                        `.trim(),
                      },

                      {
                        inlineData: {
                          mimeType,
                          data:
                            base64,
                        },
                      },
                    ],
                  },
                ],

                generationConfig: {
                  thinkingConfig: {
                    thinkingLevel:
                      "minimal",
                  },

                  maxOutputTokens:
                    256,

                  responseMimeType:
                    "application/json",

                  responseSchema: {
                    type:
                      "OBJECT",

                    properties: {
                      textoFalado: {
                        type:
                          "STRING",
                      },

                      rua: {
                        type:
                          "STRING",
                      },

                      numero: {
                        type:
                          "STRING",
                      },

                      complemento: {
                        type:
                          "STRING",
                      },

                      bairro: {
                        type:
                          "STRING",
                      },

                      cidade: {
                        type:
                          "STRING",
                      },

                      estado: {
                        type:
                          "STRING",
                      },

                      endereco: {
                        type:
                          "STRING",
                      },
                    },

                    required: [
                      "textoFalado",
                      "rua",
                      "numero",
                      "complemento",
                      "bairro",
                      "cidade",
                      "estado",
                      "endereco",
                    ],
                  },
                },
              }),
          }
        );
    } catch (error) {
      clearTimeout(
        timeout
      );

      if (
        error?.name ===
        "AbortError"
      ) {
        return Response.json(
          {
            error:
              "A leitura do áudio demorou demais. Tente novamente.",
          },
          {
            status: 504,
          }
        );
      }

      throw error;
    }

    clearTimeout(
      timeout
    );

    // ==========================================
    // 7. RESPOSTA DO GEMINI
    // ==========================================

    let dadosGemini;

    try {
      dadosGemini =
        await resposta.json();
    } catch {
      return Response.json(
        {
          error:
            "Resposta inválida ao interpretar o áudio.",
        },
        {
          status: 502,
        }
      );
    }

    if (!resposta.ok) {
      console.error(
        "Erro Gemini áudio:",
        dadosGemini
      );

      return Response.json(
        {
          error:
            dadosGemini
              ?.error
              ?.message ||
            "Não foi possível entender o endereço.",
        },
        {
          status:
            resposta.status ||
            500,
        }
      );
    }

    const texto =
      dadosGemini
        ?.candidates?.[0]
        ?.content?.parts?.[0]
        ?.text || "";

    if (!texto) {
      return Response.json(
        {
          error:
            "Não consegui identificar um endereço no áudio.",
        },
        {
          status: 422,
        }
      );
    }

    // ==========================================
    // 8. CONVERTE JSON
    // ==========================================

    let endereco;

    try {
      endereco =
        JSON.parse(texto);
    } catch {
      console.error(
        "JSON de áudio inválido:",
        texto
      );

      return Response.json(
        {
          error:
            "Não consegui interpretar o endereço falado.",
        },
        {
          status: 422,
        }
      );
    }

    const limpar = (
      valor
    ) =>
      typeof valor ===
      "string"
        ? valor.trim()
        : "";

    const resultado = {
      textoFalado:
        limpar(
          endereco.textoFalado
        ),

      rua:
        limpar(
          endereco.rua
        ),

      numero:
        limpar(
          endereco.numero
        ),

      complemento:
        limpar(
          endereco.complemento
        ),

      bairro:
        limpar(
          endereco.bairro
        ),

      cidade:
        limpar(
          endereco.cidade
        ) ||
        cidadeLimpa,

      estado:
        (
          limpar(
            endereco.estado
          ) ||
          estadoLimpo
        ).toUpperCase(),

      endereco:
        limpar(
          endereco.endereco
        ),
    };

    // ==========================================
    // 9. GARANTIA DO ENDEREÇO FORMATADO
    // ==========================================

    if (
      !resultado.endereco
    ) {
      const primeiraLinha =
        [
          resultado.rua,
          resultado.numero,
        ]
          .filter(Boolean)
          .join(", ");

      const cidadeEstado =
        [
          resultado.cidade,
          resultado.estado,
        ]
          .filter(Boolean)
          .join("/");

      resultado.endereco =
        [
          primeiraLinha,
          resultado
            .complemento,
          resultado.bairro,
          cidadeEstado,
        ]
          .filter(Boolean)
          .join(" - ");
    }

    if (
      !resultado.rua &&
      !resultado.endereco
    ) {
      return Response.json(
        {
          error:
            "Não consegui entender o endereço. Tente falar novamente.",
        },
        {
          status: 422,
        }
      );
    }

    const tempoTotal =
      Date.now() -
      inicio;

    console.log(
      `🎤 Endereço por voz reconhecido em ${tempoTotal} ms`
    );

    return Response.json({
      ...resultado,

      tempoTotal,
    });
  } catch (error) {
    console.error(
      "Erro ao transcrever endereço:",
      error
    );

    return Response.json(
      {
        error:
          "Erro interno ao reconhecer o endereço falado.",
      },
      {
        status: 500,
      }
    );
  }
}