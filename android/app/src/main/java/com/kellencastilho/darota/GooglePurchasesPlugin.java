package com.kellencastilho.darota;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.android.billingclient.api.*;
import java.util.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import android.os.Handler;
import android.os.Looper;

@CapacitorPlugin(name = "DaRotaGooglePurchases")
public class GooglePurchasesPlugin extends Plugin {
    private static final String PRODUCT = "darota_premium_mensal", PLAN = "mensal";
    private BillingClient billing;
    private PluginCall pendingPurchase;
    private final List<Runnable> waiting = new ArrayList<>();
    private boolean connecting;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable connectionTimeout = () -> failConnection();
    private final Runnable purchaseTimeout = () -> {
        if (pendingPurchase != null) {
            PluginCall call = pendingPurchase; pendingPurchase = null;
            call.reject("A confirmação demorou. Use Restaurar compras antes de tentar novamente.");
        }
    };
    @Override public void load() {
        billing = BillingClient.newBuilder(getContext())
            .setListener(this::purchasesUpdated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection().build();
    }
    private void ready(PluginCall call, Runnable work) {
        getActivity().runOnUiThread(() -> {
            if (billing.isReady()) { work.run(); return; }
            // Every queued request is released on both success and failure.
            waiting.add(() -> { if (billing.isReady()) work.run(); else call.reject("Não foi possível conectar ao Google Play. Tente novamente."); });
            if (connecting) return;
            connecting = true;
            handler.postDelayed(connectionTimeout, 20000);
            billing.startConnection(new BillingClientStateListener() {
                @Override public void onBillingSetupFinished(BillingResult result) {
                    getActivity().runOnUiThread(() -> { if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) drain(); else failConnection(); });
                }
                @Override public void onBillingServiceDisconnected() { }
            });
        });
    }
    private void drain() {
        handler.removeCallbacks(connectionTimeout); connecting = false;
        List<Runnable> tasks = new ArrayList<>(waiting); waiting.clear();
        for (Runnable task : tasks) task.run();
    }
    private void failConnection() {
        handler.removeCallbacks(connectionTimeout); connecting = false;
        // If initialization times out, reset the client before subsequent attempts.
        if (!billing.isReady()) { billing.endConnection(); load(); }
        drain();
    }
    private interface ProductCallback { void accept(ProductDetails details, ProductDetails.SubscriptionOfferDetails offer); }
    private void rejectProduct(PluginCall call, String message) {
        getActivity().runOnUiThread(() -> {
            if (pendingPurchase == call) { pendingPurchase = null; handler.removeCallbacks(purchaseTimeout); }
            call.reject(message);
        });
    }
    private void queryProduct(PluginCall call, ProductCallback callback) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(
            Collections.singletonList(QueryProductDetailsParams.Product.newBuilder().setProductId(PRODUCT)
                .setProductType(BillingClient.ProductType.SUBS).build())).build();
        billing.queryProductDetailsAsync(params, (result, response) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { rejectProduct(call, "Não foi possível consultar a assinatura no Google Play."); return; }
            for (ProductDetails details : response.getProductDetailsList()) {
                if (!PRODUCT.equals(details.getProductId()) || details.getSubscriptionOfferDetails() == null) continue;
                for (ProductDetails.SubscriptionOfferDetails offer : details.getSubscriptionOfferDetails()) {
                    List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
                    if (PLAN.equals(offer.getBasePlanId()) && offer.getOfferId() == null && phases.size() == 1 &&
                        "P1M".equals(phases.get(0).getBillingPeriod()) &&
                        phases.get(0).getRecurrenceMode() == ProductDetails.RecurrenceMode.INFINITE_RECURRING) {
                        getActivity().runOnUiThread(() -> callback.accept(details, offer)); return;
                    }
                }
            }
            rejectProduct(call, "Plano mensal indisponível no Google Play para esta conta ou região.");
        });
    }
    @PluginMethod public void product(PluginCall call) {
        ready(call, () -> queryProduct(call, (details, offer) -> {
            JSObject value = new JSObject(); value.put("title", details.getName());
            value.put("price", offer.getPricingPhases().getPricingPhaseList().get(0).getFormattedPrice());
            call.resolve(value);
        }));
    }
    private String accountId(PluginCall call) {
        String id = call.getString("userId", "");
        if (!id.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) return null;
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(("darota:" + id.toLowerCase(Locale.ROOT)).getBytes(StandardCharsets.UTF_8));
            StringBuilder value = new StringBuilder();
            for (byte b : hash) value.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            return value.toString();
        } catch (Exception e) { return null; }
    }
    @PluginMethod public void purchase(PluginCall call) {
        String account = accountId(call);
        if (account == null) { call.reject("Entre novamente na sua conta."); return; }
        ready(call, () -> {
            if (pendingPurchase != null) { call.reject("Uma compra já está em andamento."); return; }
            // Fetch fresh ProductDetails at purchase time rather than caching offers.
            pendingPurchase = call;
            handler.postDelayed(purchaseTimeout, 180000);
            queryProduct(call, (details, offer) -> getActivity().runOnUiThread(() -> {
                if (pendingPurchase != call) return;
                BillingFlowParams params = BillingFlowParams.newBuilder().setObfuscatedAccountId(account)
                    .setProductDetailsParamsList(Collections.singletonList(BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(details).setOfferToken(offer.getOfferToken()).build())).build();
                BillingResult result = billing.launchBillingFlow(getActivity(), params);
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    pendingPurchase = null; handler.removeCallbacks(purchaseTimeout);
                    call.reject(result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED
                        ? "Já existe uma assinatura nesta conta Google. Use Restaurar compras." : "Não foi possível abrir a compra no Google Play.");
                }
            }));
        });
    }
    private JSObject purchaseData(Purchase purchase) {
        JSObject value = new JSObject();
        value.put("status", purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "purchased" : "pending");
        value.put("purchaseToken", purchase.getPurchaseToken()); return value;
    }
    private void purchasesUpdated(BillingResult result, List<Purchase> purchases) {
        getActivity().runOnUiThread(() -> {
            PluginCall call = pendingPurchase; pendingPurchase = null; handler.removeCallbacks(purchaseTimeout);
            if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
                if (call != null) { JSObject value = new JSObject(); value.put("status", "cancelled"); call.resolve(value); } return;
            }
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                if (call != null) call.reject("Não foi possível concluir a compra. Use Restaurar compras."); return;
            }
            if (purchases != null) for (Purchase purchase : purchases) {
                if (!purchase.getProducts().contains(PRODUCT)) continue;
                if (call != null) { call.resolve(purchaseData(purchase)); call = null; }
                notifyListeners("transactionUpdated", new JSObject());
            }
            if (call != null) call.reject("Compra não encontrada. Use Restaurar compras.");
        });
    }
    @PluginMethod public void transactions(PluginCall call) {
        String account = accountId(call);
        if (account == null) { call.reject("Entre novamente na sua conta."); return; }
        ready(call, () -> billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
            (result, purchases) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { call.reject("Não foi possível restaurar as compras."); return; }
                JSArray list = new JSArray();
                for (Purchase purchase : purchases) {
                    if (purchase.getProducts().contains(PRODUCT) && purchase.getAccountIdentifiers() != null &&
                        account.equals(purchase.getAccountIdentifiers().getObfuscatedAccountId())) list.put(purchaseData(purchase));
                }
                JSObject value = new JSObject(); value.put("purchases", list); call.resolve(value);
            }));
    }
    @Override protected void handleOnDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (pendingPurchase != null) { pendingPurchase.reject("Compra interrompida. Use Restaurar compras ao abrir o app."); pendingPurchase = null; }
        billing.endConnection(); waiting.clear();
    }
}
