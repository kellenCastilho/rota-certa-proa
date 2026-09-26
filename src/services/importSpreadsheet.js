import { readSheet } from "read-excel-file/browser";

const ALIASES = {
  address: [
    "destination address",
    "endereco",
    "endereço",
    "address",
    "endereco destino",
    "endereço destino",
  ],

  neighborhood: [
    "bairro",
    "neighborhood",
    "district",
  ],

  city: [
    "city",
    "cidade",
    "municipio",
    "município",
  ],

  state: [
    "state",
    "estado",
    "uf",
  ],

  zip: [
    "zipcode",
    "zip code",
    "postal code",
    "cep",
  ],

  latitude: [
    "latitude",
    "lat",
  ],

  longitude: [
    "longitude",
    "lng",
    "lon",
    "long",
  ],

  customer: [
    "recipient",
    "consignee",
    "destinatario",
    "destinatário",
    "cliente",
    "customer",
    "nome",
  ],

  phone: [
    "contact",
    "phone",
    "telefone",
    "celular",
    "contato",
  ],

  packageCode: [
    "spx tn",
    "tracking number",
    "tracking",
    "codigo do pacote",
    "código do pacote",
    "package",
    "awb",
  ],

  stop: [
    "stop",
    "sequence",
    "sequencia",
    "sequência",
    "parada",
    "ordem",
  ],
};

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function text(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function findColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalize);

  let index = headers.findIndex((header) =>
    normalizedAliases.includes(normalize(header))
  );

  if (index !== -1) {
    return index;
  }

  index = headers.findIndex((header) => {
    const normalizedHeader = normalize(header);

    return normalizedAliases.some(
      (alias) =>
        normalizedHeader.includes(alias) ||
        alias.includes(normalizedHeader)
    );
  });

  return index;
}

function headerScore(row) {
  if (!Array.isArray(row)) {
    return 0;
  }

  const headers = row.map(normalize);

  let score = 0;

  Object.entries(ALIASES).forEach(
    ([key, aliases]) => {
      const found = findColumn(headers, aliases);

      if (found !== -1) {
        score += key === "address" ? 5 : 1;
      }
    }
  );

  return score;
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 20);

  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < limit; i += 1) {
    const score = headerScore(rows[i]);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 || bestScore < 5) {
    throw new Error(
      "Não consegui identificar a coluna de endereço da planilha."
    );
  }

  return bestIndex;
}

function parseCoordinate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(
    String(value)
      .trim()
      .replace(",", ".")
  );

  return Number.isFinite(parsed) ? parsed : null;
}

function buildCoords(latitude, longitude) {
  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);

  if (
    lat === null ||
    lng === null ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  if (lat === 0 && lng === 0) {
    return null;
  }

  return {
    lat,
    lng,
  };
}

function addUniquePart(parts, value) {
  const cleanValue = text(value);

  if (!cleanValue) {
    return;
  }

  const normalizedValue = normalize(cleanValue);

  const alreadyExists = parts.some((part) =>
    normalize(part).includes(normalizedValue)
  );

  if (!alreadyExists) {
    parts.push(cleanValue);
  }
}

function buildAddress({
  address,
  neighborhood,
  city,
  state,
  zip,
}) {
  const parts = [];

  addUniquePart(parts, address);
  addUniquePart(parts, neighborhood);
  addUniquePart(parts, city);
  addUniquePart(parts, state);
  addUniquePart(parts, zip);

  return parts.join(", ");
}

function detectSource(headers) {
  const joined = headers
    .map(normalize)
    .join(" ");

  if (
    joined.includes("spx") ||
    joined.includes("spx tn") ||
    (["address", "city", "state", "contact"].every(
      (header) => headers.map(normalize).includes(header)
    ))
  ) {
    return "Shopee/SPX";
  }

  if (joined.includes("mercado livre")) {
    return "Mercado Livre";
  }

  if (joined.includes("shein")) {
    return "Shein";
  }

  return "Planilha";
}

export function parseCsvText(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const next = csvText[index + 1];

    if (character === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }

      row.push(value);
      if (row.some((cell) => text(cell))) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => text(cell))) {
    rows.push(row);
  }

  return rows;
}

