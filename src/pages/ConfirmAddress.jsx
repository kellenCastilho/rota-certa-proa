import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Tesseract from "tesseract.js";
import { melhorarImagemDocumento } from "../vision/documentScanner";

function extrairEndereco(texto) {
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
    return texto;
  }

  const resultado = [];

  for (
    let i = inicio;
    i < linhas.length && resultado.length < 4;
    i++
  ) {
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

  return resultado.join("\n");
}

export default function ConfirmAddress() {
  const navigate = useNavigate();

  const image = sessionStorage.getItem("capturedImage");

  const [textoOCR, setTextoOCR] = useState("Lendo etiqueta...");
  const [endereco, setEndereco] = useState("");
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    if (!image) {
      setTextoOCR("Nenhuma imagem foi encontrada.");
      return;
    }

    async function lerEtiqueta() {
      try {
        setTextoOCR("Melhorando imagem...");

        const imagemTratada = await melhorarImagemDocumento(image);

        setTextoOCR("Lendo etiqueta...");

        const { data } = await Tesseract.recognize(
          imagemTratada,
          "por"
        );

        const textoEncontrado = data.text.trim();

        console.log("Texto reconhecido:", textoEncontrado);

        setTextoOCR(
          textoEncontrado ||
            "Nenhum texto foi reconhecido na imagem."
        );

        setEndereco(
          extrairEndereco(textoEncontrado)
        );
      } catch (error) {
        console.error(
          "Erro no tratamento ou OCR:",
          error
        );

        setTextoOCR(
          "Não foi possível ler a etiqueta."
        );
      }
    }

    lerEtiqueta();
  }, [image]);

  return (
    <div
      style={{
        padding: 30,
        color: "white",
        paddingBottom: 120,
      }}
    >
      <button
        type="button"
        onClick={() => navigate("/escanear")}
      >
        ← Voltar
      </button>

      <h1>Confirmar endereço</h1>

      {image && (
        <img
          src={image}
          alt="Etiqueta capturada"
          style={{
            width: "100%",
            maxHeight: 350,
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
        }}
      >
        <strong>
          📍 Endereço reconhecido — confira:
        </strong>

        {editando ? (
          <textarea
            value={endereco}
            onChange={(e) =>
              setEndereco(e.target.value)
            }
            rows={6}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 14,
              padding: 14,
              borderRadius: 10,
              fontSize: 16,
            }}
          />
        ) : (
          <p
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 17,
              lineHeight: 1.5,
            }}
          >
            {endereco || textoOCR}
          </p>
        )}
      </div>

      <button
        type="button"
        style={{
          width: "100%",
          marginTop: 20,
          padding: "16px 24px",
          borderRadius: 12,
          background: "#22c55e",
          color: "#07111f",
          border: "none",
          cursor: "pointer",
          fontSize: 18,
          fontWeight: 700,
        }}
      >
        ✅ Confirmar endereço
      </button>

      <button
        type="button"
        onClick={() =>
          setEditando(
            (valorAtual) => !valorAtual
          )
        }
        style={{
          width: "100%",
          marginTop: 12,
          padding: "14px 20px",
          borderRadius: 12,
          background: "#374151",
          color: "white",
          border: "none",
          cursor: "pointer",
          fontSize: 16,
        }}
      >
        {editando
          ? "✓ Concluir correção"
          : "✏️ Corrigir endereço"}
      </button>

      <button
        type="button"
        onClick={() =>
          navigate("/escanear")
        }
        style={{
          width: "100%",
          marginTop: 12,
          padding: "14px 20px",
          borderRadius: 12,
          background: "transparent",
          color: "white",
          border: "1px solid #475569",
          cursor: "pointer",
          fontSize: 16,
        }}
      >
        🔄 Tirar outra foto
      </button>
    </div>
  );
}