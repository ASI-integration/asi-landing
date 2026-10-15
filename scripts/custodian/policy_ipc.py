"""Default-off synthetic consultation for the existing Custodian Unix service.

No policy publication, key enrollment, initialization or real action via IPC.
Receipt bytes remain signed bytes; envelope cannot supply authority state.
"""
from pathlib import Path
import re
import durable_policy as d

PROTOCOL = 'ASI_CUSTODIAN_POLICY_CONSULT_V1'
MAX_FRAME = 8192
KEYS = {'kind', 'op', 'runId', 'receipt', 'signature'}
CONFIG_KEYS = {'schema', 'policyRoot', 'publicKey', 'issuer', 'keyId',
               'keySha256', 'host', 'archiveSha256'}


class Consultation:
    def __init__(self, technical_root):
        self.config_path = Path(technical_root) / 'policy-consult.json'
        self.snapshot = d.read(self.config_path, 8192)
        cfg = d.decode(self.snapshot, 8192)
        if (set(cfg) != CONFIG_KEYS or type(cfg['schema']) is not int or cfg['schema'] != 1
                or any(not isinstance(cfg[k], str) for k in CONFIG_KEYS - {'schema'})
                or not Path(cfg['policyRoot']).is_absolute()
                or Path(cfg['policyRoot']) == Path(technical_root)):
            raise d.Hold('CONSULT_CONFIG')
        self.boundary = d.Boundary(cfg['policyRoot'], cfg['publicKey'].encode('ascii'),
                                  issuer=cfg['issuer'], key_id=cfg['keyId'],
                                  key_sha256=cfg['keySha256'], host=cfg['host'],
                                  archive_sha256=cfg['archiveSha256'], enabled=True)

    def consume(self, connection, raw, run_id):
        if d.read(self.config_path, 8192) != self.snapshot:
            raise d.Hold('CONSULT_CONFIG_CHANGED_RESTART_REQUIRED')
        if not raw.endswith(b'\n') or raw.count(b'\n') != 1:
            raise d.Hold('CONSULT_FRAME')
        value = d.decode(raw[:-1], MAX_FRAME - 1)
        if (set(value) != KEYS or value['kind'] != PROTOCOL or value['op'] != 'consult'
                or value['runId'] != run_id or not isinstance(value['receipt'], str)
                or not isinstance(value['signature'], str)
                or not re.fullmatch('[0-9a-f]{128}', value['signature'])):
            raise d.Hold('CONSULT_SCHEMA')
        # ASCII exact bytes; no receipt normalization or caller-supplied identity.
        receipt = value['receipt'].encode('ascii')
        return self.boundary.consume(connection, receipt, bytes.fromhex(value['signature']))
