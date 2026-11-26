package io.github.pvepanel.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeKeystorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
