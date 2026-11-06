package com.windock.app

import org.junit.Assert.*
import org.junit.Test

class TransferRulesTest {
    @Test fun selectedContentUrisOnly() {
        assertTrue(TransferRules.validUri("content://media/picker/0/abc"))
        assertTrue(TransferRules.validUri("content://com.example.documents/document/one%20two"))
        for(value in listOf("file:///etc/passwd","https://host/file","content://","content://other@media/file","content://media/file#fragment","content://media/\nfile"))assertFalse(value,TransferRules.validUri(value))
    }
    @Test fun providerMetadataIsBoundedAndPreservesUnicode() {
        assertEquals("مرحبا 🙂.pdf",TransferRules.name("مرحبا 🙂.pdf"))
        assertEquals("Shared file",TransferRules.name("x".repeat(1025)))
        assertEquals("a_b",TransferRules.name("a\nb"))
        assertEquals("image/jpeg",TransferRules.mime("image/jpeg"))
        assertEquals("application/octet-stream",TransferRules.mime("text/plain\r\nX: y"))
        assertNull(TransferRules.size(-1));assertEquals(0L,TransferRules.size(0))
    }
    @Test fun operationIdentifiersAndLargeFileLimits() {
        val ids=(1..100).map { TransferRules.id() };assertEquals(100,ids.toSet().size)
        assertTrue(ids.all { it.matches(Regex("[a-f0-9]{32}")) })
        assertTrue(TransferRules.MAX_FILE_BYTES>Int.MAX_VALUE.toLong())
        assertEquals(50,TransferRules.MAX_FILES)
    }
}
