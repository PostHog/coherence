"""Assay transport only: route a synthetic host to dedicated loopback ports.

No application functions, test assertions, or service responses are replaced.
Unknown ports on this hostname refuse, rather than falling into the shared stack.
"""
import socket

_resolve = socket.getaddrinfo


def _assay_address(host, port, *args, **kwargs):
    if host == "coherence-assay-clickhouse.invalid":
        ports = {8123: 58129, 9000: 59009}
        if int(port) not in ports:
            raise RuntimeError(f"Unmapped assay ClickHouse port: {port}")
        return _resolve("127.0.0.1", ports[int(port)], *args, **kwargs)
    return _resolve(host, port, *args, **kwargs)


socket.getaddrinfo = _assay_address
