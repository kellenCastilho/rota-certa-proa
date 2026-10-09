import { Capacitor } from '@capacitor/core';
import * as apple from './applePurchases';
import * as google from './googlePurchases';
export const subscriptionsEnabled = () => apple.iosSubscriptionsEnabled() || google.androidSubscriptionsEnabled();
const isAndroid = () => Capacitor.getPlatform() === 'android';
export const subscriptionStore = () => isAndroid() ? 'Google Play' : 'App Store';
export const loadSubscriptionProduct = () => isAndroid() ? google.loadGoogleProduct() : apple.loadAppleProduct();
export const purchaseSubscription = id => isAndroid() ? google.purchaseGooglePlan(id) : apple.purchaseApplePlan(id);
export const synchronizeSubscription = (id, restore = false) => isAndroid() ? google.synchronizeGooglePlan(id) : apple.synchronizeApplePlan(id, restore);
export const listenSubscriptionTransactions = fn => isAndroid() ? google.listenGoogleTransactions(fn) : apple.listenAppleTransactions(fn);
export const manageSubscriptionUrl = () => isAndroid()
  ? 'https://play.google.com/store/account/subscriptions?sku=darota_premium_mensal&package=com.kellencastilho.darota'
  : 'https://apps.apple.com/account/subscriptions';
