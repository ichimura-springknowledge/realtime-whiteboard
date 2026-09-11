"""Restricts the whiteboard to machines on the local network.

This is a network boundary, not authentication: anyone who can join the same
Wi-Fi can reach the board. It keeps the internet out, nothing more.
"""

from __future__ import annotations

from ipaddress import AddressValueError, ip_address, ip_network
from typing import Iterable

# RFC1918 private ranges, plus loopback and link-local, in both families.
DEFAULT_NETWORKS: tuple[str, ...] = (
    "127.0.0.0/8",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
)

LOOPBACK_NETWORKS: tuple[str, ...] = ("127.0.0.0/8", "::1/128")


class InvalidRangeError(ValueError):
    """Raised at startup when ALLOWED_CIDRS cannot be parsed."""


def normalize_address(address: str | None) -> str | None:
    """Strips the IPv4-mapped IPv6 prefix and any zone id."""
    if not address:
        return None
    value = address.strip()
    if not value:
        return None
    zone = value.find("%")
    if zone != -1:
        value = value[:zone]
    if value.lower().startswith("::ffff:") and "." in value:
        value = value[len("::ffff:") :]
    return value


def _parse_networks(entries: Iterable[str]) -> list:
    networks = []
    for entry in entries:
        text = entry.strip()
        if not text:
            continue
        try:
            networks.append(ip_network(text, strict=False))
        except (ValueError, AddressValueError) as error:
            raise InvalidRangeError(
                f'ALLOWED_CIDRS に不正な指定があります: "{text}" ({error})'
            ) from error
    return networks


class AccessGuard:
    """Decides whether a connection may reach the board.

    `allowed_cidrs` (comma separated) replaces the default private ranges;
    loopback stays allowed either way so the host machine and its own health
    checks keep working.
    """

    def __init__(self, allowed_cidrs: str | None = None) -> None:
        self._configured = bool(allowed_cidrs and allowed_cidrs.strip())
        if self._configured:
            assert allowed_cidrs is not None
            self._description = allowed_cidrs.strip()
            self._networks = _parse_networks(LOOPBACK_NETWORKS) + _parse_networks(
                allowed_cidrs.split(",")
            )
        else:
            self._description = f"プライベートアドレス全体 ({', '.join(DEFAULT_NETWORKS)})"
            self._networks = _parse_networks(DEFAULT_NETWORKS)

    def allows(self, address: str | None) -> bool:
        value = normalize_address(address)
        if value is None:
            return False
        try:
            parsed = ip_address(value)
        except ValueError:
            return False
        return any(parsed in network for network in self._networks)

    def describe(self) -> str:
        return self._description
