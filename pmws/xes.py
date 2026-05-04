import os
import tempfile
import pm4py


def load_xes(file_storage):
    """Load a pm4py EventLog from a Flask FileStorage object via a temp file."""
    fd, tmp_path = tempfile.mkstemp(suffix='.xes')
    try:
        os.close(fd)
        file_storage.save(tmp_path)
        return pm4py.read_xes(tmp_path)
    finally:
        os.unlink(tmp_path)
