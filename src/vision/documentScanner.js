import cvImport from "@techstark/opencv-js";

async function carregarOpenCV() {
  const cv = await cvImport;

  if (cv?.Mat) {
    return cv;
  }

  return new Promise((resolve) => {
    cv.onRuntimeInitialized = () => resolve(cv);
  });
}

function carregarImagem(imageData) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar a imagem."));
    image.src = imageData;
  });
}

export async function melhorarImagemDocumento(imageData) {
  const cv = await carregarOpenCV();
  const image = await carregarImagem(imageData);

  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = image.naturalWidth;
  inputCanvas.height = image.naturalHeight;

  const inputContext = inputCanvas.getContext("2d");

  if (!inputContext) {
    throw new Error("Não foi possível preparar a imagem.");
  }

  inputContext.drawImage(image, 0, 0);

  const outputCanvas = document.createElement("canvas");

  const source = cv.imread(inputCanvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const processed = new cv.Mat();

  try {
    // Converte para tons de cinza
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);

    // Suaviza pequenos ruídos da fotografia
    cv.GaussianBlur(
      gray,
      blurred,
      new cv.Size(3, 3),
      0,
      0,
      cv.BORDER_DEFAULT
    );

    // Deixa o texto escuro e o papel claro
    cv.adaptiveThreshold(
      blurred,
      processed,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      31,
      15
    );

    cv.imshow(outputCanvas, processed);

    return outputCanvas.toDataURL("image/png");
  } finally {
    source.delete();
    gray.delete();
    blurred.delete();
    processed.delete();
  }
}