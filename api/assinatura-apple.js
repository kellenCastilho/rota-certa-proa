import {
  configured,
  authenticate,
  verifyTransaction,
  refreshSubscription,
  cors,
  body,
  admin,
  verifier,
  sandboxAllowed,
} from '../server/appleSubscriptions.js';

import {
  PRODUCT_ID,
  BUNDLE_ID,
} from '../server/appleSubscriptionPolicy.js';

const usage = new Map();

function consume(userId) {
  const now = Date.now();

  for (const [id, entry] of usage) {
    if (entry.until <= now) usage.delete(id);
  }

  if (!usage.has(userId)) {
    if (usage.size >= 2048) return false;
    usage.set(userId, { count: 0, until: now + 60000 });
  }

  return ++usage.get(userId).count <= 30;
}

export function OPTIONS(request) {
  const headers = cors(request);

  return new Response(null, {
    status: headers ? 204 : 403,
    headers: headers || {},
  });
}

export async function POST(request) {
  const headers = cors(request);

  if (!headers) {
    return Response.json(
      { error: 'Origem não autorizada.' },
      { status: 403 },
    );
  }

  if (!configured()) {
    return Response.json(
      { error: 'Assinaturas ainda não disponíveis.' },
      { status: 503, headers },
    );
  }

  let stage = 'authenticate';

  try {
    const user = await authenticate(request);

    if (!user) {
      return Response.json(
        { error: 'Entre novamente na sua conta.' },
        { status: 401, headers },
      );
    }

    if (!consume(user.id)) {
      return Response.json(
        { error: 'Aguarde um minuto antes de tentar novamente.' },
        {
          status: 429,
          headers: { ...headers, 'Retry-After': '60' },
        },
      );
    }

    stage = 'read_request';
    const input = await body(request);

    if (input.operation === 'status') {
      stage = 'read_subscriptions';

      const { data: rows, error } = await admin()
        .from('darota_apple_subscriptions')
        .select('original_transaction_id,environment')
        .eq('user_id', user.id)
        .limit(10);

      if (error) throw new Error('STATUS_UNAVAILABLE');

      stage = 'refresh_saved_subscription';

      for (const row of rows || []) {
        if (
          row.environment === 'Sandbox' &&
          !sandboxAllowed(user.id)
        ) {
          continue;
        }

        await refreshSubscription(
          row.original_transaction_id,
          user.id,
          row.environment,
          await verifier(row.environment),
        );
      }

      stage = 'read_plan';

      const { data: plan, error: planError } = await admin()
        .from('darota_plan_accounts')
        .select('premium_until')
        .eq('user_id', user.id)
        .maybeSingle();

      if (planError) throw new Error('STATUS_UNAVAILABLE');

      return Response.json(
        {
          premium: Date.parse(plan?.premium_until) > Date.now(),
          premiumUntil: plan?.premium_until || null,
        },
        { headers },
      );
    }

    if (
      typeof input.signedTransaction !== 'string' ||
      input.signedTransaction.length > 24000
    ) {
      return Response.json(
        { error: 'Comprovante inválido.' },
        { status: 400, headers },
      );
    }

    stage = 'verify_transaction';

    const result = await verifyTransaction(
      input.signedTransaction,
      user.id,
    );

    const t = result.transaction;

    if (
      t.appAccountToken?.toLowerCase() !== user.id.toLowerCase() ||
      t.productId !== PRODUCT_ID ||
      t.bundleId !== BUNDLE_ID
    ) {
      return Response.json(
        { error: 'Esta assinatura pertence a outra conta DaRota.' },
        { status: 403, headers },
      );
    }

    stage = 'refresh_subscription';

    const state = await refreshSubscription(
      t.originalTransactionId,
      user.id,
      result.environment,
      result.verifier,
    );

    return Response.json(state, { headers });
  } catch (error) {
    // Apenas códigos técnicos: nunca registrar compras, contas ou chaves.
    const allowedCodes = new Set([
      'APPLE_CERTIFICATES_UNAVAILABLE',
      'SANDBOX_NOT_ALLOWED',
      'STATUS_UNAVAILABLE',
      'ENVIRONMENT_MISMATCH',
      'SUBSCRIPTION_NOT_FOUND',
      'SUBSCRIPTION_SAVE_FAILED',
      'INVALID_REQUEST',
    ]);

    console.error('DAROTA_APPLE_VERIFY_FAILED', {
      stage,
      code: allowedCodes.has(error?.message)
        ? error.message
        : 'UNCLASSIFIED',
      verificationStatus: Number.isInteger(error?.status)
        ? error.status
        : null,
      httpStatus: Number.isInteger(error?.httpStatusCode)
        ? error.httpStatusCode
        : null,
      appleError: Number.isInteger(error?.apiError)
        ? error.apiError
        : null,
    });

    return Response.json(
      {
        error:
          'Não foi possível confirmar a assinatura. Use Restaurar compras para tentar novamente.',
      },
      { status: 502, headers },
    );
  }
}