export function extractNeighborhood(address, city) {
  const parts = text(address)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const normalizedCity = normalize(city);
  const cityIndex = parts.findIndex(
    (part) => normalize(part) === normalizedCity
  );

  if (cityIndex > 0) {
    const candidate = parts[cityIndex - 1];
    const invalidPlaces = new Set([
      "brasil", "acre", "alagoas", "amapa", "amazonas", "bahia",
      "ceara", "distrito federal", "espirito santo", "goias",
      "maranhao", "mato grosso", "mato grosso do sul", "minas gerais",
      "para", "paraiba", "parana", "pernambuco", "piaui",
      "rio de janeiro", "rio grande do norte", "rio grande do sul",
      "rondonia", "roraima", "santa catarina", "sao paulo",
      "sergipe", "tocantins",
    ]);
    const normalizedCandidate = normalize(candidate);

    if (
      invalidPlaces.has(normalizedCandidate) ||
      /^[a-z]{2}$/.test(normalizedCandidate) ||
      /^(rua|avenida|av|travessa|alameda|rodovia|praca)\b/.test(normalizedCandidate) ||
      /^\d/.test(normalizedCandidate)
    ) {
      return "";
    }

    return candidate;
  }

  return "";
}

function makeId(index) {
  if (
    typeof crypto !== "undefined" &&
    crypto.randomUUID
  ) {
    return crypto.randomUUID();
  }

  return `import-${Date.now()}-${index}`;
}

export async function importSpreadsheet(file) {
  if (!file) {
    throw new Error("Nenhum arquivo selecionado.");
  }

  const fileName = file.name?.toLowerCase() || "";

  const isCsv = fileName.endsWith(".csv");
  const isXlsx = fileName.endsWith(".xlsx");

  if (!isCsv && !isXlsx) {
    throw new Error(
      "Selecione uma planilha da Shopee em .csv ou uma planilha Excel em .xlsx."
    );
  }

  const rows = isCsv
    ? parseCsvText((await file.text()).replace(/^\uFEFF/, ""))
    : await readSheet(file);

  if (!rows?.length) {
    throw new Error("A planilha está vazia.");
  }

  const headerRowIndex = findHeaderRow(rows);

  const headers = rows[headerRowIndex];

  const indexes = {
    address: findColumn(
      headers,
      ALIASES.address
    ),

    neighborhood: findColumn(
      headers,
      ALIASES.neighborhood
    ),

    city: findColumn(
      headers,
      ALIASES.city
    ),

    state: findColumn(
      headers,
      ALIASES.state
    ),

    zip: findColumn(
      headers,
      ALIASES.zip
    ),

    latitude: findColumn(
      headers,
      ALIASES.latitude
    ),

    longitude: findColumn(
      headers,
      ALIASES.longitude
    ),

    customer: findColumn(
      headers,
      ALIASES.customer
    ),

    phone: findColumn(
      headers,
      ALIASES.phone
    ),

    packageCode: findColumn(
      headers,
      ALIASES.packageCode
    ),

    stop: findColumn(
      headers,
      ALIASES.stop
    ),
  };

  const source = detectSource(headers);

  const deliveries = [];
  let ignoredRows = 0;

  const dataRows = rows.slice(
    headerRowIndex + 1
  );

  dataRows.forEach((row, index) => {
    const get = (columnIndex) => {
      if (columnIndex === -1) {
        return "";
      }

      return row[columnIndex];
    };

    const rawAddress = text(
      get(indexes.address)
    );

    if (!rawAddress) {
      ignoredRows += 1;
      return;
    }

    const city = text(
      get(indexes.city)
    );

    const neighborhood =
      text(get(indexes.neighborhood)) ||
      extractNeighborhood(rawAddress, city);

    const state = text(
      get(indexes.state)
    );

    const zip = text(
      get(indexes.zip)
    );

    const customer = text(
      get(indexes.customer)
    );

    const phone = text(
      get(indexes.phone)
    );

    const packageCode = text(
      get(indexes.packageCode)
    );

    const originalStop = text(
      get(indexes.stop)
    );

    const address = buildAddress({
      address: rawAddress,
      neighborhood,
      city,
      state,
      zip,
    });

    const coords = buildCoords(
      get(indexes.latitude),
      get(indexes.longitude)
    );

    const notesParts = [];

    if (source !== "Planilha") {
      notesParts.push(`Origem: ${source}`);
    }

    if (packageCode) {
      notesParts.push(
        `Pacote: ${packageCode}`
      );
    }

    if (originalStop) {
      notesParts.push(
        `Parada original: ${originalStop}`
      );
    }

    if (phone) {
      notesParts.push(`Telefone: ${phone}`);
    }

    deliveries.push({
      id: makeId(index),

      customer:
        customer ||
        packageCode ||
        `Entrega ${index + 1}`,

      address,

      phone,

      notes: notesParts.join(" • "),

      completed: false,

      createdAt: new Date().toISOString(),

      coords,

      priority: "normal",

      source,

      packageCode,

      originalStop,

      neighborhood:
        neighborhood ||
        "Bairro não identificado",
    });
  });

  if (!deliveries.length) {
    throw new Error(
      "Nenhuma entrega válida foi encontrada na planilha."
    );
  }

  return {
    source,
    deliveries,
    ignoredRows,
    totalRows: dataRows.length,
    headers,
  };
}
