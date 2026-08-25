"""Windows compatibility for genlayer-test 0.29.2 direct-mode loading.

The upstream loader unlinks its temporary stdin file while fd 0 still points
to it. POSIX permits that; Windows raises WinError 32. This test-only shim
defers deletion until the next injection/process exit. Remove it once the
upstream package handles Windows itself.
"""

import atexit
import os
import tempfile


if os.name == "nt":
    from gltest.direct import loader

    _active_path = None
    _process_stdin = os.dup(0)

    def _inject_message_to_fd0_windows(vm):
        global _active_path

        from genlayer.py import calldata
        from genlayer.py.types import Address

        sender = Address(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
        contract = (
            Address(vm._contract_address)
            if isinstance(vm._contract_address, bytes)
            else vm._contract_address
        )
        origin = Address(vm.origin) if isinstance(vm.origin, bytes) else vm.origin
        encoded = calldata.encode(
            {
                "contract_address": contract,
                "sender_address": sender,
                "origin_address": origin,
                "stack": [],
                "value": vm._value,
                "datetime": vm._datetime,
                "is_init": False,
                "chain_id": vm._chain_id,
                "entry_kind": 0,
                "entry_data": b"",
                "entry_stage_data": None,
            }
        )

        previous_saved = getattr(vm, "_original_stdin_fd", None)
        if previous_saved is not None:
            try:
                os.close(previous_saved)
            except OSError:
                pass

        fd, path = tempfile.mkstemp()
        try:
            os.write(fd, encoded)
            os.lseek(fd, 0, os.SEEK_SET)
            vm._original_stdin_fd = os.dup(_process_stdin)
            os.dup2(fd, 0)
        finally:
            os.close(fd)

        old_path = _active_path
        _active_path = path
        if old_path:
            try:
                os.unlink(old_path)
            except OSError:
                pass

    def _cleanup_temp_stdin():
        try:
            os.dup2(_process_stdin, 0)
        except OSError:
            pass
        try:
            os.close(_process_stdin)
        except OSError:
            pass
        if _active_path:
            try:
                os.unlink(_active_path)
            except OSError:
                pass

    loader._inject_message_to_fd0 = _inject_message_to_fd0_windows
    atexit.register(_cleanup_temp_stdin)
