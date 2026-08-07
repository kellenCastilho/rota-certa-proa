import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function ScanPage() {
  const navigate = useNavigate();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const videoBoxRef = useRef(null);
  const scanBoxRef = useRef(null);

  const [cameraError, setCameraError] = useState("");

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

    openCamera();

    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  function captureLabel() {
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
      alert("A câmera ainda não está pronta.");
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      alert("Não foi possível capturar a imagem.");
      return;
    }

    /*
      Medidas reais na tela do celular.
    */
    const videoRect = videoBox.getBoundingClientRect();
    const scanRect = scanBox.getBoundingClientRect();

    /*
      Como o vídeo usa objectFit: contain, precisamos descobrir
      qual parte do elemento realmente contém a imagem da câmera.
    */

    const sourceRatio = video.videoWidth / video.videoHeight;
    const displayRatio = videoRect.width / videoRect.height;

    let displayedWidth;
    let displayedHeight;
    let offsetX;
    let offsetY;

    if (sourceRatio > displayRatio) {
      // Sobram faixas em cima e embaixo
      displayedWidth = videoRect.width;
      displayedHeight = videoRect.width / sourceRatio;

      offsetX = 0;
      offsetY = (videoRect.height - displayedHeight) / 2;
    } else {
      // Sobram faixas nas laterais
      displayedHeight = videoRect.height;
      displayedWidth = videoRect.height * sourceRatio;

      offsetY = 0;
      offsetX = (videoRect.width - displayedWidth) / 2;
    }

    /*
      Posição da moldura em relação à imagem visível.
    */
    const scanX =
      scanRect.left - videoRect.left - offsetX;

    const scanY =
      scanRect.top - videoRect.top - offsetY;

    /*
      Escala entre pixels exibidos e pixels reais da câmera.
    */
    const scaleX = video.videoWidth / displayedWidth;
    const scaleY = video.videoHeight / displayedHeight;

    let sourceX = scanX * scaleX;
    let sourceY = scanY * scaleY;
    let sourceWidth = scanRect.width * scaleX;
    let sourceHeight = scanRect.height * scaleY;

    /*
      Proteção para não sair dos limites da câmera.
    */
    sourceX = Math.max(0, sourceX);
    sourceY = Math.max(0, sourceY);

    sourceWidth = Math.min(
      sourceWidth,
      video.videoWidth - sourceX
    );

    sourceHeight = Math.min(
      sourceHeight,
      video.videoHeight - sourceY
    );

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

    const imageData = canvas.toDataURL(
      "image/jpeg",
      0.92
    );

    sessionStorage.setItem(
      "capturedImage",
      imageData
    );

    navigate("/confirmar-endereco");
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
        <button
          type="button"
          onClick={() => navigate("/")}
        >
          ← Sair
        </button>

        <span>📦 0 entregas</span>
      </div>

      <h1
        style={{
          marginBottom: 20,
        }}
      >
        📷 Escaneando etiquetas
      </h1>

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

            boxShadow:
              "0 0 0 9999px rgba(0,0,0,0.32)",

            pointerEvents: "none",
          }}
        />
      </div>

      <canvas
        ref={canvasRef}
        style={{ display: "none" }}
      />

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

      <p
        style={{
          marginTop: 14,
          opacity: 0.75,
          textAlign: "center",
        }}
      >
        Enquadre a área do endereço dentro da moldura.
      </p>
    </div>
  );
}