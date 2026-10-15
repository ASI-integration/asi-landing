# Task33 nonroot host package and owner checklist

PREPARATION ONLY. Do not run this recipe on a physical host in this sprint.
Target: ASI-Lab / asi-pilot-lab-01 /65.21.249.108. Owner reports console root access; authenticated SSH remains unresolved. Console access is not authenticated network access, host approval, installation or acceptance.

Technical archive SHA256: `dca0c8094f6039bd1f8627c75c0ac12208786aa7d8686bd9c4080634bef98306`. This is a byte-integrity pin, not an owner signature. Require the successful final CI artifact to match it.

## Exact owner gate

Before any host modification, record genuine approval binding exact host identity (including verified host-key fingerprint), archive SHA256 from this PR's successful CI artifact, allowed service account/UID/GID and client UID/GID, allowed directories and operations, no-egress/no-authority controls, verification and rollback. No typed fixture receipt or CI signer substitutes for this approval. Do not use an archive without its exact digest. The final sprint report pins the produced digest and run ID; absence of either means STOP.

Once authorized authenticated access actually works, compare `ssh-keygen -lf /root/.ssh/authorized_keys` with the Windows approved public key fingerprint (`ssh-keygen -lf <approved-public-key>.pub`), without copying private keys. Verify each authorized key's restrictions and expected account. Inspect effective `sshd -T` including Match conditions for the actual client/account, sshd logs and read-only ban/firewall status through the approved admin session. Never disable host-key verification, root protections or bans. This sprint performs none of those host commands.

## Nonroot idempotent staging recipe

An owner/admin separately provisions the approved nonroot service and client accounts (never inferred from account names), a service-owned0700 base, private state0700, and separate IPC directory service-owned with client group2710. The client must have no access to private state, policy, config, release switching or service files. Account creation and system service installation require their own exact approved scope. Do not run Python as root.

As the approved service user, in a fresh private staging directory:

1. Obtain the CI archive and exact reviewed source checkout over an approved channel. Check `sha256sum <archive>` against the report. Validate with the reviewed `scripts/custodian/build_release.py --verify --out <archive>` from this exact source. This verifies canonical archive bytes, manifest, metadata and member allowlist before extraction. Run as nonroot; no arbitrary tar extraction as root.
2. Stage only validated regular members into a NEW release directory named by the exact digest under the service-owned releases directory. Reapply0755 to Python source,0600 to README/manifest. Never overwrite an existing release. For a retry, verify every byte/mode against the archive and reuse only an identical directory; mismatch is HOLD. Installation must not replace a running release or manipulate state automatically.
3. Initialize a fresh technical state only once using `asi_custodian.py init --state-dir <new-private-state> --run-id <approved-synthetic-run> --peer-uid <approved-client-uid> --peer-gid <approved-primary-gid>`. If config/journal already exists, verify it and retain it; do not rerun initialization. Never recreate a missing policy ledger. Do not copy CI keys, receipts or state onto the host.
4. Select the exact validated release path in the service unit. Leave BOTH append and consultation flags absent. Test technical readback. The installed service cannot grant real authority.
5. Owner-controlled policy provisioning is a separate later gate: private signing key stays with the independent issuer, never on service/client/runner. Provision only approved public key/pins and a policy bound to the host, exact archive, UID/GID and synthetic scope. Store canonical policy-consult.json0600 under private technical state. Boundary initialization/publication is explicit local administration, never IPC. A missing/corrupt/pending store is HOLD, not re-enrollment. Even after synthetic consultation is separately enabled, Phase2 stays BLOCK until independent witness/clock and genuine owner/host acceptance exist.

## Systemd recipe (template, no execution)

Render placeholders only from the exact owner artifact; do not treat placeholders as runnable values. Use a system unit installed by the separately authorized admin, executing as the approved nonroot service account. No supplementary client group is required: preprovisioned setgid IPC directory supplies socket group.

```ini
[Unit]
Description=ASI Custodian technical recorder - no authority
After=local-fs.target

[Service]
Type=simple
User=<approved-service-user>
Group=<approved-service-group>
UMask=0077
ExecStart=/usr/bin/python3 <digest-release>/asi-custodian/asi_custodian.py serve --state-dir <private-state> --ipc-dir <separate-ipc>
Restart=no
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
RestrictAddressFamilies=AF_UNIX
IPAddressDeny=any
CapabilityBoundingSet=
AmbientCapabilities=
RestrictSUIDSGID=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ReadWritePaths=<private-state> <separate-ipc>

[Install]
WantedBy=multi-user.target
```

Use paths outside /home if ProtectHome=yes. Future separately provisioned policy state must also be explicitly allowed in ReadWritePaths. No network service dependencies, production credentials or issuer private keys. Do not auto-restart after SIGKILL: investigate stale socket and pending intent. Validate rendered unit with `systemd-analyze verify` before an approved start; this template has not been tested on the physical host.

## Host acceptance and rollback

After exact approval only: verify actual distinct client/service UID and primary GID, state/link/mode denial, bounded malformed frames, default-off status, stop/restart, and synthetic consultation against independently controlled fixtures. Save full source/archive/config-public-pin digests and logs. Run no real dispatch or provider calls. Do not claim host acceptance from hosted CI.

Rollback is idempotent and preserves authority history: stop the new process; verify it is stopped; retain state, nonce ledger, pending markers, checkpoint and forensic logs unchanged. Select only a previous independently approved digest release and compatible configuration, without decreasing epochs or restoring old state. If compatibility cannot be established, remain stopped/HOLD. Do not force-remove stale sockets or journals, delete evidence, auto-reinitialize, or enable authority to recover. A repeated rollback to the already selected, verified stopped release is a no-op. Re-enable/start only under the approved rollback scope and repeat technical status; Phase2 stays BLOCK.
