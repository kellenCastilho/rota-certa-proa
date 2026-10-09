import { useEffect, useState } from 'react';
import { subscriptionsEnabled, loadSubscriptionProduct, purchaseSubscription, synchronizeSubscription, subscriptionStore, manageSubscriptionUrl } from '../services/subscriptionPurchases';
export default function Subscription({ userId }) {
  const [product, setProduct] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [premium, setPremium] = useState(false);
  const enabled = subscriptionsEnabled();
  const store = subscriptionStore();
  useEffect(() => {
    let active = true;
    setProduct(null); setPremium(false); setMessage('');
    if (enabled) {
      loadSubscriptionProduct().then(p => { if (active) setProduct(p); }).catch(e => { if (active) setMessage(e.message); });
      synchronizeSubscription(userId).then(s => { if (active) setPremium(s.premium); }).catch(e => { if (active) setMessage(e.message); });
    }
    return () => { active = false; };
  }, [userId, enabled]);
  async function act(restore) {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const result = restore ? await synchronizeSubscription(userId, true) : await purchaseSubscription(userId);
      if (result.status === 'cancelled') setMessage('Compra cancelada.');
      else if (result.status === 'pending') setMessage(`A compra aguarda aprovação na ${store}. O plano será liberado após a confirmação.`);
      else { setPremium(result.premium); setMessage(result.premium ? 'Seu Premium está ativo!' : 'Nenhuma assinatura ativa confirmada para esta conta.'); }
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <main className="page"><section className="premium-card" style={{padding:24, maxWidth:560, margin:'0 auto'}}>
    <span className="eyebrow">SEU PLANO</span><h1>DaRota Premium</h1>
    <p>Cadastre mais entregas, importe listas completas e organize suas rotas por bairros.</p>
    <p>O plano gratuito permite cinco novos cadastros de entrega por dia, por conta. O dia renova à meia-noite no horário de Brasília.</p>
    {enabled ? <>
      <h2>{premium ? 'Premium ativo' : product ? `${product.price} / mês` : `Consultando preço na ${store}…`}</h2>
      <p>Assinatura mensal com renovação automática. O pagamento é confirmado pela {store}. Você pode cancelar nos ajustes de assinaturas da loja; o acesso continua até o fim do período pago.</p>
      {!premium && <button type="button" disabled={busy || !product} onClick={() => act(false)}>{busy ? 'Aguarde…' : 'Assinar Premium'}</button>}
      <button type="button" disabled={busy} onClick={() => act(true)} style={{display:'block',marginTop:16}}>Restaurar compras</button>
      <a href={manageSubscriptionUrl()} style={{display:'block',marginTop:16}}>Gerenciar assinatura na {store}</a>
    </> : <p>A assinatura ainda não está disponível nesta versão.</p>}
    <p role="status" aria-live="polite">{message}</p>
    <p><a href={store === "Google Play" ? import.meta.env.VITE_DAROTA_ANDROID_TERMS_URL : "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"} target="_blank" rel="noopener noreferrer">Termos de uso</a> · <a href="https://sites.google.com/view/darota-poltica-de-privacidade/home" target="_blank" rel="noopener noreferrer">Política de privacidade</a></p>
  </section></main>;
}
