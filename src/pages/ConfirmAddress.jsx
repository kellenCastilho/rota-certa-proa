import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function extrairEndereco(texto) {
  if (!texto || typeof texto !== "string") return "";

  const linhas = texto
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ignorar =
    /(PACK\s*ID|PEDIDO|DESPACH|DESTINATÁRIO|REMETENTE|CORREDOR|GAIOLA|CPF|CNPJ)/i;

  const tiposDeVia =
    /\b(RUA|RUE|R\.|AV\.?|AVENIDA|ALAMEDA|TRAVESSA|RODOVIA|ESTRADA)\b/i;

  const inicio = linhas.findIndex(
    (linha) => tiposDeVia.test(linha) && !ignorar.test(linha)
  );

  if (inicio === -1) {
    return texto.trim();
  }

  const resultado = [];

  for (let i = inicio; i < linhas.length && resultado.length < 4; i++) {
    if (i > inicio && ignorar.test(linhas[i])) {
      break;
    }

    let linha = linhas[i];

    if (i === inicio) {
      const posicao = linha.search(tiposDeVia);

      if (posicao >= 0) {
        linha = linha.slice(posicao);
      }

      linha = linha.replace(/^RUE\b/i, "Rua");
    }

    resultado.push(linha);
  }

  return resultado.join("\n").trim();
}

function montarEnderecoDosCampos(dados) {
  if (!dados || typeof dados !== "object") return "";

  const limpar = (valor) =>
    typeof valor === "string" ? valor.trim() : "";

  const rua = limpar(dados.rua);
  const numero = limpar(dados.numero);
  const complemento = limpar(dados.complemento);
  const bairro = limpar(dados.bairro);
  const cidade = limpar(dados.cidade);
  const estado = limpar(dados.estado);
  const cep = limpar(dados.cep);

  const linha1 = [rua, numero].filter(Boolean).join(", ");
  const linha2 = complemento;
  const linha3 = bairro;

  let linha4 = "";
  if (cep) linha4 += cep;
  if (cidade) linha4 += `${linha4 ? " - " : ""}${cidade}`;
  if (estado) linha4 += `${cidade ? "/" : linha4 ? " - " : ""}${estado}`;

  return [linha1, linha2, linha3, linha4]
    .filter(Boolean)
    .join("\n");
}

function obterTextoDaResposta(dados) {
  if (!dados) return "";

  if (typeof dados === "string") return dados.trim();

  const candidatos = [
    dados.enderecoFormatado,
    dados.endereco,
    dados.texto,
    dados.text,
    dados.resultado,
    dados.response,
    dados.resposta,
    dados?.data?.enderecoFormatado,
    dados?.data?.endereco,
    dados?.data?.texto,
    dados?.data?.text,
  ];

  const encontrado = candidatos.find(
    (valor) => typeof valor === "string" && valor.trim()
  );

  if (encontrado) {
    return encontrado.trim();
  }

  return montarEnderecoDosCampos(dados);
}

export default function ConfirmAddress() {
  const navigate = useNavigate();

  const image = sessionStorage.getItem("capturedImage");

  const [textoOCR, setTextoOCR] = useState("Preparando leitura...");
  const [endereco, setEndereco] = useState("");
  const [editando, setEditando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!image) {
      setTextoOCR("Nenhuma imagem foi encontrada.");
      setCarregando(false);
      return;
    }

    async function lerEtiqueta() {
      try {
        setCarregando(true);
        setTextoOCR("🤖 Lendo etiqueta com Gemini...");

        const resposta = await fetch("/api/ler-etiqueta", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image,
          }),
        });

        const corpoBruto = await resposta.text();

        let dados;
        try {
          dados = corpoBruto ? JSON.parse(corpoBruto) : {};
        } catch {
          dados = corpoBruto;
        }

        if (!resposta.ok) {
          const mensagemErro =
            (typeof dados?.error === "string" ? dados.error : "") ||
            obterTextoDaResposta(dados) ||
            `Erro ${resposta.status} ao ler a etiqueta.`;

          throw new Error(mensagemErro);
        }

        const textoEncontrado = obterTextoDaResposta(dados);

        if (!textoEncontrado) {
          throw new Error("O Gemini não retornou nenhum endereço da etiqueta.");
        }

        const enderecoEncontrado =
          typeof dados?.enderecoFormatado === "string" &&
          dados.enderecoFormatado.trim()
            ? dados.enderecoFormatado.trim()
            : montarEnderecoDosCampos(dados) || extrairEndereco(textoEncontrado);

        setEndereco(enderecoEncontrado);
        setTextoOCR(textoEncontrado);

        console.log("Resposta do Gemini:", dados);
        console.log("Texto reconhecido:", textoEncontrado);
        console.log("Endereço extraído:", enderecoEncontrado);
      } catch (error) {
        console.error("Erro ao ler etiqueta com Gemini:", error);

        setEndereco("");
        setTextoOCR(
          error?.message || "Não foi possível ler a etiqueta com o Gemini."
        );
      } finally {
        setCarregando(false);
      }
    }

    lerEtiqueta();
  }, [image]);

  function confirmarEndereco() {
    if (!endereco.trim()) {
      alert("Digite ou corrija o endereço antes de confirmar.");
      return;
    }

    sessionStorage.setItem("confirmedAddress", endereco.trim());
    navigate("/entregas");
  }

  return (
    <div style={{ padding: 30, color: "white" }}>
      <button type="button" onClick={() => navigate("/escanear")}>
        ← Voltar
      </button>

      <h1>Confirmar endereço</h1>

      {image && (
        <img
          src={image}
          alt="Etiqueta capturada"
          style={{
            width: "100%",
            maxHeight: 450,
            objectFit: "contain",
            borderRadius: 16,
            marginTop: 20,
            marginBottom: 20,
            background: "#020617",
          }}
        />
      )}

      <div
        style={{
          marginTop: 20,
          padding: 16,
          background: "#111827",
          borderRadius: 12,
          color: "white",
          whiteSpace: "pre-wrap",
        }}
      >
        <strong>📍 Endereço encontrado:</strong>

        {carregando ? (
          <p>{textoOCR}</p>
        ) : editando ? (
          <textarea
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            rows={6}
            style={{
              width: "100%",
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              fontSize: 16,
              boxSizing: "border-box",
            }}
          />
        ) : (
          <p>{endereco || textoOCR}</p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 20,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setEditando((valorAtual) => !valorAtual)}
          disabled={carregando}
          style={{
            padding: "12px 20px",
            borderRadius: 10,
            background: "#374151",
            color: "white",
            border: "none",
            cursor: carregando ? "not-allowed" : "pointer",
            opacity: carregando ? 0.6 : 1,
          }}
        >
          {editando ? "✓ Concluir correção" : "✏️ Corrigir endereço"}
        </button>

        <button
          type="button"
          onClick={confirmarEndereco}
          disabled={carregando || !endereco.trim()}
          style={{
            padding: "12px 24px",
            borderRadius: 10,
            background: "#2563eb",
            color: "white",
            border: "none",
            cursor:
              carregando || !endereco.trim() ? "not-allowed" : "pointer",
            opacity: carregando || !endereco.trim() ? 0.6 : 1,
          }}
        >
          ✅ Confirmar endereço
        </button>
      </div>
    </div>
  );
}