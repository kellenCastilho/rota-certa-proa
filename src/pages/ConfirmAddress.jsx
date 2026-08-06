import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Tesseract from "tesseract.js";
import { melhorarImagemDocumento } from "../vision/documentScanner";

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
      setEndereco(textoEncontrado);

      console.log("Texto reconhecido:", textoEncontrado);

      setTextoOCR(
        textoEncontrado || "Nenhum texto foi reconhecido na imagem."
      );
    } catch (error) {
      console.error("Erro no tratamento ou OCR:", error);
      setTextoOCR("Não foi possível ler a etiqueta.");
    }
  }

  lerEtiqueta();
}, [image]);

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

      <button
        type="button"
        style={{
          marginTop: 20,
          padding: "12px 24px",
          borderRadius: 10,
          background: "#2563eb",
          color: "white",
          border: "none",
          cursor: "pointer",
        }}
      >
        <button
          type="button"
          onClick={() => setEditando((valorAtual) => !valorAtual)}
          style={{
            marginTop: 20,
            marginRight: 12,
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
        ✅ Confirmar endereço
      </button>
    </div>
  );
}