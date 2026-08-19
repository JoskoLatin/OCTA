package com.vodice.octa;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** The app's background — keep in sync with --bg in style.css. */
    private static final int BG = 0xFF16181C;

    /**
     * Keep the web UI clear of the status and navigation bars.
     *
     * Android 15 (API 35) forces edge-to-edge for apps targeting it, so the
     * WebView is laid out behind the system bars and the header slides under
     * the clock. CSS cannot fix this on its own: this WebView reports
     * env(safe-area-inset-top) as 0 even while drawing edge-to-edge.
     *
     * Padding the content view by the system-bar insets works on every
     * version. The padded strip shows the view's own background, so it is
     * painted the app's background colour rather than the theme's default.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(BG);

        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        // Dark bars, so the clock and icons stay light against them.
        WindowInsetsControllerCompat bars =
            new WindowInsetsControllerCompat(getWindow(), content);
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(
                systemBars.left, systemBars.top, systemBars.right, systemBars.bottom
            );
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
