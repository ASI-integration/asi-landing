"""Pure offline binding checks. Caller context and JSON are never authorization.

No network, database, SSH, subprocess, extraction, activation or authority adapter.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import BinaryIO, Mapping

REPOSITORY = 'ASI-integration/asi-landing'
SCHEMA = 'asi.strigunov4.execution-binding.v1'
SHA1 = re.compile(r'[0-9a-f]{40}')
SHA256 = re.compile(r'[0-9a-f]{64}')
SQL_PATH = re.compile(r'supabase/migrations/([0-9]{14})_[a-z0-9_]+\.sql')


class BindingError(ValueError):
    """Fixed error code only; input values must not appear in diagnostics."""


def require(condition, code):
    if not condition:
        raise BindingError(code)


def keys(value, expected, code):
    require(type(value) is dict and set(value) == set(expected), code)


def text(value):
    return type(value) is str and bool(value) and not any(ord(c) < 32 for c in value)


def digest(value, pattern):
    return type(value) is str and pattern.fullmatch(value) is not None


def load_json(raw):
    """Reject duplicate keys instead of silently selecting an authority claim."""
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(BindingError('JSON_CONSTANT')))
    except (UnicodeError, json.JSONDecodeError):
        raise BindingError('INVALID_JSON') from None


def validate_shape(manifest):
    keys(manifest, ['schemaVersion', 'repository', 'target', 'release', 'migrations', 'provenance'], 'MANIFEST_FIELDS')
    require(manifest['schemaVersion'] == SCHEMA and manifest['repository'] == REPOSITORY, 'REPOSITORY_OR_SCHEMA')
    target = manifest['target']
    keys(target, ['environment', 'projectRef', 'service', 'releaseRoot'], 'TARGET_FIELDS')
    require(target['environment'] == 'staging'
            and target['projectRef'] == 'meeravcldnmocjtlqoeu'
            and target['service'] == 'asi-landing-staging'
            and target['releaseRoot'] == '/var/www/asi-staging/releases', 'TARGET_IDENTITY')
    release = manifest['release']
    keys(release, ['gitSha', 'sourceTreeSha', 'archive', 'sha256', 'bytes', 'sourceLockSha256'], 'RELEASE_FIELDS')
    require(digest(release['gitSha'], SHA1) and digest(release['sourceTreeSha'], SHA1)
            and digest(release['sha256'], SHA256) and digest(release['sourceLockSha256'], SHA256), 'RELEASE_DIGEST')
    require(release['archive'] == 'asi-staging-' + release['gitSha'] + '.tgz', 'ARCHIVE_NAME')
    require(type(release['bytes']) is int and release['bytes'] > 0, 'ARCHIVE_SIZE')
    migrations = manifest['migrations']
    require(type(migrations) is list and 0 < len(migrations) <= 32, 'MIGRATION_COUNT')
    versions = set()
    for migration in migrations:
        keys(migration, ['path', 'sha256'], 'MIGRATION_FIELDS')
        require(type(migration['path']) is str, 'MIGRATION_PATH')
        match = SQL_PATH.fullmatch(migration['path'])
        require(match is not None, 'MIGRATION_PATH')
        require(match[1] not in versions, 'DUPLICATE_MIGRATION_VERSION')
        versions.add(match[1])
        require(digest(migration['sha256'], SHA256), 'MIGRATION_DIGEST')
    provenance = manifest['provenance']
    keys(provenance, ['taskId', 'taskCycle', 'requestedAction', 'workflowRef', 'workflowSha',
                      'runId', 'runAttempt', 'artifactId', 'reviewReference'], 'PROVENANCE_FIELDS')
    require(all(text(provenance[k]) for k in ('taskId', 'taskCycle', 'reviewReference')), 'PROVENANCE_TEXT')
    require(provenance['requestedAction'] in ('staging_migration', 'staging_activation'), 'ACTION_SCOPE')
    require(type(provenance['workflowRef']) is str and re.fullmatch(
        re.escape(REPOSITORY) + r'/\.github/workflows/[a-z0-9_-]+\.ya?ml@refs/heads/main',
        provenance['workflowRef']) is not None, 'WORKFLOW_REF')
    require(digest(provenance['workflowSha'], SHA1), 'WORKFLOW_SHA')
    require(all(type(provenance[k]) is int and provenance[k] > 0
                for k in ('runId', 'runAttempt', 'artifactId')), 'PROVENANCE_IDS')


def validate_manifest(manifest, expected_binding, package_manifest,
                      sql_bytes: Mapping[str, bytes], archive_stream: BinaryIO):
    """Bind bytes to explicit caller-owned expectations; NEVER verify authority.

    expected_binding must come from the caller's reviewed context. Even a perfect
    match, including provenance identifiers, does not authenticate that context.
    """
    validate_shape(manifest)
    validate_shape(expected_binding)
    require(manifest == expected_binding, 'EXPECTED_BINDING_MISMATCH')
    keys(package_manifest, ['gitSha', 'sourceTreeSha', 'g0SourceSha', 'environment', 'appVersion',
                            'sourceLockSha256', 'archive', 'sha256', 'bytes', 'activationPerformed'], 'PACKAGE_FIELDS')
    require(package_manifest['environment'] == 'staging'
            and package_manifest['activationPerformed'] is False, 'PACKAGE_SCOPE')
    require(digest(package_manifest['g0SourceSha'], SHA1) and text(package_manifest['appVersion']), 'PACKAGE_METADATA')
    release = manifest['release']
    require(all(type(package_manifest[k]) is type(v) and package_manifest[k] == v
                for k, v in release.items()), 'PACKAGE_BINDING_MISMATCH')
    require(set(sql_bytes) == {m['path'] for m in manifest['migrations']}, 'SQL_FILE_SET')
    for migration in manifest['migrations']:
        raw = sql_bytes[migration['path']]
        require(type(raw) is bytes and hashlib.sha256(raw).hexdigest() == migration['sha256'], 'SQL_BYTES_MISMATCH')
    sha = hashlib.sha256()
    size = 0
    while True:
        chunk = archive_stream.read(1024 * 1024)
        require(type(chunk) is bytes, 'ARCHIVE_STREAM')
        if not chunk:
            break
        size += len(chunk)
        require(size <= release['bytes'], 'ARCHIVE_BYTES_MISMATCH')
        sha.update(chunk)
    require(size == release['bytes'] and sha.hexdigest() == release['sha256'], 'ARCHIVE_BYTES_MISMATCH')
    canonical = json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
    return {'status': 'BOUND_NOT_AUTHORIZED', 'bindingSha256': hashlib.sha256(canonical).hexdigest(),
            'migrationCount': len(manifest['migrations']), 'authorization': False,
            'mutationAllowed': False, 'provenanceAuthenticated': False}


def sql_file(root, relative):
    """No absolute/traversal paths or symlink components, even within SQL root."""
    require(type(relative) is str and SQL_PATH.fullmatch(relative) is not None, 'MIGRATION_PATH')
    path = root
    for part in relative.split('/'):
        path = path / part
        require(not path.is_symlink(), 'SQL_SYMLINK')
    require(path.is_file(), 'SQL_FILE_MISSING')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--expected-binding', type=Path, required=True)
    parser.add_argument('--package-manifest', type=Path, required=True)
    parser.add_argument('--sql-root', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = load_json(args.manifest.read_bytes())
        expected = load_json(args.expected_binding.read_bytes())
        package = load_json(args.package_manifest.read_bytes())
        validate_shape(manifest)
        root = args.sql_root.resolve(strict=True)
        sql = {m['path']: sql_file(root, m['path']).read_bytes() for m in manifest['migrations']}
        require(not args.archive.is_symlink() and args.archive.is_file(), 'ARCHIVE_FILE')
        require(args.archive.name == manifest['release']['archive'], 'ARCHIVE_NAME')
        with args.archive.open('rb') as stream:
            result = validate_manifest(manifest, expected, package, sql, stream)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (BindingError, OSError, TypeError):
        print('{"status":"BLOCK","authorization":false,"mutationAllowed":false,"provenanceAuthenticated":false}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
