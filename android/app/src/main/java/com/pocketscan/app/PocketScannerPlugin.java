package com.pocketscan.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.OperationCanceledException;
import android.os.StatFs;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Size;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Metadata-only indexer. No server, file writes, all-files permission, or JS recursion. */
@CapacitorPlugin(name = "PocketScanner", permissions = {
    @Permission(alias = "legacy", strings = {Manifest.permission.READ_EXTERNAL_STORAGE}),
    @Permission(alias = "photos", strings = {Manifest.permission.READ_MEDIA_IMAGES}),
    @Permission(alias = "videos", strings = {Manifest.permission.READ_MEDIA_VIDEO}),
    @Permission(alias = "audio", strings = {Manifest.permission.READ_MEDIA_AUDIO}),
    @Permission(alias = "selected", strings = {Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED})
})
public class PocketScannerPlugin extends Plugin {
    private final ExecutorService scanner = Executors.newSingleThreadExecutor();
    private final ExecutorService thumbnails = Executors.newFixedThreadPool(3);
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile Job active;
    private static class Job {
        final String id, scope, category, tree;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile CancellationSignal signal = new CancellationSignal();
        JSArray batch = new JSArray();
        int count = 0, skipped = 0;
        boolean limited = false;
        Job(PluginCall call) {
            id = call.getString("scanId", ""); scope = call.getString("scope", "media");
            category = call.getString("category", "all"); tree = call.getString("treeUri");
        }
    }
    @PluginMethod public void startScan(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("A scan is already running."); return; }
        Job job = new Job(call); active = job;
        if (job.id.isEmpty() || !java.util.Arrays.asList("all", "photos", "videos", "audio").contains(job.category)) {
            release(job); call.reject("Invalid scan request."); return;
        }
        if (job.tree != null) {
            if (!hasTreeGrant(Uri.parse(job.tree))) { release(job); call.reject("Folder access expired. Choose the folder again."); return; }
            launch(call, job); return;
        }
        List<String> aliases = new ArrayList<>();
        if (Build.VERSION.SDK_INT < 33) aliases.add("legacy");
        else {
            for (String cat : new String[]{"photos", "videos", "audio"})
                if (job.category.equals("all") || job.category.equals(cat)) aliases.add(cat);
            if (Build.VERSION.SDK_INT >= 34 && !job.category.equals("audio")) aliases.add("selected");
        }
        boolean request = Boolean.TRUE.equals(call.getBoolean("reselect", false));
        for (String alias : aliases) {
            // A selected-images grant is sufficient for a limited scan; don't prompt on every refresh.
            if (alias.equals("selected")) continue;
            if (getPermissionState(alias) != PermissionState.GRANTED &&
                !(Build.VERSION.SDK_INT >= 34 && !alias.equals("audio") && granted("selected"))) request = true;
        }
        if (request) {
            try { requestPermissionForAliases(aliases.toArray(new String[0]), call, "mediaPermissionResult"); }
            catch (Exception e) { release(job); call.reject("Could not request media access.", e); }
        } else launch(call, job);
    }
    private boolean granted(String alias) { return getPermissionState(alias) == PermissionState.GRANTED; }
    private boolean canRead(String cat) {
        if (Build.VERSION.SDK_INT < 33) return granted("legacy");
        return granted(cat) || (!cat.equals("audio") && Build.VERSION.SDK_INT >= 34 && granted("selected"));
    }
    @PermissionCallback private void mediaPermissionResult(PluginCall call) {
        Job job = active;
        if (job == null || !job.id.equals(call.getString("scanId"))) { call.reject("Scan no longer active."); return; }
        launch(call, job);
    }
    private void launch(PluginCall call, Job job) {
        boolean any = job.tree != null;
        if (job.tree == null) for (String cat : new String[]{"photos", "videos", "audio"}) {
            if (job.category.equals("all") || job.category.equals(cat)) {
                any |= canRead(cat);
                if (Build.VERSION.SDK_INT >= 33 && !cat.equals("audio") && !granted(cat)) job.limited = true;
            }
        }
        if (!any && !job.cancelled.get()) { release(job); call.reject("Media access was denied. Allow access in Android settings or choose a folder."); return; }
        call.resolve();
        scanner.execute(() -> {
            String terminal = "complete", message = null;
            try {
                check(job);
                if (job.tree != null) scanTree(job);
                else for (String cat : new String[]{"photos", "videos", "audio"}) {
                    if ((job.category.equals("all") || job.category.equals(cat)) && canRead(cat)) scanMedia(job, cat);
                }
                check(job); flush(job);
            } catch (OperationCanceledException e) { terminal = "cancelled"; }
            catch (Exception e) { terminal = job.cancelled.get() ? "cancelled" : "error"; message = "Could not complete the scan. Check access and try again. " + e.getClass().getSimpleName(); }
            finally { release(job); }
            JSObject event = event(job, terminal);
            if (message != null) event.put("message", message);
            notifyListeners("scanProgress", event);
        });
    }
    private void release(Job job) { if (active == job) { active = null; busy.set(false); } }
    private void check(Job job) { if (job.cancelled.get() || Thread.currentThread().isInterrupted()) throw new OperationCanceledException(); }
    private JSObject event(Job job, String state) {
        JSObject out = new JSObject(); out.put("scanId", job.id); out.put("state", state); out.put("count", job.count);
        out.put("skipped", job.skipped); out.put("limited", job.limited); return out;
    }
    private void flush(Job job) {
        if (job.batch.length() == 0) return;
        JSObject event = event(job, "batch"); event.put("items", job.batch); job.batch = new JSArray();
        notifyListeners("scanProgress", event);
    }
    private void add(Job job, Uri uri, String name, String mime, long size, long modified, String folder, String category) {
        JSObject item = new JSObject(); item.put("id", uri.toString()); item.put("uri", uri.toString());
        item.put("name", name); item.put("mime", mime); item.put("size", Math.max(0, size)); item.put("modified", Math.max(0, modified));
        item.put("folder", folder); item.put("category", category); item.put("scope", job.scope);
        job.batch.put(item); job.count++; if (job.batch.length() >= 100) flush(job);
    }
    private void scanMedia(Job job, String category) {
        check(job);
        Uri uri = category.equals("photos") ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI :
            category.equals("videos") ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] projection = Build.VERSION.SDK_INT >= 29 ?
            new String[]{"_id", "_display_name", "mime_type", "_size", "date_modified", "relative_path"} :
            new String[]{"_id", "_display_name", "mime_type", "_size", "date_modified"};
        job.signal = new CancellationSignal(); check(job);
        try (Cursor cursor = getContext().getContentResolver().query(uri, projection, null, null, "date_modified DESC, _id DESC", job.signal)) {
            if (cursor == null) throw new IllegalStateException("Media provider returned no cursor");
            while (cursor.moveToNext()) {
                check(job);
                Uri file = ContentUris.withAppendedId(uri, cursor.getLong(0));
                add(job, file, string(cursor,1,"Unnamed file"), string(cursor,2,"application/octet-stream"), cursor.getLong(3),
                    cursor.getLong(4)*1000L, Build.VERSION.SDK_INT>=29?string(cursor,5,category):category, category);
            }
        }
    }
    private static String string(Cursor cursor, int index, String fallback) { return cursor.isNull(index) ? fallback : cursor.getString(index); }
    private static class Directory {
        final String id, path;
        Directory(String id, String path) { this.id = id; this.path = path; }
    }
    private void scanTree(Job job) {
        Uri tree = Uri.parse(job.tree); ContentResolver resolver = getContext().getContentResolver();
        ArrayDeque<Directory> queue = new ArrayDeque<>(); Set<String> visited = new HashSet<>();
        String root = DocumentsContract.getTreeDocumentId(tree);
        queue.add(new Directory(root, folderName(tree)));
        String[] projection = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        while (!queue.isEmpty()) {
            check(job); Directory dir = queue.removeFirst(); if (!visited.add(dir.id)) continue;
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir.id);
            job.signal = new CancellationSignal(); check(job);
            try (Cursor cursor = resolver.query(children, projection, null, null, null, job.signal)) {
                if (cursor == null) throw new IllegalStateException("Folder provider returned no cursor");
                // Cloud document providers may return incomplete listings while loading. Do not commit a destructive partial index.
                if (cursor.getExtras().getBoolean(DocumentsContract.EXTRA_LOADING, false))
                    throw new IllegalStateException("Provider still loading; retry after it has synced");
                while (cursor.moveToNext()) {
                    check(job); String id = cursor.getString(0), name = string(cursor,1,"Unnamed file"), mime = string(cursor,2,"application/octet-stream");
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) queue.addLast(new Directory(id, dir.path + "/" + name));
                    else add(job, DocumentsContract.buildDocumentUriUsingTree(tree,id), name, mime, cursor.getLong(3),cursor.getLong(4),dir.path,category(mime,name));
                }
            } catch (SecurityException | IllegalArgumentException e) {
                if (dir.id.equals(root)) throw e;
                job.skipped++;
            }
        }
        // Preserve the previous index if any subtree was unreadable; do not silently remove cached files.
        if (job.skipped > 0) throw new IllegalStateException("Some subfolders could not be read");
    }
    private String category(String mime, String name) {
        String n = name.toLowerCase(java.util.Locale.ROOT);
        if (mime.startsWith("image/") || n.matches(".*\\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$")) return "photos";
        if (mime.startsWith("video/") || n.matches(".*\\.(mp4|mkv|webm|mov|avi|m4v)$")) return "videos";
        if (mime.startsWith("audio/") || n.matches(".*\\.(mp3|m4a|aac|ogg|wav|flac|opus)$")) return "audio";
        return "other";
    }
    @PluginMethod public void cancelScan(PluginCall call) {
        Job job = active;
        if (job != null && job.id.equals(call.getString("scanId"))) { job.cancelled.set(true); job.signal.cancel(); }
        call.resolve();
    }
    @PluginMethod public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderChosen");
    }
    @ActivityCallback private void folderChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) { call.reject("Folder selection cancelled."); return; }
        Uri uri = data.getData();
        try {
            int flags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            JSObject folder = new JSObject(); folder.put("uri", uri.toString()); folder.put("name", folderName(uri)); call.resolve(folder);
        } catch (Exception e) { call.reject("Could not keep access to this folder. Choose a local folder.", e); }
    }
    private boolean hasTreeGrant(Uri tree) {
        if (!"content".equals(tree.getScheme()) || !DocumentsContract.isTreeUri(tree)) return false;
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions())
            if (permission.isReadPermission() && tree.equals(permission.getUri())) return true;
        return false;
    }
    private String folderName(Uri tree) {
        try (Cursor c = getContext().getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)),
            new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null,null,null)) {
            if (c != null && c.moveToFirst()) return string(c,0,"Selected folder");
        } catch (Exception ignored) { }
        return "Selected folder";
    }
    @PluginMethod public void listFolders(PluginCall call) {
        scanner.execute(() -> {
            JSArray folders = new JSArray();
            for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
                if (!permission.isReadPermission() || !DocumentsContract.isTreeUri(permission.getUri())) continue;
                JSObject folder = new JSObject(); folder.put("uri", permission.getUri().toString()); folder.put("name", folderName(permission.getUri())); folders.put(folder);
            }
            JSObject out = new JSObject(); out.put("folders", folders); call.resolve(out);
        });
    }
    @PluginMethod public void forgetFolder(PluginCall call) {
        String value = call.getString("uri"); if (value == null) { call.reject("Missing folder."); return; }
        try { Uri uri = Uri.parse(value); if (hasTreeGrant(uri)) getContext().getContentResolver().releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); call.resolve(); }
        catch (Exception e) { call.reject("Could not disconnect this folder.",e); }
    }
    @PluginMethod public void openFile(PluginCall call) {
        String value = call.getString("uri");
        if (value == null || !"content".equals(Uri.parse(value).getScheme())) { call.reject("Invalid file reference."); return; }
        try {
            Uri uri = Uri.parse(value);
            String mime = getContext().getContentResolver().getType(uri);
            if (mime == null) mime = call.getString("mime", "application/octet-stream");
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("File",uri));
            getActivity().startActivity(Intent.createChooser(intent,"Open with")); call.resolve();
        } catch (Exception e) { call.reject("Cannot open this file. Rescan to refresh access or install an app that supports this format.", e); }
    }
    @PluginMethod public void thumbnail(PluginCall call) {
        String value = call.getString("uri");
        if (value == null || !"content".equals(Uri.parse(value).getScheme())) { call.reject("Invalid thumbnail request."); return; }
        thumbnails.execute(() -> {
            Bitmap bitmap = null;
            try {
                Uri uri = Uri.parse(value); ContentResolver resolver = getContext().getContentResolver();
                if (Build.VERSION.SDK_INT >= 29) bitmap = resolver.loadThumbnail(uri, new Size(256,256), null);
                else {
                    String mime = resolver.getType(uri);
                    if (mime == null || !mime.startsWith("image/")) { call.reject("Thumbnail unavailable on this Android version."); return; }
                    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                    try (InputStream in = resolver.openInputStream(uri)) { BitmapFactory.decodeStream(in,null,bounds); }
                    BitmapFactory.Options opts = new BitmapFactory.Options(); opts.inSampleSize = 1;
                    while (bounds.outWidth/opts.inSampleSize>512 || bounds.outHeight/opts.inSampleSize>512) opts.inSampleSize *= 2;
                    try (InputStream in = resolver.openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(in,null,opts); }
                }
                if (bitmap == null) throw new IllegalStateException("No thumbnail");
                // Bounds are enforced even if a document provider returns a larger image.
                int max = Math.max(bitmap.getWidth(), bitmap.getHeight());
                if (max > 256) { Bitmap small=Bitmap.createScaledBitmap(bitmap,Math.max(1,bitmap.getWidth()*256/max),Math.max(1,bitmap.getHeight()*256/max),true);bitmap.recycle();bitmap=small; }
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG,75,bytes);
                JSObject out = new JSObject(); out.put("data","data:image/jpeg;base64,"+Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)); call.resolve(out);
            } catch (Exception e) { call.reject("Thumbnail unavailable.",e); }
            finally { if (bitmap != null) bitmap.recycle(); }
        });
    }
    @PluginMethod public void storageInfo(PluginCall call) {
        StatFs stats = new StatFs(Environment.getDataDirectory().getAbsolutePath());
        JSObject out = new JSObject(); out.put("total",stats.getTotalBytes()); out.put("available",stats.getAvailableBytes()); call.resolve(out);
    }
    @PluginMethod public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:"+getContext().getPackageName()));
        getActivity().startActivity(intent); call.resolve();
    }
    @Override protected void handleOnDestroy() {
        Job job = active; if (job != null) { job.cancelled.set(true); job.signal.cancel(); }
        scanner.shutdownNow(); thumbnails.shutdownNow(); super.handleOnDestroy();
    }
}
