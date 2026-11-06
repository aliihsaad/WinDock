package com.windock.app

/** Nearby advertisements are routing hints, never certificates or authority to connect. */
object ManagedPcScanner {
    fun scan(saved: List<KnownHost>, trusted: List<TrustedComputer>, secureOnly: Boolean,
             networks: List<LocalNetwork> = LocalNetwork.available(),
             discoverManaged: () -> List<ManagedDiscovery.Candidate> = { ManagedDiscovery.findAll(networks) },
             discoverLegacy: () -> List<Discovery.Candidate> = { Discovery.findAll(networks, secureOnly = secureOnly) }): List<KnownHost> {
        val managed = discoverManaged()
        return PcScanner.scan(saved, networks, secureOnly,
            discover = { managed.map { Discovery.Candidate(it.endpoint, it.usb) } + discoverLegacy() },
            probe = { endpoint, usb ->
                val hint = managed.firstOrNull { it.endpoint == endpoint }
                val identity = trusted.firstOrNull { if (hint != null) it.hostId == hint.hostId else it.endpoint == endpoint }
                if (identity != null) {
                    // Health may renew a CA. A background scan must never save/select another PC.
                    runCatching { SecureTransport(identity.copy(endpoint = endpoint), {}).use { it.health().copy(usb = usb) } }.getOrNull()
                } else if (hint != null) {
                    KnownHost(endpoint, "New PC", usb, 0, hostId = hint.hostId, requiresPairing = true)
                } else HostProbe.read(endpoint, usb)
            })
    }
}
