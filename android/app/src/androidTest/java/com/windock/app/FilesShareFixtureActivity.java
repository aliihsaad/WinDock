package com.windock.app;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.Arrays;

public final class FilesShareFixtureActivity extends Activity {
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String mode=getIntent().getStringExtra("mode");
        boolean multiple="multiple".equals(mode);
        Uri first=Uri.parse("content://com.windock.app.test.files/"+(multiple?"unknown":"photo")+"-"+System.nanoTime());
        Uri second=Uri.parse("content://com.windock.app.test.files/document-"+System.nanoTime());
        Intent share=new Intent(multiple?Intent.ACTION_SEND_MULTIPLE:Intent.ACTION_SEND);
        share.setClassName("com.windock.app","com.windock.app.MainActivity");share.setType("*/*");
        if(multiple)share.putParcelableArrayListExtra(Intent.EXTRA_STREAM,new ArrayList<>(Arrays.asList(first,second)));else share.putExtra(Intent.EXTRA_STREAM,first);
        ClipData clip=ClipData.newRawUri("Synthetic test file",first);if(multiple)clip.addItem(new ClipData.Item(second));share.setClipData(clip);
        share.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if(!"denied".equals(mode))share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(share);finish();
    }
}
