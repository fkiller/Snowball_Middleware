"""Read native SQLite databases without changing their data or ignoring WAL."""
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile


class SnapshotConnection(sqlite3.Connection):
    snapshot_directory = None

    def close(self):
        try:
            super().close()
        finally:
            if self.snapshot_directory:
                self.snapshot_directory.cleanup()
                self.snapshot_directory = None


def open_native_database(file):
    source = Path(file).absolute()
    connection = None
    try:
        connection = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
        connection.execute('PRAGMA schema_version').fetchone()
        return connection
    except sqlite3.OperationalError as error:
        if connection:
            connection.close()
        # Apple Python can reject a WAL-mode DB with no WAL/SHM files even
        # though the file exists and Node's native read-only SQLite opens it.
        if 'unable to open database file' not in str(error):
            raise
        node = os.environ.get('SNOWBALL_NODE_EXECUTABLE', '')
        if not os.path.isabs(node) or not source.is_file():
            raise
    temporary = tempfile.TemporaryDirectory(prefix='snowball-native-db-')
    try:
        destination = Path(temporary.name) / 'snapshot.db'
        result = subprocess.run([node, str(Path(__file__).with_name('snapshot-native-db.mjs')), str(source), str(destination)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode != 0:
            raise sqlite3.OperationalError('Native read-only database snapshot unavailable')
        connection = sqlite3.connect(destination.as_uri() + '?mode=ro', uri=True, factory=SnapshotConnection)
        connection.snapshot_directory = temporary
        return connection
    except BaseException:
        temporary.cleanup()
        raise
