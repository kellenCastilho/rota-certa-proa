package com.kellencastilho.darota;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.os.*;
import android.speech.tts.TextToSpeech;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import org.json.*;
import java.net.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Location, route progression and speech run outside the WebView, including screen off. */
public class NavigationService extends Service implements LocationListener {
    static volatile JSObject snapshot=inactiveState();
    private static JSObject inactiveState() { JSObject state=new JSObject(); state.put("active",false); return state; }
    static volatile NavigationPlugin observer;
    static volatile NavigationService running;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService network=Executors.newSingleThreadExecutor();
    private final Set<String> spoken=new HashSet<>();
    private final Map<String,Integer> lastStage=new HashMap<>();
    private LocationManager locations;
    private TextToSpeech voice;
    private boolean voiceReady, active, fetching, arrived;
    private int generation, offRouteCount, stepIndex;
    private long lastFetch, lastSpeech;
    private double[] destination, position;
    private String destinationId="", instruction="Aguardando GPS", message="Buscando localização precisa...";
    private double turnMeters, durationMinutes;
    private RouteProgress route;
    private JSONArray line=new JSONArray();
    private final List<Turn> turns=new ArrayList<>();
    private PowerManager.WakeLock wakeLock;
    private static final class Turn {
        double along; String type, modifier, street, key;
    }
    private final Runnable renewLock=new Runnable() {
        @Override public void run() {
            if (!active) return;
            // A timed, non-reference-counted lock, released immediately on stop.
            wakeLock.acquire(10*60*1000L);
            main.postDelayed(this,5*60*1000L);
        }
    };
    @Override public void onCreate() {
        super.onCreate(); running=this;
        locations=(LocationManager)getSystemService(LOCATION_SERVICE);
        wakeLock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"DaRota:Navigation");
        wakeLock.setReferenceCounted(false);
        if (Build.VERSION.SDK_INT>=26) {
            NotificationChannel channel=new NotificationChannel("darota_navigation","Navegação DaRota",NotificationManager.IMPORTANCE_LOW);
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
        voice=new TextToSpeech(this,status -> main.post(() -> {
            if (voice==null) return;
            voiceReady=status==TextToSpeech.SUCCESS && voice.setLanguage(new Locale("pt","BR"))>=0;
            if (voiceReady) { voice.setSpeechRate(0.95f); if (active) announce(); }
            else if (active) { message="GPS ativo • voz em português indisponível no aparelho"; publish(); }
        }));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if (intent==null || "STOP".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (!"START".equals(intent.getAction())) return START_NOT_STICKY;
        active=true;
        Notification notification=notification();
        try {
            if (Build.VERSION.SDK_INT>=29) startForeground(714,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(714,notification);
        } catch (RuntimeException failure) {
            active=false; instruction="Navegação não iniciada"; message="O Android não permitiu iniciar o GPS. Abra o app, confira a permissão de localização e tente novamente.";
            publish(); stopSelf(); return START_NOT_STICKY;
        }
        generation++; fetching=false; lastFetch=0; arrived=false; route=null; turns.clear(); line=new JSONArray();
        stepIndex=0; spoken.clear(); lastStage.clear(); position=null; offRouteCount=0; turnMeters=0; durationMinutes=0;
        destination=new double[]{intent.getDoubleExtra("lat",0),intent.getDoubleExtra("lng",0)};
        destinationId=intent.getStringExtra("destinationId");
        instruction="Aguardando GPS"; message="Buscando localização precisa...";
        voice.stop(); lastSpeech=0;
        main.removeCallbacks(renewLock); renewLock.run();
        try {
            locations.removeUpdates(this);
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,1000,2,this,Looper.getMainLooper());
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,2000,5,this,Looper.getMainLooper());
        } catch (SecurityException e) { message="Permissão de localização removida. Reinicie a navegação."; publish(); stopSelf(); }
        publish();
        return START_NOT_STICKY;
    }
    private Notification notification() {
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,NavigationService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this,"darota_navigation")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("DaRota • navegação ativa")
            .setContentText(instruction).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel,"Encerrar",stop).build();
    }
    private void publish() {
        JSObject state=new JSObject();
        state.put("active",active); state.put("destinationId",destinationId);
        state.put("icon",arrived?"🏁":turns.isEmpty()?"⬆️":turns.get(stepIndex).modifier.contains("left")?"⬅️":turns.get(stepIndex).modifier.contains("right")?"➡️":"⬆️");
        state.put("instruction",instruction); state.put("message",message); state.put("turnMeters",turnMeters);
        state.put("durationMinutes",durationMinutes); state.put("arrived",arrived); state.put("line",line);
        if (position!=null) { JSObject p=new JSObject(); p.put("lat",position[0]); p.put("lng",position[1]); state.put("position",p); }
        if (route!=null) state.put("distanceKm",Math.max(0,route.cumulative[route.cumulative.length-1]-route.progress)/1000);
        snapshot=state;
        if (observer!=null) observer.publish(state);
        if (active) ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(714,notification());
    }
    @Override public void onLocationChanged(Location location) {
        if (!active) return;
        if (!location.hasAccuracy() || location.getAccuracy()>40 || SystemClock.elapsedRealtimeNanos()-location.getElapsedRealtimeNanos()>15_000_000_000L) {
            message="Sinal de GPS fraco • aguardando posição precisa"; publish(); return;
        }
        position=new double[]{location.getLatitude(),location.getLongitude()};
        if (route==null) { fetchRoute(); publish(); return; }
        double offset=route.locate(position,true);
        offRouteCount=offset>60?offRouteCount+1:0;
        if (offRouteCount>=3) { message="Fora da rota • recalculando..."; fetchRoute(); publish(); return; }
        message="GPS ativo • funciona com a tela bloqueada";
        while (stepIndex<turns.size()-1 && route.progress>turns.get(stepIndex).along+15) stepIndex++;
        Turn turn=turns.get(stepIndex);
        double remaining=route.cumulative[route.cumulative.length-1]-route.progress;
        // Require proximity to the road endpoint AND actual destination, not a crossing elsewhere.
        double toDestination=RouteProgress.distance(position,destination);
        arrived=arrived || (location.getAccuracy()<=25 && (toDestination<=40 || (remaining<=35 && toDestination<=80)));
        instruction=arrived?"Você chegou à entrega":words(turn);
        turnMeters=Math.max(0,turn.along-route.progress);
        announce(); publish();
    }
    @Override public void onProviderDisabled(String provider) { if (LocationManager.GPS_PROVIDER.equals(provider)) { message="GPS desligado • ative a localização do telefone"; publish(); } }
    @Override public void onProviderEnabled(String provider) { message="Buscando localização precisa..."; publish(); }
    @Override public void onStatusChanged(String provider,int status,Bundle extras) {}
    private void fetchRoute() {
        long now=SystemClock.elapsedRealtime();
        if (fetching || (lastFetch!=0 && now-lastFetch<20000) || position==null) return;
        fetching=true; lastFetch=now; final int token=generation;
        final double[] from=position.clone(), to=destination.clone();
        network.execute(() -> {
            HttpURLConnection connection=null;
            try {
                // Tenta o servidor principal e, se ele recusar ou falhar, um servidor reserva compatível (OSRM).
                String[] hosts={"https://router.project-osrm.org/route/v1/driving/","https://routing.openstreetmap.de/routed-car/route/v1/driving/"};
                String query=from[1]+","+from[0]+";"+to[1]+","+to[0]+"?overview=full&geometries=geojson&steps=true&alternatives=false";
                IOException lastFailure=null;
                for (String host : hosts) {
                    HttpURLConnection attempt=null;
                    try {
                        attempt=(HttpURLConnection)new URL(host+query).openConnection();
                        attempt.setRequestProperty("User-Agent", "DaRota/1.0 (Android navigation test; contact: darotapro@gmail.com)");
                        attempt.setRequestProperty("Accept", "application/json");
                        attempt.setConnectTimeout(10000); attempt.setReadTimeout(15000);
                        int httpStatus = attempt.getResponseCode();
                        if (httpStatus == 200) { connection=attempt; break; }
                        StringBuilder details = new StringBuilder();
                        InputStream errorBody = attempt.getErrorStream();
                        if (errorBody != null) {
                            try (Reader reader = new InputStreamReader(errorBody, "UTF-8")) {
                                char[] buffer = new char[256];
                                int count;
                                while (details.length() < 2048 && (count = reader.read(buffer)) != -1) details.append(buffer, 0, Math.min(count, 2048 - details.length()));
                            } catch (IOException ignored) { }
                        }
                        String reason = details.toString().replaceAll("<[^>]*>", " ").replaceAll("\\s+", " ").trim();
                        android.util.Log.w("DaRotaRoute", "HTTP " + httpStatus + " URL=" + attempt.getURL() + " Server=" + attempt.getHeaderField("Server") + " Body=" + reason);
                        lastFailure = new IOException("HTTP " + httpStatus + " • " + (reason.isEmpty() ? "Sem explicação do servidor" : reason));
                    } catch (IOException failure) {
                        android.util.Log.w("DaRotaRoute", "Falha em " + host + ": " + failure);
                        lastFailure = failure;
                    }
                    if (attempt != null) attempt.disconnect();
                }
                if (connection == null) throw lastFailure != null ? lastFailure : new IOException("Serviço de rotas indisponível");
                StringBuilder body=new StringBuilder();
                try (BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),"UTF-8"))) {
                    String row; while ((row=reader.readLine())!=null) { body.append(row); if(body.length()>4_000_000) throw new IOException("Resposta excessiva"); }
                }
                JSONObject json=new JSONObject(body.toString());
                if (!"Ok".equals(json.optString("code"))) throw new IOException("Rota não encontrada");
                JSONObject result=json.getJSONArray("routes").getJSONObject(0);
                JSONArray coordinates=result.getJSONObject("geometry").getJSONArray("coordinates");
                if (coordinates.length()<2) throw new IOException("Rota sem geometria");
                double[][] points=new double[coordinates.length()][2]; JSONArray mapLine=new JSONArray();
                for(int i=0;i<points.length;i++) { JSONArray c=coordinates.getJSONArray(i); points[i]=new double[]{c.getDouble(1),c.getDouble(0)}; mapLine.put(new JSONArray().put(points[i][0]).put(points[i][1])); }
                RouteProgress nextRoute=new RouteProgress(points); List<Turn> nextTurns=new ArrayList<>();
                JSONArray steps=result.getJSONArray("legs").getJSONObject(0).getJSONArray("steps");
                double along=0;
                for(int i=0;i<steps.length();i++) {
                    JSONObject s=steps.getJSONObject(i), m=s.getJSONObject("maneuver");
                    Turn t=new Turn(); t.type=m.getString("type"); t.modifier=m.optString("modifier",""); t.street=s.optString("name","");
                    // OSRM step.distance describes the road AFTER its maneuver.
                    t.along=along; along+=s.optDouble("distance",0);
                    JSONArray c=m.getJSONArray("location");
                    t.key=t.type+":"+t.modifier+":"+t.street+":"+Math.round(c.getDouble(0)*100000)+":"+Math.round(c.getDouble(1)*100000);
                    if (!"depart".equals(t.type)) nextTurns.add(t);
                }
                if (nextTurns.isEmpty()) throw new IOException("Rota sem orientações");
                double minutes=result.optDouble("duration",0)/60;
                main.post(() -> {
                    if (!active || token!=generation) return;
                    fetching=false; route=nextRoute; turns.clear(); turns.addAll(nextTurns); line=mapLine; stepIndex=0; offRouteCount=0; durationMinutes=minutes;
                    route.locate(position,true);
                    while(stepIndex<turns.size()-1 && route.progress>turns.get(stepIndex).along+15) stepIndex++;
                    instruction=words(turns.get(stepIndex)); turnMeters=Math.max(0,turns.get(stepIndex).along-route.progress);
                    message="Rota pronta • GPS ativo"; announce(); publish();
                });
            } catch(Exception error) {
                main.post(() -> { if (!active || token!=generation) return; fetching=false; instruction="GPS localizado • rota indisponível"; message="Falha na rota (" + error.getClass().getSimpleName() + "): " + error.getMessage(); publish();
                    main.postDelayed(() -> { if (active && token==generation) fetchRoute(); }, 20000); });
            } finally { if(connection!=null) connection.disconnect(); }
        });
    }
    private String words(Turn t) {
        String street=t.street.isEmpty()?"a próxima via":t.street;
        if ("arrive".equals(t.type)) return "Continue até a entrega";
        if (t.modifier.contains("uturn")) return "Faça o retorno";
        if (t.type.contains("roundabout") || "rotary".equals(t.type)) return "Entre na rotatória e siga para "+street;
        if (t.modifier.contains("left")) return "Vire à esquerda na "+street;
        if (t.modifier.contains("right")) return "Vire à direita na "+street;
        return "Siga em frente pela "+street;
    }
    private void announce() {
        if (!voiceReady || route==null || offRouteCount>0 || turns.isEmpty()) return;
        int stage=RouteProgress.stage(turnMeters);
        Turn turn=turns.get(stepIndex);
        String key=destinationId+":"+(arrived?"arrived":turn.key+":"+stage);
        String turnKey=destinationId+":"+turn.key;
        if (!arrived && stage<=lastStage.getOrDefault(turnKey,-1)) return;
        if (spoken.contains(key) || voice.isSpeaking() || SystemClock.elapsedRealtime()-lastSpeech<4000) return;
        String text=instruction+(arrived?"":turnMeters<=30?", agora.":turnMeters>=1000?". Em "+String.format(new Locale("pt","BR"),"%.1f",turnMeters/1000)+" quilômetros.":". Em "+Math.max(10,Math.round(turnMeters/10)*10)+" metros.");
        if (voice.speak(text,TextToSpeech.QUEUE_ADD,null,key)==TextToSpeech.SUCCESS) { spoken.add(key); lastStage.put(turnKey,stage); lastSpeech=SystemClock.elapsedRealtime(); }
    }
    void repeat() { main.post(() -> { if (voiceReady && active && !voice.isSpeaking()) voice.speak(instruction,TextToSpeech.QUEUE_ADD,null,"manual"); }); }
    @Override public void onDestroy() {
        active=false; generation++; main.removeCallbacksAndMessages(null);
        if(locations!=null) locations.removeUpdates(this);
        if(voice!=null) { voice.stop(); voice.shutdown(); voice=null; }
        network.shutdownNow(); if(wakeLock!=null && wakeLock.isHeld()) wakeLock.release();
        running=null; publish(); stopForeground(true); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
