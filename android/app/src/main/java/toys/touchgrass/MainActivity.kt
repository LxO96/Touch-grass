package toys.touchgrass

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.JavascriptInterface
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader

/**
 * A shell around the Touch Grass web app.
 *
 * The pages are served through [WebViewAssetLoader] on
 * https://appassets.androidplatform.net rather than loaded from
 * file:///android_asset/. That matters: a file:// page is an opaque,
 * insecure origin, so the WebView refuses it geolocation and treats its
 * localStorage as throwaway. This app is built out of exactly those two
 * things, so it needs a real secure origin.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    /** Set while an in-page geolocation request waits on the OS permission dialog. */
    private var pendingOrigin: String? = null
    private var pendingCallback: GeolocationPermissions.Callback? = null

    private val askForLocation = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val granted = results.values.any { it }
        // Answer the page either way — leaving the callback hanging would
        // freeze its "Locating…" state forever.
        pendingCallback?.invoke(pendingOrigin, granted, false)
        pendingCallback = null
        pendingOrigin = null
    }

    private val askForNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* granted or not, the rest of the app is unaffected */
        Scheduler.sync(this)
    }

    /**
     * The page's window into the app.
     *
     * Everything here is called from the WebView's JS thread, and only our
     * own bundled pages can reach it — the asset loader is the only origin
     * this WebView will load.
     */
    private inner class Bridge {

        @JavascriptInterface
        fun syncState(json: String) {
            // localStorage is invisible to the background worker, so the
            // page hands over the parts it needs.
            try {
                Prefs.store(this@MainActivity, json)
                Scheduler.sync(this@MainActivity)
                // Language and units live in here too, and the widget shows
                // both — so it has to be redrawn when they change.
                Widget.refreshAll(this@MainActivity)
            } catch (e: Exception) {
                // Malformed state must never take the app down — but a
                // silent catch hides real bugs, so say what happened.
                Log.e(TAG, "syncState failed", e)
            }
        }

        /**
         * Trips logged from the widget while the page wasn't running.
         * Returns them once and forgets them, so the page can fold them
         * into localStorage — which stays the only source of truth.
         */
        @JavascriptInterface
        fun takePendingVisits(): Int {
            return try {
                val n = Prefs.pendingVisits(this@MainActivity)
                if (n > 0) Prefs.clearPendingVisits(this@MainActivity)
                n
            } catch (_: Exception) {
                0
            }
        }

        @JavascriptInterface
        fun shareBackup(text: String, filename: String) {
            runOnUiThread { shareText(text, filename) }
        }

        @JavascriptInterface
        fun syncWidget(json: String) {
            // The page computed this with the same tgDecide the widget
            // would use, so trust it and redraw straight away.
            try {
                Prefs.saveWidget(this@MainActivity, json)
                Widget.refreshAll(this@MainActivity)
            } catch (e: Exception) {
                Log.e(TAG, "syncWidget failed", e)
            }
        }

        @JavascriptInterface
        fun testNudge() {
            runOnUiThread {
                ensureNotificationAccess(false)
                Scheduler.testNow(this@MainActivity)
            }
        }

        @JavascriptInterface
        fun requestNotificationSetup(wantsAlarm: Boolean) {
            runOnUiThread { ensureNotificationAccess(wantsAlarm) }
        }
    }

    private fun ensureNotificationAccess(wantsAlarm: Boolean) {
        Notifier.ensureChannels(this)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            askForNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }

        // An "alarm" here is a high-importance channel, not an exact alarm,
        // so there is no extra runtime permission to chase. If the user has
        // muted the channel, send them to where they can unmute it.
        if (wantsAlarm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            val ch = mgr.getNotificationChannel(Notifier.CHANNEL_ALARM)
            if (ch != null && ch.importance == NotificationManager.IMPORTANCE_NONE) {
                startActivity(
                    Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        .putExtra(Settings.EXTRA_CHANNEL_ID, Notifier.CHANNEL_ALARM)
                )
            }
        }

        Scheduler.sync(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.sun))
        }
        setContentView(web)

        // Edge-to-edge is mandatory from API 35, so inset the page by hand.
        // The window background is the same mustard as the page, so the
        // status bar strip blends into the header instead of cutting it off.
        ViewCompat.setOnApplyWindowInsetsListener(web) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        configure(web.settings)
        web.addJavascriptInterface(Bridge(), "TouchGrassAndroid")
        wireClients()
        wireBackButton()

        // Belt and braces: anything cached by a previous version goes.
        if (Prefs.consumeVersionChange(this, appVersionCode())) {
            web.clearCache(true)
        }

        Notifier.ensureChannels(this)
        Scheduler.sync(this)

        if (savedInstanceState == null) {
            web.loadUrl("$BASE_URL/assets/index.html")
        }
    }

    override fun onResume() {
        super.onResume()
        AppState.inForeground = true
        Prefs.markOpened(this, System.currentTimeMillis())
        Notifier.clearAll(this)
        Scheduler.sync(this)
    }

    override fun onPause() {
        AppState.inForeground = false
        super.onPause()
    }

    private fun configure(settings: WebSettings) {
        settings.javaScriptEnabled = true
        // localStorage is the entire data model: the year log and the dials.
        settings.domStorageEnabled = true
        settings.setGeolocationEnabled(true)
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        // Assets arrive over the asset loader, so the WebView never needs
        // to touch the filesystem itself.
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mediaPlaybackRequiresUserGesture = true
    }

    private fun wireClients() {
        val loader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val res = loader.shouldInterceptRequest(request.url) ?: return null
                // The bundled pages change with every app update. Left to
                // its own devices the WebView will happily keep serving the
                // previous version's HTML and JS out of its HTTP cache, so
                // an updated app shows the old UI. Say no.
                val headers = HashMap(res.responseHeaders ?: emptyMap())
                headers["Cache-Control"] = "no-store"
                res.responseHeaders = headers
                return res
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                // Our own pages stay in the WebView; anything else (the
                // Open-Meteo credit link, say) belongs in a real browser.
                if (request.url.host == ASSET_HOST) return false
                openExternally(request.url)
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                // Only ever our own bundled pages can get here.
                if (!origin.startsWith("https://$ASSET_HOST")) {
                    callback.invoke(origin, false, false)
                    return
                }
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false)
                } else {
                    pendingOrigin = origin
                    pendingCallback = callback
                    askForLocation.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
            }

            override fun onGeolocationPermissionsHidePrompt() {
                pendingCallback = null
                pendingOrigin = null
            }
        }
    }

    private fun wireBackButton() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Settings -> Today should feel like going back, not like quitting.
                if (web.canGoBack()) {
                    web.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    /**
     * Writes the backup to a private cache file and offers it to the share
     * sheet — which already reaches Drive, email and Files, so there is no
     * need for a bespoke cloud integration.
     */
    private fun shareText(text: String, filename: String) {
        try {
            val dir = java.io.File(cacheDir, "backups").apply { mkdirs() }
            // One file, overwritten each time: no pile of stale backups.
            val f = java.io.File(dir, safeName(filename))
            f.writeText(text)

            val uri = androidx.core.content.FileProvider.getUriForFile(
                this, "$packageName.files", f
            )

            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "Touch Grass — ${f.name}")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(send, null))
        } catch (_: Exception) {
            // Nothing to share to, or no room to write. The page keeps the
            // copy button, so this is not worth crashing over.
        }
    }

    /** Keeps a filename from wandering out of the cache directory. */
    private fun safeName(name: String): String {
        val cleaned = name.substringAfterLast('/').substringAfterLast('\\')
            .filter { it.isLetterOrDigit() || it == '-' || it == '_' || it == '.' }
        return if (cleaned.isBlank()) "touch-grass.json" else cleaned
    }

    private fun appVersionCode(): Long = try {
        val info = packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
        else @Suppress("DEPRECATION") info.versionCode.toLong()
    } catch (_: Exception) {
        0L
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            // No browser installed. Nothing useful to do, and crashing
            // over a tapped link would be worse.
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        web.restoreState(savedInstanceState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "TouchGrass"
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val BASE_URL = "https://$ASSET_HOST"
    }
}
