package com.windock.app

import android.speech.SpeechRecognizer
import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

class VoicePolicyTest {
    @Test fun regionalLocalesFallBackToTheSpeechPacksPhonesShip() {
        assertEquals(listOf("es-VE", "es-ES", "es-US", "es-MX"), VoicePolicy.languageCandidates(Locale.forLanguageTag("es-VE")))
        assertEquals(listOf("es-ES", "es-US", "es-MX"), VoicePolicy.languageCandidates(Locale.forLanguageTag("es-ES")))
        assertEquals(listOf("en-US", "en-GB"), VoicePolicy.languageCandidates(Locale.US))
        assertEquals(listOf("en-GB", "en-US"), VoicePolicy.languageCandidates(Locale.UK))
        assertEquals(listOf("de-DE", "de"), VoicePolicy.languageCandidates(Locale.GERMANY))
        assertEquals(listOf("fr"), VoicePolicy.languageCandidates(Locale.FRENCH))
        assertEquals(listOf("en-US"), VoicePolicy.languageCandidates(Locale.ROOT))
    }

    @Test fun recognizerErrorsCollapseToWhatTheDockExplains() {
        assertEquals("no-match", VoicePolicy.errorCode(SpeechRecognizer.ERROR_NO_MATCH))
        assertEquals("no-match", VoicePolicy.errorCode(SpeechRecognizer.ERROR_SPEECH_TIMEOUT))
        assertEquals("permission", VoicePolicy.errorCode(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS))
        assertEquals("busy", VoicePolicy.errorCode(SpeechRecognizer.ERROR_RECOGNIZER_BUSY))
        assertEquals("language", VoicePolicy.errorCode(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED))
        assertEquals("language", VoicePolicy.errorCode(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE))
        for (error in listOf(SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_AUDIO, SpeechRecognizer.ERROR_CLIENT, 999)) {
            assertEquals("unavailable", VoicePolicy.errorCode(error))
        }
    }

    @Test fun languageRetriesStopWhenCandidatesRunOut() {
        assertTrue(VoicePolicy.shouldRetryLanguage("language", 2))
        assertFalse(VoicePolicy.shouldRetryLanguage("language", 0))
        assertFalse(VoicePolicy.shouldRetryLanguage("no-match", 2))
        assertFalse(VoicePolicy.shouldRetryLanguage("unavailable", 2))
    }

    @Test fun theDownloadIsThePackThePhoneActuallyOffers() {
        val tried = listOf("es-VE", "es-ES", "es-US", "es-MX")
        assertEquals("es-ES", VoicePolicy.languageToDownload(tried, listOf("en-US", "es-ES", "es-US"), emptyList(), emptyList()))
        assertEquals("es-US", VoicePolicy.languageToDownload(tried, listOf("es-ES", "es-US"), listOf("es-ES"), emptyList()))
        assertEquals("es-419", VoicePolicy.languageToDownload(tried, listOf("en-US", "es-419"), emptyList(), emptyList()))
        assertNull(VoicePolicy.languageToDownload(tried, listOf("en-US", "fr-FR"), emptyList(), emptyList()))
        assertNull(VoicePolicy.languageToDownload(tried, listOf("es-ES"), emptyList(), listOf("es-ES")))
        assertNull(VoicePolicy.languageToDownload(tried, null, null, null))
        assertEquals("es-US", VoicePolicy.languageToDownload(tried, listOf("ES-us"), emptyList(), emptyList()))
    }

    @Test fun theFailureLineNamesWhatThePhoneHas() {
        val line = VoicePolicy.describeSupport(true, listOf("es-VE", "es-ES"), listOf("en-US"), listOf("en-US", "es-ES"), listOf("es-ES"))
        assertEquals("on-device recognizer: yes · tried: es-VE, es-ES · installed: en-US · available: en-US, es-ES · downloading: es-ES", line)
        assertEquals("on-device recognizer: no · tried: es-VE", VoicePolicy.describeSupport(false, listOf("es-VE"), null, null, null))
        assertEquals("on-device recognizer: yes · tried: es-VE · installed: none · available: none", VoicePolicy.describeSupport(true, listOf("es-VE"), emptyList(), emptyList(), emptyList()))
    }

    @Test fun transcriptSkipsBlankCandidates() {
        assertEquals("abre chrome", VoicePolicy.transcript(listOf("  ", "abre chrome ", "abrir cromo")))
        assertNull(VoicePolicy.transcript(listOf(" ", "")))
        assertNull(VoicePolicy.transcript(emptyList()))
        assertNull(VoicePolicy.transcript(null))
    }
}
