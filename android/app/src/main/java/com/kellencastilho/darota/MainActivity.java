package com.kellencastilho.darota;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NavigationPlugin.class);
        registerPlugin(GooglePurchasesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
