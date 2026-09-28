package com.classnotebook.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_AUDIO = 4101;
    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private String pendingTextareaId = "";
    private PermissionRequest pendingWebPermission;
    private final Handler handler = new Handler();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        setupWebView();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
        }
    }

    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsAudio = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsAudio = true;
                    }
                    if (!wantsAudio) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingWebPermission = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
                    }
                });
            }
        });
        webView.addJavascriptInterface(new AndroidSpeechBridge(), "AndroidSpeech");
        webView.loadUrl("file:///android_asset/index.html");
    }

    public class AndroidSpeechBridge {
        @JavascriptInterface public void startPersianSpeech(final String textareaId) {
            runOnUiThread(() -> startRecognition(textareaId));
        }
        @JavascriptInterface public void stopPersianSpeech() {
            runOnUiThread(() -> { if (speechRecognizer != null) speechRecognizer.stopListening(); });
        }
    }

    private void startRecognition(String textareaId) {
        pendingTextareaId = textareaId == null ? "" : textareaId;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            notifyStatus("مجوز میکروفن لازم است");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            notifyStatus("سرویس تشخیص گفتار روی این گوشی در دسترس نیست");
            return;
        }
        if (speechRecognizer != null) speechRecognizer.destroy();
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { notifyStatus("گوش کنید… صحبت کنید"); }
            @Override public void onBeginningOfSpeech() { notifyStatus("در حال شنیدن…"); }
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() { notifyStatus("در حال تبدیل صدا به متن…"); }
            @Override public void onError(int error) {
                String msg;
                switch(error) {
                    case SpeechRecognizer.ERROR_AUDIO: msg="خطا در دریافت صدا"; break;
                    case SpeechRecognizer.ERROR_CLIENT: msg="خطای داخلی تشخیص گفتار"; break;
                    case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: msg="مجوز میکروفن داده نشده است"; break;
                    case SpeechRecognizer.ERROR_NETWORK: msg="خطای شبکه؛ دوباره تلاش کنید"; break;
                    case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: msg="زمان شبکه تمام شد"; break;
                    case SpeechRecognizer.ERROR_NO_MATCH: msg="گفتاری تشخیص داده نشد؛ دوباره واضح صحبت کنید"; break;
                    case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: msg="تشخیص گفتار مشغول است؛ یک لحظه بعد دوباره بزنید"; break;
                    case SpeechRecognizer.ERROR_SERVER: msg="سرویس تشخیص گفتار پاسخ نداد"; break;
                    case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: msg="صحبتی دریافت نشد"; break;
                    default: msg="خطای تشخیص گفتار (" + error + ")";
                }
                notifyStatus(msg);
            }
            @Override public void onResults(Bundle results) {
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) sendResult(matches.get(0));
                notifyStatus("متن آماده شد؛ قبل از ذخیره می‌توانید ویرایش کنید");
            }
            @Override public void onPartialResults(Bundle partialResults) {
                ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) sendResult(matches.get(0));
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        });
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fa-IR");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "fa-IR");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        speechRecognizer.startListening(intent);
    }

    private void sendResult(String text) {
        String js = "window.setNativePersianSpeechResult(" + orgJson(text) + "," + orgJson(pendingTextareaId) + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
    private String orgJson(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029") + "\"";
    }
    private void notifyStatus(String msg) {
        webView.post(() -> webView.evaluateJavascript("window.nativeSpeechStatus && window.nativeSpeechStatus(" + orgJson(msg) + ")", null));
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AUDIO) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (ok && pendingWebPermission != null) {
                pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                pendingWebPermission = null;
            }
            if (!ok) notifyStatus("برای ضبط و تبدیل صدا، مجوز میکروفن را فعال کنید");
        }
    }

    @Override protected void onDestroy() {
        if (speechRecognizer != null) { speechRecognizer.destroy(); speechRecognizer = null; }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
