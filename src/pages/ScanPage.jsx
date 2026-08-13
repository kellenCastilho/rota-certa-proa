import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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

  if (cep) {
    linha4 += cep;
  }

  if (cidade) {
    linha4 += `${linha4 ? " - " : ""}${cidade}`;
  }

  if (estado) {
    linha4 += `${cidade ? "/" : linha4 ? " - " : ""}${estado}`;
  }

  return [linha1, linha2, linha3, linha4]
    .filter(Boolean)
    .join("\n");
}

function obterEnderecoDaResposta(dados) {
  if (!dados) return "";

  if (typeof dados === "string") {
    return dados.trim();
  }

  if (
    typeof dados.enderecoFormatado === "string" &&
    dados.enderecoFormatado.trim()
  ) {
    return dados.enderecoFormatado.trim();
  }

  return montarEnderecoDosCampos(dados);
}

export default function ScanPage({ onSave }) {
  const navigate = useNavigate();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const videoBoxRef = useRef(null);
  const scanBoxRef = useRef(null);

  const [cameraError, setCameraError] = useState("");
  // "camera" | "processing" | "review"
  const [mode, setMode] = useState("camera");
  const [scannedCount, setScannedCount] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [ocrError, setOcrError] = useState("");

  useEffect(() => {
    let cameraStream;

    async function openCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "A câmera não está disponível neste navegador ou conexão."
          );
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
          },
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = cameraStream;
        }
      } catch (error) {
        console.error("Erro ao abrir a câmera:", error);

        setCameraError(
          `${error.name || "Erro"} - ${
            error.message || "Não foi possível abrir a câmera."
          }`
        );
      }
    }

    if (mode === "camera") {
      openCamera();
    }

    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [mode]);

  function getCroppedImageDataUrl() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const videoBox = videoBoxRef.current;
    const scanBox = scanBoxRef.current;

    if (
      !video ||
      !canvas ||
      !videoBox ||
      !scanBox ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return null;
    }

    const context = canvas.getContext("2d");
    if (!context) return null;

    const videoRect = videoBox.getBoundingClientRect();
    const scanRect = scanBox.getBoundingClientRect();

    const sourceRatio = video.videoWidth / video.videoHeight;
    const displayRatio = videoRect.width / videoRect.height;

    let displayedWidth;
    let displayedHeight;
    let offsetX;
    let offsetY;

    if (sourceRatio > displayRatio) {
      displayedWidth = videoRect.width;
      displayedHeight = videoRect.width / sourceRatio;
      offsetX = 0;
      offsetY = (videoRect.height - displayedHeight) / 2;
    } else {
      displayedHeight = videoRect.height;
      displayedWidth = videoRect.height * sourceRatio;
      offsetY = 0;
      offsetX = (videoRect.width - displayedWidth) / 2;
    }

    const scanX = scanRect.left - videoRect.left - offsetX;
    const scanY = scanRect.top - videoRect.top - offsetY;

    const scaleX = video.videoWidth / displayedWidth;
    const scaleY = video.videoHeight / displayedHeight;

    let sourceX = scanX * scaleX;
    let sourceY = scanY * scaleY;
    let sourceWidth = scanRect.width * scaleX;
    let sourceHeight = scanRect.height * scaleY;

    sourceX = Math.max(0, sourceX);
    sourceY = Math.max(0, sourceY);
    sourceWidth = Math.min(sourceWidth, video.videoWidth - sourceX);
    sourceHeight = Math.min(sourceHeight, video.videoHeight - sourceY);

    canvas.width = Math.round(sourceWidth);
    canvas.height = Math.round(sourceHeight);

    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  async function captureLabel() {
    const imageData = getCroppedImageDataUrl();

    if (!imageData) {
      alert("A câmera ainda não está pronta.");
      return;
    }

    const stream = videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    setCapturedImage(imageData);
    setOcrError("");
    setOcrProgress(20);
    setMode("processing");

    try {
      const resposta = await fetch("/api/ler-etiqueta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: imageData,
        }),
      });

      setOcrProgress(80);

      const corpoBruto = await resposta.text();

      let dados;

      try {
        dados = corpoBruto ? JSON.parse(corpoBruto) : {};
      } catch {
        dados = corpoBruto;
      }

      if (!resposta.ok) {
        const mensagem =
          (typeof dados?.error === "string" && dados.error) ||
          `Erro ${resposta.status} ao ler a etiqueta.`;

        throw new Error(mensagem);
      }

      const enderecoLimpo = obterEnderecoDaResposta(dados);

      if (!enderecoLimpo) {
        throw new Error(
          "O Gemini não encontrou um endereço. Digite manualmente."
        );
      }

      setOcrProgress(100);
      setRecognizedText(enderecoLimpo);
      setMode("review");
    } catch (error) {
      console.error("Erro ao ler a etiqueta com Gemini:", error);

      setOcrProgress(100);
      setOcrError(
        error?.message ||
          "Não foi possível reconhecer o endereço automaticamente. Digite manualmente abaixo."
      );
      setRecognizedText("");
      setMode("review");
    }
  }

  function retakePhoto() {
    setCapturedImage(null);
    setRecognizedText("");
    setOcrError("");
    setOcrProgress(0);
    setMode("camera");
  }

