package pl.zeprzalka.press;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.Build;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Small in-app plugin for things Capacitor's core plugins don't cover:
 *  - sticky immersive full screen (bars reappear transiently on swipe),
 *  - system gesture exclusion rects for the piece tray (edge back-gesture conflicts),
 *  - the system font scale (passed to CSS as --fs because WebView textZoom is fixed to 100).
 */
@CapacitorPlugin(name = "PressSystem")
public class PressSystemPlugin extends Plugin {

    private static volatile boolean immersive = true;

    static void reapply(Activity activity) {
        apply(activity, immersive);
    }

    private static void apply(Activity activity, boolean on) {
        Window window = activity.getWindow();
        if (window == null) return;
        WindowCompat.setDecorFitsSystemWindows(window, false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (on) {
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        immersive = call.getBoolean("on", true);
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            apply(activity, immersive);
            call.resolve();
        });
    }

    @PluginMethod
    public void setGestureExclusion(PluginCall call) {
        JSArray rects = call.getArray("rects", new JSArray());
        Activity activity = getActivity();
        float density = activity.getResources().getDisplayMetrics().density;
        List<Rect> list = new ArrayList<>();
        try {
            for (int i = 0; i < rects.length(); i++) {
                JSONObject r = rects.getJSONObject(i);
                int x = Math.round((float) r.getDouble("x") * density);
                int y = Math.round((float) r.getDouble("y") * density);
                int w = Math.round((float) r.getDouble("w") * density);
                int h = Math.round((float) r.getDouble("h") * density);
                list.add(new Rect(x, y, x + w, y + h));
            }
        } catch (Exception e) {
            call.reject("Bad rects", e);
            return;
        }
        activity.runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                View decor = activity.getWindow().getDecorView();
                decor.setSystemGestureExclusionRects(list);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getTextScale(PluginCall call) {
        Configuration config = getActivity().getResources().getConfiguration();
        JSObject ret = new JSObject();
        ret.put("scale", config.fontScale);
        call.resolve(ret);
    }
}
