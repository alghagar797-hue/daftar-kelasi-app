package com.classroom.daftar

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.ValueCallback
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var speechRecognizer: android.speech.SpeechRecognizer? = null
    private var pendingTextareaId: String? = null
    private var pendingSpeechAfterPermission = false
    private val audioPermission = 1001
    private val fileRequest = 2001
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermission: PermissionRequest? = null
    private val speechHandler = Handler(Looper.getMainLooper())
    private var speechCountdownRunnable: Runnable? = null

    private var mediaRecorder: MediaRecorder? = null
    private var recordingType: String? = null
    private var recordingFile: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setupWebView()
    }

    private fun requestAudioPermissionIfNeeded() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), audioPermission)
        }
    }

    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(false)
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = true
        webView.settings.allowFileAccessFromFileURLs = false
        webView.settings.allowUniversalAccessFromFileURLs = false
        webView.settings.databaseEnabled = true
        webView.settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        webView.settings.loadsImagesAutomatically = true
        webView.settings.blockNetworkImage = false
        webView.settings.safeBrowsingEnabled = true
        webView.settings.setSupportMultipleWindows(false)
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)

        val voiceDir = File(filesDir, "voice").apply { mkdirs() }
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/voice/", WebViewAssetLoader.InternalStoragePathHandler(this, voiceDir))
            .build()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                return url.scheme != "https" || url.host != "appassets.androidplatform.net"
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)
            override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(Uri.parse(url))

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                // WebView renderer may be killed by Android on memory pressure. Recreate the
                // renderer instead of allowing the whole Activity to appear broken.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    runOnUiThread {
                        try {
                            view.stopLoading()
                            view.destroy()
                        } catch (_: Exception) {}
                        if (!isFinishing && !isDestroyedCompat()) setupWebView()
                    }
                    return true
                }
                return false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val origin = request.origin.toString()
                    if (origin != "https://appassets.androidplatform.net/") {
                        request.deny()
                        return@runOnUiThread
                    }
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingWebPermission = request
                        requestAudioPermissionIfNeeded()
                    }
                }
            }

            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val types = params?.acceptTypes?.filter { it.isNotBlank() } ?: emptyList()
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (types.size == 1) types[0] else "*/*"
                    if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                return try {
                    startActivityForResult(Intent.createChooser(intent, "انتخاب فایل صوتی"), fileRequest)
                    true
                } catch (e: Exception) {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = null
                    false
                }
            }
        }

        webView.addJavascriptInterface(AndroidSpeechBridge(), "AndroidSpeech")
        webView.addJavascriptInterface(AndroidAudioBridge(), "AndroidAudio")
        setContentView(webView)
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    inner class AndroidAudioBridge {
        @android.webkit.JavascriptInterface
        fun startRecording(type: String) {
            runOnUiThread { startNativeRecording(type) }
        }

        @android.webkit.JavascriptInterface
        fun stopRecording() {
            runOnUiThread { stopNativeRecording() }
        }
    }

    private fun startNativeRecording(type: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestAudioPermissionIfNeeded()
            sendVoiceStatus(type, "❌ اجازه میکروفون داده نشده است.")
            return
        }
        if (mediaRecorder != null) {
            stopNativeRecording()
        }

        val dir = File(filesDir, "voice").apply { mkdirs() }
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        val file = File(dir, "voice_${stamp}.m4a")

        try {
            val recorder = MediaRecorder()
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioSamplingRate(44100)
            recorder.setAudioEncodingBitRate(128000)
            recorder.setOutputFile(file.absolutePath)
            recorder.prepare()
            recorder.start()
            mediaRecorder = recorder
            recordingType = type
            recordingFile = file
            sendVoiceStatus(type, "🔴 در حال ضبط... دوباره دکمه ضبط را بزنید تا ذخیره شود.")
        } catch (e: Exception) {
            try { mediaRecorder?.release() } catch (_: Exception) {}
            mediaRecorder = null
            recordingType = null
            recordingFile = null
            file.delete()
            sendVoiceStatus(type, "❌ شروع ضبط صوت ممکن نشد.")
        }
    }

    private fun stopNativeRecording() {
        val recorder = mediaRecorder ?: return
        val type = recordingType ?: ""
        val file = recordingFile
        mediaRecorder = null
        recordingType = null
        recordingFile = null

        try {
            recorder.stop()
        } catch (_: Exception) {
            file?.delete()
            try { recorder.reset() } catch (_: Exception) {}
            try { recorder.release() } catch (_: Exception) {}
            sendVoiceStatus(type, "❌ مدت ضبط خیلی کوتاه بود. دوباره امتحان کنید.")
            return
        }
        try { recorder.release() } catch (_: Exception) {}

        if (file == null || !file.exists() || file.length() < 100) {
            sendVoiceStatus(type, "❌ فایل صوتی ایجاد نشد.")
            return
        }

        val safeName = Uri.encode(file.name)
        val url = "https://appassets.androidplatform.net/voice/$safeName"
        val js = "window.setNativeVoiceResult(${org.json.JSONObject.quote(url)},${org.json.JSONObject.quote(type)});"
        webView.evaluateJavascript(js, null)
    }

    private fun sendVoiceStatus(type: String, message: String) {
        val js = """
            (function(){
                var s=document.getElementById(${org.json.JSONObject.quote(type + "VoiceStatus")});
                if(s){s.textContent=${org.json.JSONObject.quote(message)};s.classList.remove("success");}
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    inner class AndroidSpeechBridge {
        @android.webkit.JavascriptInterface
        fun startPersianSpeech(textareaId: String) {
            runOnUiThread { startPersianSpeechInternal(textareaId) }
        }
    }

    private fun startPersianSpeechInternal(textareaId: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingTextareaId = textareaId
            pendingSpeechAfterPermission = true
            requestAudioPermissionIfNeeded()
            sendStatus(textareaId, "🎙️ در انتظار اجازه میکروفون...")
            return
        }
        if (!android.speech.SpeechRecognizer.isRecognitionAvailable(this)) {
            sendStatus(textareaId, "❌ سرویس تشخیص گفتار اندروید روی این گوشی در دسترس نیست.")
            return
        }

        speechCountdownRunnable?.let { speechHandler.removeCallbacks(it) }
        speechRecognizer?.destroy()
        pendingTextareaId = textareaId

        var remaining = 3
        sendStatus(textareaId, "🎙️ آماده‌سازی میکروفون... $remaining")
        val countdown = object : Runnable {
            override fun run() {
                remaining--
                if (remaining > 0) {
                    sendStatus(textareaId, "🎙️ آماده باشید... $remaining")
                    speechHandler.postDelayed(this, 1000L)
                } else {
                    sendStatus(textareaId, "🎙️ شروع شد؛ صحبت کنید")
                    startPersianSpeechRecognition(textareaId)
                }
            }
        }
        speechCountdownRunnable = countdown
        speechHandler.postDelayed(countdown, 1000L)
    }

    private fun startPersianSpeechRecognition(textareaId: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            sendStatus(textareaId, "❌ اجازه میکروفون داده نشده است.")
            return
        }
        // از موتور استاندارد اندروید استفاده می‌کنیم تا اگر تشخیص آفلاین
        // فارسی روی گوشی نصب نبود، موتور آنلاین سرویس گفتار بتواند کار کند.
        val recognizer = android.speech.SpeechRecognizer.createSpeechRecognizer(this)
        speechRecognizer = recognizer
        recognizer.setRecognitionListener(object : android.speech.RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { sendStatus(textareaId, "🎙️ در حال شنیدن گفتار فارسی... صحبت کنید") }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { sendStatus(textareaId, "⏳ در حال تبدیل گفتار به متن...") }
            override fun onError(error: Int) {
                val msg = when (error) {
                    1, 2 -> "❌ تشخیص آفلاین در این گوشی در دسترس نیست یا موتور گفتار پاسخ نداد."
                    3 -> "❌ خطای میکروفون."
                    6, 7 -> "❌ صدایی شنیده نشد. دوباره و واضح‌تر بگویید."
                    8 -> "❌ سرویس مشغول است. چند ثانیه بعد تلاش کنید."
                    9 -> "❌ اجازه میکروفون داده نشده است."
                    12, 13 -> "❌ زبان فارسی روی این گوشی فعال نیست. زبان فارسی گفتار را در تنظیمات گوشی فعال کنید."
                    else -> "❌ تشخیص گفتار انجام نشد (کد $error)."
                }
                sendStatus(textareaId, msg)
            }
            override fun onResults(results: Bundle?) {
                val texts = results?.getStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION)
                val text = texts?.firstOrNull().orEmpty()
                if (text.isBlank()) { sendStatus(textareaId, "❌ صدایی شنیده نشد. دوباره تلاش کنید."); return }
                val escaped = org.json.JSONObject.quote(text)
                val id = org.json.JSONObject.quote(textareaId)
                webView.evaluateJavascript("window.setNativePersianSpeechResult($escaped,$id);", null)
            }
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "fa-IR")
            putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "fa-IR")
            putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(android.speech.RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
        }
        try { recognizer.startListening(intent) } catch (e: Exception) {
            sendStatus(textareaId, "❌ شروع تشخیص گفتار ممکن نشد.")
        }
    }

    private fun sendStatus(textareaId: String, message: String) {
        val statusId = textareaId + "VoiceStatus"
        val js = """(function(){
            var s=document.getElementById(${org.json.JSONObject.quote(statusId)});
            if(s){s.textContent=${org.json.JSONObject.quote(message)};s.classList.remove("listening");}
        })();"""
        webView.evaluateJavascript(js, null)
    }

    private fun isDestroyedCompat(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (::webView.isInitialized && (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW || level >= android.content.ComponentCallbacks2.TRIM_MEMORY_BACKGROUND)) {
            try { webView.clearHistory() } catch (_: Exception) {}
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == fileRequest) {
            val result = if (resultCode == RESULT_OK && data != null)
                WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null
            fileCallback?.onReceiveValue(result)
            fileCallback = null
        } else {
            @Suppress("DEPRECATION")
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == audioPermission) {
            val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingWebPermission?.let { if (ok) it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else it.deny() }
            pendingWebPermission = null
            if (ok && pendingSpeechAfterPermission) {
                val textareaId = pendingTextareaId
                pendingSpeechAfterPermission = false
                if (textareaId != null) startPersianSpeechInternal(textareaId)
            } else if (!ok && pendingSpeechAfterPermission) {
                pendingSpeechAfterPermission = false
                pendingTextareaId?.let { sendStatus(it, "❌ اجازه میکروفون داده نشد.") }
            }
        }
    }

    override fun onDestroy() {
        pendingSpeechAfterPermission = false
        speechCountdownRunnable?.let { speechHandler.removeCallbacks(it) }
        speechCountdownRunnable = null
        try { mediaRecorder?.stop() } catch (_: Exception) {}
        try { mediaRecorder?.release() } catch (_: Exception) {}
        mediaRecorder = null
        speechRecognizer?.destroy()
        speechRecognizer = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        pendingWebPermission?.deny()
        pendingWebPermission = null
        webView.destroy()
        super.onDestroy()
    }
}
