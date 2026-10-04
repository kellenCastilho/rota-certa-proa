package com.kellencastilho.darota;

import android.Manifest;
import android.content.Intent;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.location.Geocoder;
import android.location.Address;
import java.util.Locale;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name="DaRotaNavigation", permissions={
    @Permission(alias="location", strings={Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
    @Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})
})
public class NavigationPlugin extends Plugin {
    private final ExecutorService addressWorker = Executors.newFixedThreadPool(2);
    private final Handler addressHandler = new Handler(Looper.getMainLooper());
    @PluginMethod public void geocode(PluginCall call) {
        String query = call.getString("query", "").trim();
        if (query.isEmpty()) { call.reject("Endereço vazio."); return; }
        if (!Geocoder.isPresent()) { call.reject("Busca de endereços Android indisponível."); return; }
        AtomicBoolean finished = new AtomicBoolean(false);
        Runnable timeout = () -> { if (finished.compareAndSet(false, true)) call.reject("A busca Android demorou demais."); };
        addressHandler.postDelayed(timeout, 15000);
        addressWorker.execute(() -> {
            try {
                Geocoder geocoder = new Geocoder(getContext(), new Locale("pt", "BR"));
                List<Address> addresses = geocoder.getFromLocationName(query, 5);
                JSArray results = new JSArray();
                if (addresses != null) for (Address a : addresses) {
                    if (!a.hasLatitude() || !a.hasLongitude()) continue;
                    JSObject item = new JSObject();
                    item.put("lat", a.getLatitude()); item.put("lng", a.getLongitude());
                    item.put("road", a.getThoroughfare()); item.put("houseNumber", a.getSubThoroughfare());
                    item.put("city", a.getLocality() != null ? a.getLocality() : a.getSubAdminArea());
                    item.put("countryCode", a.getCountryCode());
                    results.put(item);
                }
                if (finished.compareAndSet(false, true)) {
                    addressHandler.removeCallbacks(timeout);
                    JSObject response = new JSObject(); response.put("results", results); call.resolve(response);
                }
            } catch (Exception error) {
                if (finished.compareAndSet(false, true)) {
                    addressHandler.removeCallbacks(timeout); call.reject("Não foi possível buscar o endereço no Android.", null, error);
                }
            }
        });
    }
    @Override public void load() { NavigationService.observer = this; }
    @Override protected void handleOnDestroy() {
        addressWorker.shutdownNow();
        addressHandler.removeCallbacksAndMessages(null);
        if (NavigationService.observer == this) NavigationService.observer = null;
    }
    void publish(JSObject state) { notifyListeners("navigationState", state); }
    @PluginMethod public void getState(PluginCall call) { call.resolve(NavigationService.snapshot); }
    @PluginMethod public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location",call,"locationResult"); return;
        }
        if (Build.VERSION.SDK_INT>=33 && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications",call,"notificationResult"); return;
        }
        launch(call);
    }
    @PermissionCallback private void locationResult(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Permita localização precisa para iniciar a navegação."); return;
        }
        start(call);
    }
    @PermissionCallback private void notificationResult(PluginCall call) { launch(call); }
    private void launch(PluginCall call) {
        JSObject destination=call.getObject("destination");
        if (destination==null || !destination.has("lat") || !destination.has("lng")) { call.reject("Destino sem coordenadas."); return; }
        double lat=destination.optDouble("lat",Double.NaN), lng=destination.optDouble("lng",Double.NaN);
        if (!Double.isFinite(lat)||!Double.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) { call.reject("Coordenadas inválidas."); return; }
        LocationManager manager=(LocationManager)getContext().getSystemService(android.content.Context.LOCATION_SERVICE);
        if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) { call.reject("Ative a localização/GPS do telefone."); return; }
        Intent intent=new Intent(getContext(),NavigationService.class).setAction("START")
            .putExtra("lat",lat).putExtra("lng",lng).putExtra("destinationId",call.getString("destinationId",""));
        try {
            if (Build.VERSION.SDK_INT>=26) getContext().startForegroundService(intent); else getContext().startService(intent);
            call.resolve();
        } catch (Exception e) { call.reject("Não foi possível iniciar o GPS. Abra o aplicativo e tente novamente.",null,e); }
    }
    @PluginMethod public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(),NavigationService.class)); call.resolve();
    }
    @PluginMethod public void repeat(PluginCall call) {
        NavigationService service=NavigationService.running;
        if (service!=null) service.repeat();
        call.resolve();
    }
}
