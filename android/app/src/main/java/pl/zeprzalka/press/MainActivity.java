package pl.zeprzalka.press;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * PRESS main activity: registers the in-app PressSystem plugin (sticky immersive mode,
 * gesture exclusion, text scale) and survives WebView renderer crashes by recreating
 * the activity, so the game boots back into "Resume run" instead of the process dying.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PressSystemPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        // The game handles text scaling itself (GDD §17): keep CSS px = dp.
        webView.getSettings().setTextZoom(100);

        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    runOnUiThread(MainActivity.this::recreate);
                    return true;
                }
            }
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Bars come back after dialogs/ads; re-apply sticky immersive mode when focused again.
        if (hasFocus) PressSystemPlugin.reapply(this);
    }
}
