import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [cameraError, setCameraError] = useState("");
  const [capturedImage, setCapturedImage] = useState(null);
useEffect(() => {
  let cameraStream;

  async function openCamera() {
    try {
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

      alert(`${error.name}\n\n${error.message}`);

      setCameraError(`${error.name} - ${error.message}`);
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

  if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
    alert("A câmera ainda não está pronta.");
    return;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    alert("Não foi possível capturar a imagem.");
    return;
  }

  // Mesmas proporções da moldura verde
  const cropWidth = video.videoWidth * 0.78;
  const cropHeight = cropWidth / 1.6;

  // Centraliza o recorte
  const cropX = (video.videoWidth - cropWidth) / 2;
  const cropY = (video.videoHeight - cropHeight) / 2;

  canvas.width = cropWidth;
  canvas.height = cropHeight;

  context.drawImage(
    video,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  const imageData = canvas.toDataURL("image/png");

  sessionStorage.setItem("capturedImage", imageData);
  navigate("/confirmar-endereco");
}


  return (
    <div style={{ padding: "30px", color: "white" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <button onClick={() => navigate("/")}>← Sair</button>

        <span>📦 0 entregas</span>
      </div>

      <h1>📷 Escaneando etiquetas</h1>

      <div
        style={{
          position: "relative",
          height: "360px",
          border: "2px solid #64748b",
          borderRadius: "18px",
          overflow: "hidden",
          marginTop: "24px",
          marginBottom: "18px",
          background: "#020617",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {cameraError ? (
          <p style={{ padding: "20px", textAlign: "center" }}>
            {cameraError}
          </p>
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
            }}
          />
        )}
      </div>
      <canvas
        ref={canvasRef}
        style={{ display: "none" }}
      />
      <div
  style={{
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "78%",
    height: "32%",
    border: "4px solid #22c55e",
    borderRadius: "16px",
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
    pointerEvents: "none",
  }}
/>

      <button onClick={captureLabel}>
        📸 Capturar etiqueta
    {capturedImage && (
      <div style={{ marginTop: "20px" }}>
      <h3>Imagem capturada</h3>

      <img
        src={capturedImage}
        alt="Etiqueta"
        style={{
          width: "300px",
          borderRadius: "12px",
      }}
     />
      </div>
    )}
      </button>

      <p>Aponte a câmera para uma etiqueta.</p>

      <div style={{ textAlign: "right", marginTop: "20px" }}>
        <button>✅ Finalizar</button>
      </div>
    </div>
  );
}