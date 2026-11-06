package com.windock.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

/** Standalone synthetic sharing app: framework-only code, excluded from the app APK. */
public final class FilesFixtureProvider extends ContentProvider {
    public boolean onCreate() { return true; }
    public String getType(Uri uri) { return uri.getLastPathSegment().contains("photo") ? "image/jpeg" : "application/pdf"; }
    public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort) {
        MatrixCursor cursor=new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE});
        cursor.addRow(new Object[]{"مرحبا "+uri.getLastPathSegment()+".bin",uri.getLastPathSegment().contains("unknown")?null:65536L});return cursor;
    }
    public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
        if(!"r".equals(mode))throw new FileNotFoundException();
        File file=new File(getContext().getCacheDir(),"synthetic-share.bin");
        if(!file.exists())try(FileOutputStream output=new FileOutputStream(file)) { byte[] bytes=new byte[65536];for(int i=0;i<bytes.length;i++)bytes[i]=(byte)(i%251);output.write(bytes); }
        catch(IOException error){throw new FileNotFoundException("Fixture unavailable");}
        return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);
    }
    public Uri insert(Uri uri,ContentValues values){return null;}
    public int delete(Uri uri,String selection,String[] args){return 0;}
    public int update(Uri uri,ContentValues values,String selection,String[] args){return 0;}
}
