import { authenticate, cors, body } from '../server/appleSubscriptions.js';
import { googleConfigured, refreshGoogleSubscription, refreshGooglePlan } from '../server/googleSubscriptions.js';
const usage = new Map();
export function OPTIONS(request) {
  const headers = cors(request);
  return new Response(null, { status: headers ? 204 : 403, headers: headers || {} });
}
export async function POST(request) {
  const headers = cors(request);
  if (!headers) return Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
  if (!googleConfigured()) return Response.json({ error: 'Assinaturas Google Play ainda não disponíveis.' }, { status: 503, headers });
  try {
    const user = await authenticate(request);
    if (!user) return Response.json({ error: 'Entre novamente na sua conta.' }, { status: 401, headers });
    const now = Date.now();
    for (const [id, entry] of usage) if (entry.until <= now) usage.delete(id);
    if (!usage.has(user.id)) {
      if (usage.size >= 2048) return Response.json({ error: 'Tente novamente em um minuto.' }, { status: 429, headers });
      usage.set(user.id, { count: 0, until: now + 60000 });
    }
    if (++usage.get(user.id).count > 30) return Response.json({ error: 'Aguarde um minuto.' }, { status: 429, headers });
    const input = await body(request, 8192);
    if (input.operation === 'status') return Response.json(await refreshGooglePlan(user.id), { headers });
    if (input.operation !== 'verify' || typeof input.purchaseToken !== 'string' ||
      !/^[A-Za-z0-9._~+\/-]{10,4096}$/.test(input.purchaseToken)) {
      return Response.json({ error: 'Comprovante inválido.' }, { status: 400, headers });
    }
    return Response.json(await refreshGoogleSubscription(input.purchaseToken, user.id), { headers });
  } catch (error) {
    if (['SUBSCRIPTION_OWNER_MISMATCH', 'TEST_NOT_ALLOWED', 'PRODUCT_MISMATCH'].includes(error.message)) {
      return Response.json({ error: error.message === 'SUBSCRIPTION_OWNER_MISMATCH'
        ? 'Esta assinatura pertence a outra conta DaRota.' : 'Esta compra não está autorizada para esta conta.' }, { status: 403, headers });
    }
    if (error.message === 'INVALID_REQUEST' || error instanceof SyntaxError) return Response.json({ error: 'Solicitação inválida.' }, { status: 400, headers });
    console.error('DAROTA_GOOGLE_VERIFY_FAILED', { code: ['GOOGLE_AUTH_FAILED', 'GOOGLE_API_FAILED',
      'SUBSCRIPTION_SAVE_FAILED', 'STATUS_UNAVAILABLE'].includes(error.message) ? error.message : 'UNCLASSIFIED',
      httpStatus: Number.isInteger(error.httpStatus) ? error.httpStatus : null });
    return Response.json({ error: 'Não foi possível confirmar a assinatura. Use Restaurar compras para tentar novamente.' }, { status: 502, headers });
  }
}