function confirmAddress() {
  const address = recognizedText.trim();

  if (!address) {
    alert("Digite ou confirme o endereço antes de continuar.");
    return;
  }

  if (typeof onSave !== "function") {
    alert("Não foi possível salvar a entrega.");
    return;
  }

  const novaEntrega = {
    id: crypto.randomUUID(),
    customer: "",
    address,
    phone: "",
    notes: "",
    completed: false,
    createdAt: new Date().toISOString(),
    coords: null,
    priority: "normal",
  };

  onSave(novaEntrega);

  setScannedCount((total) => total + 1);

  setSuccessMessage(
    "✅ Entrega adicionada. Escaneie a próxima etiqueta."
  );

  setCapturedImage(null);
  setRecognizedText("");
  setOcrError("");
  setOcrProgress(0);

  setMode("camera");
}
function finishScanning() {
  navigate("/");
}
  return (
    <div
      style={{
        padding: "24px",
        color: "white",
        paddingBottom: "120px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <button type="button" onClick={() => navigate("/")}>
          ← Sair
        </button>
        <span>📦 {scannedCount} {scannedCount === 1 ? "entrega" : "entregas"}</span>
      </div>

      <h1 style={{ marginBottom: 20 }}>
        {mode === "camera" && "📷 Escaneando etiquetas"}
        {mode === "processing" && "🤖 Lendo endereço com Gemini..."}
        {mode === "review" && "✅ Confirme o endereço"}
      </h1>
      {successMessage && (
  <div
    style={{
      marginBottom: 16,
      padding: 14,
      borderRadius: 12,
      background: "#064e3b",
      color: "#d1fae5",
      fontWeight: 700,
    }}
  >
    {successMessage}
  </div>
)}

      {mode === "camera" && (
        <>
          <div
            ref={videoBoxRef}
            style={{
              position: "relative",
              width: "100%",
              height: "55vh",
              maxHeight: 560,
              minHeight: 380,
              overflow: "hidden",
              borderRadius: 18,
              border: "2px solid #475569",
              background: "#020617",
            }}
          >
            {cameraError ? (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 30,
                  textAlign: "center",
                }}
              >
                {cameraError}
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#020617",
                }}
              />
            )}

            <div
              ref={scanBoxRef}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "82%",
                aspectRatio: "1.6 / 1",
                border: "4px solid #22c55e",
                borderRadius: 18,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.32)",
                pointerEvents: "none",
              }}
            />
          </div>

          <button
            type="button"
            onClick={captureLabel}
            style={{
              width: "100%",
              marginTop: 20,
              padding: "16px 20px",
              borderRadius: 14,
              border: "none",
              fontSize: 17,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📸 Capturar etiqueta
        </button>

            {scannedCount > 0 && (
              <button
                type="button"
                onClick={finishScanning}
                style={{
                width: "100%",
                marginTop: 12,
                padding: "15px 20px",
                borderRadius: 14,
                border: "1px solid #475569",
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                background: "#0f172a",
                color: "white",
    }}
  >
    ✅ Finalizar escaneamento ({scannedCount})
  </button>
)}
        

          <p style={{ marginTop: 14, opacity: 0.75, textAlign: "center" }}>
            Enquadre a área do endereço dentro da moldura.
          </p>
        </>
      )}

      {mode === "processing" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "60px 20px",
          }}
        >
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Etiqueta capturada"
              style={{
                maxWidth: "100%",
                borderRadius: 12,
                opacity: 0.6,
              }}
            />
          )}

          <div style={{ fontSize: 16 }}>
            🤖 Lendo o endereço... {ocrProgress}%
          </div>

          <div
            style={{
              width: "100%",
              height: 8,
              borderRadius: 4,
              background: "#1e293b",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${ocrProgress}%`,
                height: "100%",
                background: "#22c55e",
                transition: "width 0.2s ease",
              }}
            />
          </div>
        </div>
      )}

      {mode === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Etiqueta capturada"
              style={{
                width: "100%",
                borderRadius: 12,
                border: "1px solid #334155",
              }}
            />
          )}

          {ocrError && (
            <div style={{ color: "#f87171", fontSize: 14 }}>{ocrError}</div>
          )}

          <label style={{ fontSize: 14, opacity: 0.85 }}>
            Endereço reconhecido — confira e edite se precisar:
          </label>

          <textarea
            value={recognizedText}
            onChange={(e) => setRecognizedText(e.target.value)}
            rows={6}
            placeholder="Digite o endereço aqui"
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #475569",
              background: "#0f172a",
              color: "white",
              fontSize: 15,
              resize: "vertical",
            }}
          />

          <button
            type="button"
            onClick={confirmAddress}
            style={{
              width: "100%",
              padding: "16px 20px",
              borderRadius: 14,
              border: "none",
              fontSize: 17,
              fontWeight: 700,
              cursor: "pointer",
              background: "#22c55e",
              color: "#052e16",
            }}
          >
            ✅ Confirmar endereço
          </button>

          <button
            type="button"
            onClick={retakePhoto}
            style={{
              width: "100%",
              padding: "14px 20px",
              borderRadius: 14,
              border: "1px solid #475569",
              fontSize: 15,
              cursor: "pointer",
              background: "transparent",
              color: "white",
            }}
          >
            🔄 Tirar outra foto
          </button>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}