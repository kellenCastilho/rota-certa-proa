import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function extrairEndereco(texto) {
  const linhas = texto
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ignorar =
    /(PACK\s*ID|PEDIDO|DESPACH|REMETENTE|TRANSPORTADORA|CORREDOR|GAIOLA|CPF|CNPJ|VOLUME|VALOR|PESO)/i;

  const tiposDeVia =
    /\b(RUA|RUE|R\.|AV\.?|AVENIDA|ALAMEDA|TRAVESSA|RODOVIA|ESTRADA)\b/i;

  const rotuloEndereco = /^ENDERE[CÇ]O\s*:?/i;

  const marcadorDestinatario = /DESTINAT[ÁA]RIO/i;

  // Notas fiscais costumam trazer o endereço do REMETENTE primeiro no
  // documento, e só depois o do DESTINATÁRIO (que é o endereço de entrega
  // que interessa). Se o texto tiver essa seção, a busca passa a considerar
  // só o que vem depois dela — senão a função pegava o endereço errado.
  const indiceDestinatario = linhas.findIndex((linha) =>
    marcadorDestinatario.test(linha)
  );

  const linhasBusca =
    indiceDestinatario === -1 ? linhas : linhas.slice(indiceDestinatario);

  const inicio = linhasBusca.findIndex(
    (linha) =>
      (tiposDeVia.test(linha) || rotuloEndereco.test(linha)) &&
      !ignorar.test(linha)
  );

  if (inicio === -1) {
    return texto;
  }

  const resultado = [];

  for (
    let i = inicio;
    i < linhasBusca.length && resultado.length < 4;
    i++
  ) {
    if (i > inicio && ignorar.test(linhasBusca[i])) {
      break;
    }

    let linha = linhasBusca[i];

    // Remove sujeira antes de "Rua", "Av.", etc., e o rótulo "Endereço:"
    // quando a linha vem nesse formato (comum em notas fiscais).
    if (i === inicio) {
      linha = linha.replace(rotuloEndereco, "").trim();

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
      setTextoOCR("🤖 Lendo endereço...");

      const resposta = await fetch("/api/ler-etiqueta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: image,
        }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.error || "Não foi possível ler a etiqueta."
        );
      }

      const enderecoFormatado = [
        [dados.rua, dados.numero].filter(Boolean).join(", "),
        dados.complemento,
        dados.bairro,
        [dados.cidade, dados.estado].filter(Boolean).join(" - "),
        dados.cep,
      ]
        .filter(Boolean)
        .join("\n");

      setEndereco(enderecoFormatado);
      setTextoOCR("Endereço reconhecido");
    } catch (error) {
      console.error("Erro Gemini:", error);

      setTextoOCR(
        "Não foi possível reconhecer o endereço."
      );

      setEndereco("");
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
        <strong>📄 Texto encontrado:</strong>

        {editando ? (
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
    }}
  />
) : (
  <p>{endereco}</p>
)}
      </div>

      {/*
        Antes, o botão "Corrigir endereço" ficava aninhado DENTRO do botão
        "Confirmar endereço" (<button> dentro de <button>), o que é HTML
        inválido. Agora são dois botões irmãos, lado a lado.
      */}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button
          type="button"
          onClick={() => setEditando((valorAtual) => !valorAtual)}
          style={{
            padding: "12px 20px",
            borderRadius: 10,
            background: "#374151",
            color: "white",
            border: "none",
            cursor: "pointer",
          }}
        >
          {editando ? "✓ Concluir correção" : "✏️ Corrigir endereço"}
        </button>

        <button
          type="button"
          onClick={confirmarEndereco}
          style={{
            padding: "12px 24px",
            borderRadius: 10,
            background: "#2563eb",
            color: "white",
            border: "none",
            cursor: "pointer",
          }}
        >
          ✅ Confirmar endereço
        </button>
      </div>
    </div>
  );
}