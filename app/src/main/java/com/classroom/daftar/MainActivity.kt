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
    private val exportFileRequest = 2002
    private var pendingExportFilename: String? = null
    private var pendingExportMimeType: String? = null
    private var pendingExportBytes: ByteArray? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermission: PermissionRequest? = null
    private val speechHandler = Handler(Looper.getMainLooper())
    private var speechCountdownRunnable: Runnable? = null

    private var mediaRecorder: MediaRecorder? = null
    private var recordingType: String? = null
    private var recordingFile: File? = null

    /** یک روش تشخیص گفتار: زبان + اینکه روی خود گوشی (آفلاین) باشد یا سرویس آنلاین گوگل. */
    private data class SpeechAttempt(val lang: String, val onDevice: Boolean)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestAudioPermissionIfNeeded()
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
        webView.settings.safeBrowsingEnabled = true
        webView.settings.setSupportMultipleWindows(false)

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
        webView.addJavascriptInterface(AndroidFileBridge(), "AndroidFileBridge")
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

    /** پل امن ذخیره فایل‌های خروجی HTML در پوشه‌ای که کاربر انتخاب می‌کند. */
    inner class AndroidFileBridge {
        @android.webkit.JavascriptInterface
        fun saveFile(filename: String, mimeType: String, base64Data: String) {
            runOnUiThread {
                try {
                    pendingExportFilename = filename.substringAfterLast('/').substringAfterLast('\\')
                    pendingExportMimeType = mimeType.substringBefore(';').ifBlank { "application/octet-stream" }
                    pendingExportBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)

                    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = pendingExportMimeType ?: "application/octet-stream"
                        putExtra(Intent.EXTRA_TITLE, pendingExportFilename ?: "export")
                    }
                    startActivityForResult(intent, exportFileRequest)
                } catch (e: Exception) {
                    clearPendingExport()
                    notifyNativeFileSaved(false, "باز کردن پنجره ذخیره فایل ممکن نشد.")
                }
            }
        }
    }

    private fun clearPendingExport() {
        pendingExportFilename = null
        pendingExportMimeType = null
        pendingExportBytes = null
    }

    private fun notifyNativeFileSaved(success: Boolean, message: String) {
        val js = "window.onNativeFileSaved && window.onNativeFileSaved($success, ${org.json.JSONObject.quote(message)});"
        runOnUiThread { if (::webView.isInitialized) webView.evaluateJavascript(js, null) }
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
            sendStatus(
                textareaId,
                "❌ سرویس تشخیص گفتار روی این گوشی در دسترس نیست. برنامه Google را نصب/به‌روز کنید و در تنظیمات، «Speech Services by Google» را پیش‌فرض بگذارید."
            )
            return
        }

        speechCountdownRunnable?.let { speechHandler.removeCallbacks(it) }
        speechRecognizer?.destroy()
        speechRecognizer = null
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

    /**
     * ترتیب تلاش‌ها:
     *  ۱) سرویس آنلاین گوگل با fa-IR
     *  ۲) سرویس آنلاین گوگل با fa  (بعضی گوشی‌ها فقط همین را می‌پذیرند)
     *  ۳) تشخیص روی خود گوشی (آفلاین) در صورت وجود، مثلاً وقتی اینترنت نیست
     */
    private fun buildSpeechAttempts(): List<SpeechAttempt> {
        val list = mutableListOf(
            SpeechAttempt("fa-IR", false),
            SpeechAttempt("fa", false)
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            android.speech.SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            list.add(SpeechAttempt("fa-IR", true))
        }
        return list
    }

    private fun startPersianSpeechRecognition(
        textareaId: String,
        attempts: List<SpeechAttempt> = buildSpeechAttempts(),
        index: Int = 0
    ) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            sendStatus(textareaId, "❌ اجازه میکروفون داده نشده است.")
            return
        }
        val attempt = attempts[index]

        speechRecognizer?.destroy()
        speechRecognizer = null

        val recognizer = try {
            if (attempt.onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.speech.SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            } else {
                android.speech.SpeechRecognizer.createSpeechRecognizer(this)
            }
        } catch (e: Exception) {
            if (index + 1 < attempts.size) {
                speechHandler.post { startPersianSpeechRecognition(textareaId, attempts, index + 1) }
            } else {
                sendStatus(textareaId, "❌ شروع تشخیص گفتار ممکن نشد.")
            }
            return
        }
        speechRecognizer = recognizer

        recognizer.setRecognitionListener(object : android.speech.RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { sendStatus(textareaId, "🎙️ در حال شنیدن گفتار فارسی... صحبت کنید") }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { sendStatus(textareaId, "⏳ در حال تبدیل گفتار به متن...") }

            override fun onError(error: Int) {
                // کالبک‌های دیرهنگام یک تشخیص‌دهندهٔ قدیمی را نادیده بگیر
                if (speechRecognizer !== recognizer) return

                val languageProblem = (error == 12 || error == 13)   // زبان پشتیبانی نمی‌شود / در دسترس نیست
                val networkProblem = (error == 1 || error == 2 || error == 4 || error == 11)

                // روش بعدی: برای مشکل زبان، روش بعدی؛ برای مشکل شبکه، مستقیم تشخیص آفلاین
                val nextIndex = when {
                    languageProblem && index + 1 < attempts.size -> index + 1
                    networkProblem -> attempts.indexOfFirst { it.onDevice }.takeIf { it > index } ?: -1
                    else -> -1
                }
                if (nextIndex != -1) {
                    sendStatus(textareaId, "🎙️ تلاش با روش دیگر تشخیص گفتار...")
                    speechHandler.post { startPersianSpeechRecognition(textareaId, attempts, nextIndex) }
                    return
                }

                val msg = when (error) {
                    1, 2, 4, 11 -> "❌ برای تبدیل گفتار به متن به اینترنت نیاز است. اتصال را بررسی کنید."
                    3 -> "❌ خطای میکروفون."
                    5 -> return   // لغو داخلی؛ پیام نشان نده
                    6, 7 -> "❌ صدایی شنیده نشد. دوباره و واضح‌تر بگویید."
                    8 -> "❌ سرویس مشغول است. چند ثانیه بعد تلاش کنید."
                    9 -> "❌ اجازه میکروفون داده نشده است."
                    10 -> "❌ درخواست‌ها زیاد بود. چند ثانیه صبر کنید."
                    12, 13 -> "❌ تشخیص گفتار فارسی روی این گوشی در دسترس نیست. برنامه Google را به‌روز کنید و در تنظیمات تایپ صوتی گوگل، فارسی را اضافه کنید."
                    else -> "❌ تشخیص گفتار انجام نشد (کد $error)."
                }
                sendStatus(textareaId, msg)
            }

            override fun onResults(results: Bundle?) {
                if (speechRecognizer !== recognizer) return
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
            putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, attempt.lang)
            putExtra(android.speech.RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            // آفلاین فقط در آخرین روش اجباری می‌شود، نه همیشه
            if (attempt.onDevice) putExtra(android.speech.RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
        try {
            recognizer.startListening(intent)
        } catch (e: Exception) {
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

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == fileRequest) {
            val result = if (resultCode == RESULT_OK && data != null)
                WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null
            fileCallback?.onReceiveValue(result)
            fileCallback = null
        } else if (requestCode == exportFileRequest) {
            var success = false
            var message = "ذخیره فایل لغو شد."
            val uri = if (resultCode == RESULT_OK) data?.data else null
            val bytes = pendingExportBytes
            if (uri != null && bytes != null) {
                try {
                    val output = contentResolver.openOutputStream(uri)
                        ?: throw IllegalStateException("Output stream unavailable")
                    output.use { it.write(bytes) }
                    success = true
                    message = "فایل با موفقیت ذخیره شد."
                } catch (e: Exception) {
                    message = "ذخیره فایل انجام نشد؛ لطفاً دوباره تلاش کنید."
                }
            }
            clearPendingExport()
            notifyNativeFileSaved(success, message)
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
        webView.destroy()
        super.onDestroy()
    }
}
